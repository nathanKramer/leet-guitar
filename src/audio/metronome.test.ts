import { describe, expect, it } from 'vitest';
import { countInClicks } from './metronome';

describe('count-in', () => {
  it('counts one bar of quarter notes in 4/4', () => {
    const { clicks, beatSeconds, seconds } = countInClicks({ title: '', bpm: 120, beatsPerBar: 4, beatUnit: 4 });
    expect(beatSeconds).toBe(0.5);
    expect(seconds).toBe(2);
    expect(clicks.map((c) => c.at)).toEqual([0, 0.5, 1, 1.5]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it('counts the beat unit of the time signature', () => {
    const { clicks, beatSeconds } = countInClicks({ title: '', bpm: 120, beatsPerBar: 7, beatUnit: 8 });
    expect(clicks).toHaveLength(7);
    expect(beatSeconds).toBe(0.25);
  });
});
