import { describe, expect, it } from 'vitest';
import { addNote, addTrack, clampShift, DEFAULT_TRACK_ID, initDocument, shiftNotes } from './commands';
import { notePitch } from './drums';
import { PIANO_KEYS } from './music';
import { DocumentStore } from './store';

function store() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  return s;
}
const add = (s: DocumentStore, trackId: string, string: number, fret: number, start = 0) => {
  const r = addNote(s.getSong(), { trackId, string, fret, start, duration: 240, velocity: 90 });
  s.transact(r.ops);
  return r.id;
};

describe('shiftNotes', () => {
  it('transposes guitar notes on their strings, in time and pitch at once', () => {
    const s = store();
    const a = add(s, DEFAULT_TRACK_ID, 0, 3);
    const b = add(s, DEFAULT_TRACK_ID, 2, 2);
    s.transact(shiftNotes(s.getSong(), [a, b], { ticks: 240, lanes: 0, frets: 2 }));
    expect(s.getSong().notes[a]).toMatchObject({ string: 0, fret: 5, start: 240 });
    expect(s.getSong().notes[b]).toMatchObject({ string: 2, fret: 4, start: 240 });
    s.undo();
    expect(s.getSong().notes[a]).toMatchObject({ fret: 3, start: 0 });
  });

  it('stops the whole group at the fretboard ends, keeping intervals', () => {
    const s = store();
    const a = add(s, DEFAULT_TRACK_ID, 0, 1);
    const b = add(s, DEFAULT_TRACK_ID, 1, 5);
    expect(clampShift(s.getSong(), [a, b], { ticks: -100, lanes: 0, frets: -4 })).toEqual({ ticks: 0, lanes: 0, frets: -1 });
    expect(clampShift(s.getSong(), [a, b], { ticks: 0, lanes: 0, frets: 30 }).frets).toBe(17); // 22 - 5
  });

  it('transposes piano notes by semitones across lanes', () => {
    const s = store();
    const { ops, id } = addTrack(s.getSong(), 'piano');
    s.transact(ops);
    const c = add(s, id, PIANO_KEYS.indexOf(60), 0);
    const e = add(s, id, PIANO_KEYS.indexOf(64), 0);
    s.transact(shiftNotes(s.getSong(), [c, e], { ticks: 0, lanes: -3, frets: 0 })); // up a minor third
    const t = s.getSong().tracks[id];
    expect([c, e].map((n) => notePitch(t, s.getSong().notes[n]))).toEqual([63, 67]);
  });

  it('replaces a note it lands on, but not one that moves along with it', () => {
    const s = store();
    const { ops, id } = addTrack(s.getSong(), 'piano');
    s.transact(ops);
    const low = add(s, id, PIANO_KEYS.indexOf(60), 0);
    const high = add(s, id, PIANO_KEYS.indexOf(62), 0);
    s.transact(shiftNotes(s.getSong(), [low, high], { ticks: 0, lanes: -2, frets: 0 }));
    expect(Object.keys(s.getSong().notes)).toHaveLength(2);
    s.transact(shiftNotes(s.getSong(), [low], { ticks: 0, lanes: -2, frets: 0 })); // onto `high`
    expect(s.getSong().notes[high]).toBeUndefined();
  });

  it('moves drum hits to another kit piece', () => {
    const s = store();
    const { ops, id } = addTrack(s.getSong(), 'drums');
    s.transact(ops);
    const h = add(s, id, 7, 0); // snare
    s.transact(shiftNotes(s.getSong(), [h], { ticks: 0, lanes: 1, frets: 0 }));
    expect(s.getSong().notes[h]).toMatchObject({ string: 8, fret: 0 }); // kick
    expect(clampShift(s.getSong(), [h], { ticks: 0, lanes: 5, frets: 0 }).lanes).toBe(0);
  });
});
