import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_ID } from '../model/commands';
import { PPQ } from '../model/durations';
import { STANDARD_TUNING } from '../model/music';
import type { Song } from '../model/types';
import { exportMidi, vlq } from './export';

const song: Song = {
  meta: { title: 'T', bpm: 120, beatsPerBar: 4, beatUnit: 4 },
  tracks: {
    [DEFAULT_TRACK_ID]: { id: DEFAULT_TRACK_ID, kind: 'guitar', name: 'Gtr', tuning: STANDARD_TUNING, frets: 22, program: 25, bank: 0, pan: 0, order: 0 },
  },
  notes: {
    a: { id: 'a', trackId: DEFAULT_TRACK_ID, string: 5, fret: 0, start: 0, duration: 160, velocity: 100 },
    b: { id: 'b', trackId: DEFAULT_TRACK_ID, string: 0, fret: 3, start: 160, duration: 160, velocity: 100 },
  },
  patterns: {},
  timeSigs: {},
};

describe('vlq', () => {
  it('encodes per the SMF spec', () => {
    expect(vlq(0)).toEqual([0x00]);
    expect(vlq(0x7f)).toEqual([0x7f]);
    expect(vlq(0x80)).toEqual([0x81, 0x00]);
    expect(vlq(0x3fff)).toEqual([0xff, 0x7f]);
    expect(vlq(0x200000)).toEqual([0x81, 0x80, 0x80, 0x00]);
  });
});

describe('exportMidi', () => {
  it('writes a format-1 header with conductor + one track at PPQ', () => {
    const bytes = exportMidi(song);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    expect([...bytes.slice(8, 14)]).toEqual([0, 1, 0, 2, PPQ >> 8, PPQ & 0xff]);
  });

  it('emits note on/off with triplet timing and correct pitches', () => {
    const bytes = [...exportMidi(song)];
    const ons = findAll(bytes, (i) => bytes[i] === 0x90 && bytes[i + 2] === 100).map((i) => bytes[i + 1]);
    expect(ons).toEqual([40, 67]); // low E open, high E fret 3 = G4
  });

  it('writes pan (CC 10) only for off-centre tracks', () => {
    const cc10 = (bytes: number[]) => findAll(bytes, (i) => bytes[i] === 0xb0 && bytes[i + 1] === 10).map((i) => bytes[i + 2]);
    expect(cc10([...exportMidi(song)])).toEqual([]);
    const panned = { ...song, tracks: { [DEFAULT_TRACK_ID]: { ...song.tracks[DEFAULT_TRACK_ID], pan: -1 } } };
    expect(cc10([...exportMidi(panned)])).toEqual([0]);
  });

  it('assigns a channel per string when asked', () => {
    const bytes = [...exportMidi(song, 'per-string')];
    expect(bytes).toContain(0x95); // note-on, channel 6 (low E string)
    expect(bytes).toContain(0x90); // note-on, channel 1 (high E string)
  });
});

function findAll(bytes: number[], pred: (i: number) => boolean) {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) if (pred(i)) out.push(i);
  return out;
}
