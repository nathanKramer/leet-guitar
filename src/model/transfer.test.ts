import { describe, expect, it } from 'vitest';
import { addNote, addTrack, copyNotes, DEFAULT_TRACK_ID, initDocument, pasteNotes, setTuning } from './commands';
import { notePitch } from './drums';
import { PIANO_KEYS, STANDARD_TUNING } from './music';
import { DocumentStore } from './store';
import { bestFingering, spotForPitch } from './transfer';
import type { ID, Song } from './types';

function setup() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  const ids: Record<string, ID> = { guitar: DEFAULT_TRACK_ID };
  for (const kind of ['piano', 'bass', 'drums'] as const) {
    const { ops, id } = addTrack(s.getSong(), kind);
    s.transact(ops);
    ids[kind] = id;
  }
  return { s, ids };
}
const add = (s: DocumentStore, trackId: ID, string: number, fret: number, start = 0, duration = 480) => {
  const r = addNote(s.getSong(), { trackId, string, fret, start, duration, velocity: 90 });
  s.transact(r.ops);
  return r.id;
};
/** [start, pitch] of a track's notes, sorted. */
const sounding = (song: Song, trackId: ID) =>
  Object.values(song.notes)
    .filter((n) => n.trackId === trackId)
    .map((n) => [n.start, notePitch(song.tracks[trackId], n)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const copyPaste = (s: DocumentStore, ids: ID[], to: ID, at = 0) => {
  const clip = copyNotes(s.getSong(), ids)!;
  const r = pasteNotes(s.getSong(), clip, to, at);
  s.transact(r.ops);
  return r;
};

describe('copying between instruments', () => {
  it('guitar to piano keeps every pitch and timing', () => {
    const { s, ids } = setup();
    // open G chord (G2 B2 D3 G3 B3 G4) then a single A on the G string
    const chord = [3, 0, 0, 0, 2, 3].map((fret, string) => add(s, ids.guitar, string, fret));
    const a = add(s, ids.guitar, 2, 2, 480);
    copyPaste(s, [...chord, a], ids.piano);
    expect(sounding(s.getSong(), ids.piano)).toEqual(sounding(s.getSong(), ids.guitar));
    expect(Object.values(s.getSong().notes).filter((n) => n.trackId === ids.piano).every((n) => n.fret === 0)).toBe(true);
  });

  it('piano to guitar picks a playable fingering with the same pitches', () => {
    const { s, ids } = setup();
    const lane = (p: number) => PIANO_KEYS.indexOf(p);
    const notes = [60, 64, 67].map((p) => add(s, ids.piano, lane(p), 0)); // C major triad
    const r = copyPaste(s, notes, ids.guitar);
    expect(r.placement).toMatchObject({ octaveShifted: 0, dropped: 0 });
    expect(sounding(s.getSong(), ids.guitar)).toEqual(sounding(s.getSong(), ids.piano));
    const placed = Object.values(s.getSong().notes).filter((n) => n.trackId === ids.guitar);
    expect(new Set(placed.map((n) => n.string)).size).toBe(3);
    const fretted = placed.map((n) => n.fret).filter((f) => f > 0);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
  });

  it('keeps a melody in one area of the neck', () => {
    const { s, ids } = setup();
    const lane = (p: number) => PIANO_KEYS.indexOf(p);
    const melody = [72, 74, 76, 77, 79].map((p, i) => add(s, ids.piano, lane(p), 0, i * 240, 240));
    copyPaste(s, melody, ids.guitar);
    const frets = Object.values(s.getSong().notes)
      .filter((n) => n.trackId === ids.guitar)
      .map((n) => n.fret);
    // Played in one position (one hand's reach), not slid along a single string.
    const fretted = frets.filter((f) => f > 0);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
    expect(sounding(s.getSong(), ids.guitar)).toEqual(sounding(s.getSong(), ids.piano));
  });

  it('pastes into an identical instrument with the same fingering', () => {
    const { s, ids } = setup();
    const { ops, id: gtr2 } = addTrack(s.getSong(), 'guitar');
    s.transact(ops);
    const n = add(s, ids.guitar, 1, 5); // E4 on the B string (could also be open high E)
    copyPaste(s, [n], gtr2);
    const pasted = Object.values(s.getSong().notes).find((x) => x.trackId === gtr2)!;
    expect(pasted).toMatchObject({ string: 1, fret: 5 });
  });

  it('moves notes by octaves to fit the range, and says so', () => {
    const { s, ids } = setup();
    const lane = (p: number) => PIANO_KEYS.indexOf(p);
    const low = add(s, ids.piano, lane(28), 0); // E1: below the guitar
    const high = add(s, ids.piano, lane(100), 0, 480); // E7: above the bass
    const toGuitar = copyPaste(s, [low], ids.guitar);
    expect(toGuitar.placement.octaveShifted).toBe(1);
    expect(sounding(s.getSong(), ids.guitar)).toEqual([[0, 40]]);
    const toBass = copyPaste(s, [high], ids.bass, 0);
    expect(toBass.placement.octaveShifted).toBe(1);
    const bassPitch = sounding(s.getSong(), ids.bass)[0][1];
    expect(bassPitch % 12).toBe(100 % 12);
  });

  it('leaves out notes when a chord has more notes than strings', () => {
    const { s, ids } = setup();
    const lane = (p: number) => PIANO_KEYS.indexOf(p);
    const cluster = [48, 52, 55, 59, 62, 65, 69].map((p) => add(s, ids.piano, lane(p), 0));
    const r = copyPaste(s, cluster, ids.guitar);
    expect(r.placement.dropped).toBe(1);
    const pitches = sounding(s.getSong(), ids.guitar).map((x) => x[1]);
    expect(pitches).toContain(48); // bottom voice kept
    expect(pitches).toContain(69); // top voice kept
  });

  it('refuses to turn drums into pitched notes or vice versa', () => {
    const { s, ids } = setup();
    const hit = add(s, ids.drums, 8, 0);
    expect(copyPaste(s, [hit], ids.piano).placement.refused).toBe(true);
    const note = add(s, ids.guitar, 0, 0);
    expect(copyPaste(s, [note], ids.drums).placement.refused).toBe(true);
  });
});

describe('bestFingering', () => {
  it('fingers a full open E major chord across all six strings', () => {
    const track = { tuning: STANDARD_TUNING, frets: 22 };
    const pitches = [64, 59, 56, 52, 47, 40]; // E4 B3 G#3 E3 B2 E2
    const f = bestFingering(pitches, track);
    expect(f.every(Boolean)).toBe(true);
    f.forEach((spot, i) => expect(STANDARD_TUNING[spot!.string] + spot!.fret).toBe(pitches[i]));
    expect(f.map((x) => x!.fret)).toEqual([0, 0, 1, 2, 2, 0]);
  });
});

describe('guitar and bass strings line up', () => {
  const B_STANDARD = [59, 54, 50, 45, 40, 35];
  const BASS_5 = [43, 38, 33, 28, 23];
  /** [string, fret] of a track's notes in time order. */
  const tab = (song: Song, trackId: ID) =>
    Object.values(song.notes)
      .filter((n) => n.trackId === trackId)
      .sort((a, b) => a.start - b.start || a.string - b.string)
      .map((n) => [n.string, n.fret]);

  it('B standard guitar, low B string, to a 5-string bass: same frets on the low B', () => {
    const { s, ids } = setup();
    s.transact(setTuning(s.getSong(), ids.guitar, B_STANDARD).ops);
    s.transact(setTuning(s.getSong(), ids.bass, BASS_5).ops);
    const riff = [0, 0, 3, 5, 0, 7].map((fret, i) => add(s, ids.guitar, 5, fret, i * 240, 240));
    const r = copyPaste(s, riff, ids.bass);
    expect(tab(s.getSong(), ids.bass)).toEqual([0, 0, 3, 5, 0, 7].map((f) => [4, f]));
    expect(r.placement.octaveShifted).toBe(0);
  });

  it('E standard guitar to 4-string bass: E and A string parts stay on E and A, an octave down', () => {
    const { s, ids } = setup();
    const notes = [add(s, ids.guitar, 5, 3, 0), add(s, ids.guitar, 4, 5, 480), add(s, ids.guitar, 3, 2, 960)];
    copyPaste(s, notes, ids.bass);
    expect(tab(s.getSong(), ids.bass)).toEqual([
      [3, 3],
      [2, 5],
      [1, 2],
    ]);
  });

  it('fingers notes on strings the bass lacks by pitch, without doubling up a string', () => {
    const { s, ids } = setup();
    // A power chord on the low strings plus a note on the high e string, all at once.
    const chord = [add(s, ids.guitar, 5, 5), add(s, ids.guitar, 4, 7), add(s, ids.guitar, 0, 5)];
    copyPaste(s, chord, ids.bass);
    const placed = tab(s.getSong(), ids.bass);
    expect(placed).toContainEqual([3, 5]);
    expect(placed).toContainEqual([2, 7]);
    expect(new Set(placed.map(([string]) => string)).size).toBe(3);
    const pitches = sounding(s.getSong(), ids.bass).map(([, p]) => p);
    expect(pitches).toContain(69 - 12); // the high A, an octave down like the rest
  });

  it('bass to guitar goes an octave up onto the matching strings', () => {
    const { s, ids } = setup();
    const line = [add(s, ids.bass, 3, 0), add(s, ids.bass, 2, 2, 480)];
    copyPaste(s, line, ids.guitar);
    expect(tab(s.getSong(), ids.guitar)).toEqual([
      [5, 0],
      [4, 2],
    ]);
  });

  it('keeps pitches when no strings line up (E standard to B standard guitar)', () => {
    const { s, ids } = setup();
    const { ops, id: other } = addTrack(s.getSong(), 'guitar');
    s.transact(ops);
    s.transact(setTuning(s.getSong(), other, B_STANDARD).ops);
    const n = [add(s, ids.guitar, 5, 3), add(s, ids.guitar, 2, 0, 480)];
    copyPaste(s, n, other);
    expect(sounding(s.getSong(), other)).toEqual(sounding(s.getSong(), ids.guitar));
  });
});

describe('spotForPitch', () => {
  const guitar = { tuning: STANDARD_TUNING, frets: 22 };

  it('picks the lowest spot with nothing around (open strings first)', () => {
    expect(spotForPitch(64, guitar)).toEqual({ string: 0, fret: 0 });
    expect(spotForPitch(45, guitar)).toEqual({ string: 4, fret: 0 });
    expect(spotForPitch(60, guitar)).toEqual({ string: 1, fret: 1 });
  });

  it('stays in the hand position of the surrounding notes', () => {
    // Around frets 5-7, C4 is fret 5 on the G string rather than fret 1 on the B string.
    expect(spotForPitch(60, guitar, [5, 7])).toEqual({ string: 2, fret: 5 });
    // Up at the 12th fret, E4 is fretted in position (D string, fret 14) instead of the open string.
    expect(spotForPitch(64, guitar, [12, 14])).toEqual({ string: 3, fret: 14 });
    // A fretted note in reach beats an open string; an open string beats moving the hand.
    expect(spotForPitch(64, guitar, [7, 9])).toEqual({ string: 2, fret: 9 }); // in reach: fretted
    expect(spotForPitch(64, guitar, [1, 2])).toEqual({ string: 0, fret: 0 }); // fret 5 is out of reach: open
  });

  it('avoids strings already struck at the cursor', () => {
    expect(spotForPitch(60, guitar, [5], new Set([2]))).toEqual({ string: 1, fret: 1 });
  });

  it('returns null for pitches out of range', () => {
    expect(spotForPitch(30, guitar)).toBeNull();
    expect(spotForPitch(64, guitar, [], new Set([0, 1, 2, 3, 4, 5]))).toBeNull();
  });
});
