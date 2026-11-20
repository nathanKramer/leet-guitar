import type { TrackKind } from './types';

/** Fewest rows a piano roll shows: two octaves plus one. */
export const PIANO_ROLL_MIN_ROWS = 25;
const PIANO_ROLL_MARGIN = 2;

/**
 * The lanes (rows) the timeline shows for a track, as [first, count].
 * Guitar, bass and drums show every lane. Piano shows only the range in use (its notes and
 * the cursor key, plus a small margin), at least two octaves, so it never needs 88 rows.
 */
export function visibleLanes(kind: TrackKind, laneTotal: number, usedLanes: number[]): [number, number] {
  if (kind !== 'piano' || laneTotal <= PIANO_ROLL_MIN_ROWS) return [0, laneTotal];
  let lo = Math.min(...usedLanes) - PIANO_ROLL_MARGIN;
  let hi = Math.max(...usedLanes) + PIANO_ROLL_MARGIN;
  const short = PIANO_ROLL_MIN_ROWS - (hi - lo + 1);
  if (short > 0) {
    lo -= Math.floor(short / 2);
    hi += Math.ceil(short / 2);
  }
  // Slide back inside the keyboard if we ran off either end.
  if (lo < 0) (hi -= lo), (lo = 0);
  if (hi > laneTotal - 1) (lo -= hi - (laneTotal - 1)), (hi = laneTotal - 1);
  lo = Math.max(0, lo);
  return [lo, hi - lo + 1];
}
