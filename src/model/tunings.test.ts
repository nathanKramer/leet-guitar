import { describe, expect, it } from 'vitest';
import { exportMidi } from '../midi/export';
import { addNote, copyNotes, DEFAULT_TRACK_ID, initDocument, pasteNotes, setTuning } from './commands';
import { notePitch } from './drums';
import { pitchName } from './music';
import { DocumentStore } from './store';
import { matchPreset, presetsFor, spellTuning, tuningLabel, TUNING_PRESETS } from './tunings';

const preset = (name: string) => TUNING_PRESETS.find((p) => p.name === name)!.pitches;

function store() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  return s;
}
const add = (s: DocumentStore, string: number, fret: number, start = 0) => {
  const r = addNote(s.getSong(), { trackId: DEFAULT_TRACK_ID, string, fret, start, duration: 480, velocity: 90 });
  s.transact(r.ops);
  return r.id;
};
const pitchOf = (s: DocumentStore, id: string) => notePitch(s.getSong().tracks[DEFAULT_TRACK_ID], s.getSong().notes[id]);

describe('tuning presets', () => {
  it('spells B standard and 7-string standard correctly', () => {
    expect(spellTuning(preset('B Standard'))).toBe('B E A D F# B');
    expect(preset('B Standard').map(pitchName).reverse()).toEqual(['B1', 'E2', 'A2', 'D3', 'F#3', 'B3']);
    expect(spellTuning(preset('7-string Standard (B)'))).toBe('B E A D G B E');
    expect(spellTuning(preset('Drop D'))).toBe('D A D G B E');
    expect(spellTuning(preset('5-string Standard (B)'))).toBe('B E A D G');
  });

  it('names known tunings and spells out custom ones', () => {
    expect(tuningLabel('guitar', preset('B Standard'))).toBe('B Std');
    expect(tuningLabel('guitar', [64, 59, 55, 50, 45, 39])).toBe('D#ADGBE'); // not a preset
    expect(matchPreset('bass', preset('B Standard'))).toBeUndefined(); // guitar preset, not bass
    expect(presetsFor('bass').every((p) => p.kind === 'bass')).toBe(true);
  });

  it('presets are all distinct within a kind', () => {
    for (const kind of ['guitar', 'bass'] as const) {
      const keys = presetsFor(kind).map((p) => p.pitches.join(','));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('setTuning', () => {
  it('keeps strings and frets, so pitches follow the new tuning', () => {
    const s = store();
    const n = add(s, 5, 3); // G2 on low E in standard
    s.transact(setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('B Standard')).ops);
    expect(s.getSong().notes[n]).toMatchObject({ string: 5, fret: 3 });
    expect(pitchName(pitchOf(s, n))).toBe('D2'); // low B + 3
    s.undo();
    expect(pitchName(pitchOf(s, n))).toBe('G2');
  });

  it('adds a low string for 7-string without touching existing notes', () => {
    const s = store();
    const n = add(s, 5, 0);
    s.transact(setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('7-string Standard (B)')).ops);
    expect(s.getSong().tracks[DEFAULT_TRACK_ID].tuning).toHaveLength(7);
    expect(pitchName(pitchOf(s, n))).toBe('E2');
    const low = add(s, 6, 0);
    expect(pitchName(pitchOf(s, low))).toBe('B1');
  });

  it('moves notes off a removed string at the same pitch, or removes them if impossible', () => {
    const s = store();
    s.transact(setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('7-string Standard (B)')).ops);
    const movable = add(s, 6, 7); // F#2: playable on low E fret 2
    const stuck = add(s, 6, 1, 480); // C2: below a standard 6-string
    const r = setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('Standard (E)'));
    expect(r).toMatchObject({ moved: 1, removed: 1 });
    s.transact(r.ops);
    expect(s.getSong().notes[movable]).toMatchObject({ string: 5, fret: 2 });
    expect(pitchName(pitchOf(s, movable))).toBe('F#2');
    expect(s.getSong().notes[stuck]).toBeUndefined();
  });

  it("won't move a note onto a string that's already sounding then", () => {
    const s = store();
    s.transact(setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('7-string Standard (B)')).ops);
    add(s, 5, 0); // low E ringing at 0..480
    const n = add(s, 6, 10); // A2, wants low E fret 5 but it's busy -> A string open
    s.transact(setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('Standard (E)')).ops);
    expect(s.getSong().notes[n]).toMatchObject({ string: 4, fret: 0 });
  });

  it('exports 7 strings on 7 channels in the per-string layout', () => {
    const s = store();
    s.transact(setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('7-string Standard (B)')).ops);
    add(s, 6, 0);
    const bytes = [...exportMidi(s.getSong(), 'per-string')];
    expect(bytes.some((b, i) => b === 0x96 && bytes[i + 1] === 35)).toBe(true); // channel 7, B1
  });

  it('pastes from standard into B standard by pitch', () => {
    const s = store();
    const n = add(s, 5, 7); // B2 in standard
    const clip = copyNotes(s.getSong(), [n])!;
    s.transact(setTuning(s.getSong(), DEFAULT_TRACK_ID, preset('B Standard')).ops);
    const r = pasteNotes(s.getSong(), clip, DEFAULT_TRACK_ID, 960);
    s.transact(r.ops);
    expect(pitchName(pitchOf(s, r.ids[0]))).toBe('B2');
  });
});
