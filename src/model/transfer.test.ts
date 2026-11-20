import { describe, expect, it } from 'vitest';
import { addNote, addTrack, copyNotes, DEFAULT_TRACK_ID, initDocument, pasteNotes } from './commands';
import { notePitch } from './drums';
import { PIANO_KEYS, STANDARD_TUNING } from './music';
import { DocumentStore } from './store';
import { bestFingering } from './transfer';
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
