import { describe, expect, it } from 'vitest';
import { dueUntil } from '../audio/player';
import { addNote, addTrack, DEFAULT_TRACK_ID, initDocument, setTrackProgram } from '../model/commands';
import { DocumentStore } from '../model/store';
import type { Note } from '../model/types';
import { DRUM_CHANNEL, panValue, trackChannels } from './channels';
import { exportMidi } from './export';

function songWithTracks() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  const drums = addTrack(s.getSong(), 'drums');
  s.transact(drums.ops);
  const gtr2 = addTrack(s.getSong(), 'guitar');
  s.transact(gtr2.ops);
  return { s, drumsId: drums.id, gtr2Id: gtr2.id };
}

describe('trackChannels', () => {
  it('puts drums on channel 10 and each guitar on its own channel', () => {
    const { s, drumsId, gtr2Id } = songWithTracks();
    const ch = trackChannels(s.getSong());
    expect(ch.get(drumsId)).toBe(DRUM_CHANNEL);
    expect(ch.get(DEFAULT_TRACK_ID)).toBe(0);
    expect(ch.get(gtr2Id)).toBe(2);
  });

  it('export uses the same channels as playback', () => {
    const { s, gtr2Id } = songWithTracks();
    s.transact(addNote(s.getSong(), { trackId: gtr2Id, string: 0, fret: 0, start: 0, duration: 240, velocity: 90 }).ops);
    const bytes = [...exportMidi(s.getSong())];
    expect(bytes.some((b, i) => b === (0x90 | 2) && bytes[i + 1] === 64)).toBe(true);
  });

  it('exports the chosen instrument and drum kit', () => {
    const { s, drumsId } = songWithTracks();
    s.transact(setTrackProgram(DEFAULT_TRACK_ID, 29)); // overdrive
    s.transact(setTrackProgram(drumsId, 40)); // brush kit
    const bytes = [...exportMidi(s.getSong())];
    expect(bytes.some((b, i) => b === 0xc0 && bytes[i + 1] === 29)).toBe(true);
    expect(bytes.some((b, i) => b === 0xc9 && bytes[i + 1] === 40)).toBe(true);
  });
});

describe('dueUntil', () => {
  const n = (start: number) => ({ start }) as Note;
  it('returns the index after the last note starting before the horizon', () => {
    const notes = [n(0), n(120), n(240), n(480)];
    expect(dueUntil(notes, 0, 0)).toBe(0);
    expect(dueUntil(notes, 0, 121)).toBe(2);
    expect(dueUntil(notes, 2, 1000)).toBe(4);
  });
});

describe('panValue', () => {
  it('maps -1..1 onto MIDI pan, with centre at 64', () => {
    expect(panValue(-1)).toBe(0);
    expect(panValue(0)).toBe(64);
    expect(panValue(1)).toBe(127);
    expect(panValue(-0.5)).toBe(32);
  });
});
