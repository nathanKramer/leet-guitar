import { sortedTracks } from '../model/commands';
import type { ID, Song } from '../model/types';

/**
 * How a panned track differs from the others in playback, like two takes of the same part.
 * Identical signals in both speakers are heard as one sound in the centre, so two tracks playing the same
 * notes panned apart would collapse to mono. A few milliseconds of delay and a few cents of detune make them
 * different enough to be heard as two.
 */
export interface Spread {
  /** Seconds added to every note's start. */
  delay: number;
  /** Detune in cents. */
  cents: number;
}

export const NO_SPREAD: Spread = { delay: 0, cents: 0 };

const DELAY_STEP_S = 0.007;
const CENTS = [-4, 4, 0];

/** The spread of each panned track. Centred tracks are left as they are (absent from the map). */
export function trackSpread(song: Song): Map<ID, Spread> {
  const map = new Map<ID, Spread>();
  // Neighbouring panned tracks (the usual double-tracked pair) always get different delays and detunes.
  sortedTracks(song)
    .filter((t) => t.pan !== 0)
    .forEach((t, k) => map.set(t.id, { delay: (k % 4) * DELAY_STEP_S, cents: CENTS[k % CENTS.length] }));
  return map;
}
