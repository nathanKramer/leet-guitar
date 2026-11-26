import { beatTicks, ticksToSeconds } from '../model/durations';
import type { SongMeta } from '../model/types';
import { audio } from './context';

export interface Click {
  /** Seconds after the count-in starts. */
  at: number;
  /** The first beat of the bar, played higher. */
  accent: boolean;
}

/** One bar of clicks in the song's time signature and tempo (7/8 counts seven eighths). */
export function countInClicks(meta: SongMeta): { clicks: Click[]; beatSeconds: number; seconds: number } {
  const beatSeconds = ticksToSeconds(beatTicks(meta), meta.bpm);
  const clicks = Array.from({ length: meta.beatsPerBar }, (_, i) => ({ at: i * beatSeconds, accent: i === 0 }));
  return { clicks, beatSeconds, seconds: meta.beatsPerBar * beatSeconds };
}

/**
 * Schedule metronome clicks starting at AudioContext time `start`. Synthesised here rather than by the sound
 * engine, so they sound the same whichever engine is playing. Returns a function that silences any not yet heard.
 */
export function scheduleClicks(clicks: Click[], start: number): () => void {
  const { ctx, master } = audio();
  const oscs = clicks.map(({ at, accent }) => {
    const when = start + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.6, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + 0.07);
    return osc;
  });
  return () => {
    for (const osc of oscs) {
      try {
        osc.stop();
      } catch {
        // Already finished.
      }
    }
  };
}
