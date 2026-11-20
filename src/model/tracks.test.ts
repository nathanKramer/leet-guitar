import { describe, expect, it } from 'vitest';
import { exportMidi } from '../midi/export';
import { addNote, addTrack, DEFAULT_TRACK_ID, deleteTrack, initDocument, moveToString, sortedTracks } from './commands';
import { DRUM_KIT, laneLabel } from './drums';
import { STANDARD_BASS_TUNING } from './music';
import { DocumentStore } from './store';

function newStore() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  return s;
}

const hit = (trackId: string, lane: number, start: number) => ({
  trackId,
  string: lane,
  fret: 0,
  start,
  duration: 240,
  velocity: 100,
});

describe('tracks', () => {
  it('existing documents without a kind load as guitar', () => {
    expect(newStore().getSong().tracks[DEFAULT_TRACK_ID].kind).toBe('guitar');
  });

  it('adds a drum track after existing tracks', () => {
    const s = newStore();
    const { ops, id } = addTrack(s.getSong(), 'drums');
    s.transact(ops);
    const tracks = sortedTracks(s.getSong());
    expect(tracks.map((t) => t.kind)).toEqual(['guitar', 'drums']);
    expect(s.getSong().tracks[id]).toMatchObject({ name: 'Drums', tuning: DRUM_KIT, frets: 0 });
    const second = addTrack(s.getSong(), 'drums');
    s.transact(second.ops);
    expect(s.getSong().tracks[second.id].name).toBe('Drums 2');
  });

  it('deleting a track removes its notes, and undo restores both', () => {
    const s = newStore();
    const { ops, id } = addTrack(s.getSong(), 'drums');
    s.transact(ops);
    s.transact(addNote(s.getSong(), hit(id, 8, 0)).ops);
    s.transact(addNote(s.getSong(), hit(DEFAULT_TRACK_ID, 0, 0)).ops);
    s.transact(deleteTrack(s.getSong(), id));
    expect(s.getSong().tracks[id]).toBeUndefined();
    expect(Object.values(s.getSong().notes).map((n) => n.trackId)).toEqual([DEFAULT_TRACK_ID]);
    s.undo();
    expect(s.getSong().tracks[id]).toBeDefined();
    expect(Object.keys(s.getSong().notes)).toHaveLength(2);
  });

  it('moving a drum hit to another lane changes the kit piece', () => {
    const s = newStore();
    const { ops, id } = addTrack(s.getSong(), 'drums');
    s.transact(ops);
    const h = addNote(s.getSong(), hit(id, 7, 0)); // snare
    s.transact(h.ops);
    s.transact(moveToString(s.getSong(), [h.id], 1));
    expect(s.getSong().notes[h.id]).toMatchObject({ string: 8, fret: 0 }); // kick
  });

  it('exports drum hits on channel 10 without a program change', () => {
    const s = newStore();
    const { ops, id } = addTrack(s.getSong(), 'drums');
    s.transact(ops);
    s.transact(addNote(s.getSong(), hit(id, 8, 0)).ops); // kick = 36
    const bytes = [...exportMidi(s.getSong())];
    const noteOn = bytes.findIndex((b, i) => b === 0x99 && bytes[i + 1] === 36);
    expect(noteOn).toBeGreaterThan(0);
    expect(bytes).not.toContain(0xc9);
  });

  it('adds a 4-string bass track with bass defaults', () => {
    const s = newStore();
    const { ops, id } = addTrack(s.getSong(), 'bass');
    s.transact(ops);
    const bass = s.getSong().tracks[id];
    expect(bass).toMatchObject({ kind: 'bass', name: 'Bass', tuning: STANDARD_BASS_TUNING, frets: 24, program: 33 });
    expect(bass.tuning.map((_, i) => laneLabel(bass, i))).toEqual(['G', 'D', 'A', 'E']);
  });

  it('moves bass notes across strings keeping pitch, and exports them with the bass program', () => {
    const s = newStore();
    const { ops, id } = addTrack(s.getSong(), 'bass');
    s.transact(ops);
    const n = addNote(s.getSong(), { trackId: id, string: 3, fret: 7, start: 0, duration: 480, velocity: 100 }); // B1
    s.transact(n.ops);
    s.transact(moveToString(s.getSong(), [n.id], -1));
    expect(s.getSong().notes[n.id]).toMatchObject({ string: 2, fret: 2 }); // A string, fret 2 = B1
    const bytes = [...exportMidi(s.getSong())];
    const ch = 1; // second track, first melodic channel after the guitar
    expect(bytes.some((b, i) => b === (0xc0 | ch) && bytes[i + 1] === 33)).toBe(true);
    expect(bytes.some((b, i) => b === (0x90 | ch) && bytes[i + 1] === 35)).toBe(true);
  });
});
