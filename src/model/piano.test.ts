import { describe, expect, it } from 'vitest';
import { exportMidi } from '../midi/export';
import { addNote, addTrack, initDocument, moveToString } from './commands';
import { laneLabel, notePitch } from './drums';
import { TRACK_KINDS } from './instruments';
import { PIANO_ROLL_MIN_ROWS, visibleLanes } from './lanes';
import { isBlackKey, MIDDLE_C, PIANO_KEYS } from './music';
import { DocumentStore } from './store';

function pianoSong() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  const { ops, id } = addTrack(s.getSong(), 'piano');
  s.transact(ops);
  return { s, id };
}

const lane = (pitch: number) => PIANO_KEYS.indexOf(pitch);
const note = (trackId: string, pitch: number, start = 0) => ({
  trackId,
  string: lane(pitch),
  fret: 0,
  start,
  duration: 480,
  velocity: 90,
});

describe('piano tracks', () => {
  it('have 88 keys from C8 down to A0, starting at middle C', () => {
    const { s, id } = pianoSong();
    const t = s.getSong().tracks[id];
    expect(t).toMatchObject({ kind: 'piano', name: 'Piano', frets: 0, program: 0 });
    expect(t.tuning).toHaveLength(88);
    expect([t.tuning[0], t.tuning[87]]).toEqual([108, 21]);
    expect(t.tuning[TRACK_KINDS.piano.homeLane]).toBe(MIDDLE_C);
    expect(laneLabel(t, lane(60))).toBe('C4');
    expect([61, 63, 66, 68, 70].every(isBlackKey)).toBe(true);
    expect([60, 62, 64, 65, 67, 69, 71].some(isBlackKey)).toBe(false);
  });

  it('plays chords: notes on different keys at the same time coexist', () => {
    const { s, id } = pianoSong();
    for (const p of [60, 64, 67]) s.transact(addNote(s.getSong(), note(id, p)).ops);
    const t = s.getSong().tracks[id];
    const pitches = Object.values(s.getSong().notes).map((n) => notePitch(t, n));
    expect(pitches.sort()).toEqual([60, 64, 67]);
  });

  it('moves notes by semitones and octaves', () => {
    const { s, id } = pianoSong();
    const n = addNote(s.getSong(), note(id, 60));
    s.transact(n.ops);
    s.transact(moveToString(s.getSong(), [n.id], -1)); // up a semitone
    s.transact(moveToString(s.getSong(), [n.id], -12)); // up an octave
    const t = s.getSong().tracks[id];
    expect(notePitch(t, s.getSong().notes[n.id])).toBe(73);
    expect(s.getSong().notes[n.id].fret).toBe(0);
  });

  it('exports on its own channel even in the per-string layout', () => {
    const { s, id } = pianoSong();
    s.transact(addNote(s.getSong(), note(id, 72)).ops);
    const bytes = [...exportMidi(s.getSong(), 'per-string')];
    expect(bytes.some((b, i) => b === 0x91 && bytes[i + 1] === 72)).toBe(true); // channel 2: second track
    expect(bytes.some((b, i) => b === 0xc1 && bytes[i + 1] === 0)).toBe(true); // grand piano
  });
});

describe('visibleLanes', () => {
  it('shows every lane for stringed and drum tracks', () => {
    expect(visibleLanes('guitar', 6, [0])).toEqual([0, 6]);
    expect(visibleLanes('drums', 9, [3])).toEqual([0, 9]);
  });

  it('shows at least two octaves around the piano notes and cursor', () => {
    const [start, count] = visibleLanes('piano', 88, [lane(60)]);
    expect(count).toBe(PIANO_ROLL_MIN_ROWS);
    expect(start).toBeLessThanOrEqual(lane(60));
    expect(start + count).toBeGreaterThan(lane(60));
  });

  it('grows to cover a wide range with a margin, clamped to the keyboard', () => {
    expect(visibleLanes('piano', 88, [lane(96), lane(36)])).toEqual([lane(96) - 2, lane(36) - lane(96) + 5]);
    const [start, count] = visibleLanes('piano', 88, [lane(108)]);
    expect(start).toBe(0);
    expect(count).toBe(PIANO_ROLL_MIN_ROWS);
    const [s2, c2] = visibleLanes('piano', 88, [lane(21)]);
    expect(s2 + c2).toBe(88);
  });
});
