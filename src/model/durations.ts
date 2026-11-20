import type { SongMeta } from './types';

/**
 * Ticks per quarter note. 480 divides cleanly by 3 at every subdivision we
 * offer, so triplets are exact integers (eighth triplet = 160, 32nd triplet = 40).
 */
export const PPQ = 480;

export const BASE_DURATIONS = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond'] as const;
export type BaseDuration = (typeof BASE_DURATIONS)[number];

export const BASE_TICKS: Record<BaseDuration, number> = {
  whole: PPQ * 4,
  half: PPQ * 2,
  quarter: PPQ,
  eighth: PPQ / 2,
  sixteenth: PPQ / 4,
  thirtysecond: PPQ / 8,
};

export const DURATION_LABELS: Record<BaseDuration, string> = {
  whole: '1',
  half: '1/2',
  quarter: '1/4',
  eighth: '1/8',
  sixteenth: '1/16',
  thirtysecond: '1/32',
};

/** Human-readable names, e.g. for the status bar. */
export const DURATION_NAMES: Record<BaseDuration, string> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  sixteenth: '16th',
  thirtysecond: '32nd',
};

/** The next shorter (+1) or longer (-1) note value, clamped at the ends. */
export function stepDuration(base: BaseDuration, direction: 1 | -1): BaseDuration {
  const i = BASE_DURATIONS.indexOf(base) + direction;
  return BASE_DURATIONS[Math.min(BASE_DURATIONS.length - 1, Math.max(0, i))];
}

/** A triplet fits three notes in the space of two. */
export function durationTicks(base: BaseDuration, triplet: boolean): number {
  const t = BASE_TICKS[base];
  return triplet ? (t * 2) / 3 : t;
}

/** Reverse lookup: which base value / triplet flag produces this tick length, if any. */
export function describeDuration(ticks: number): { base: BaseDuration; triplet: boolean } | null {
  for (const base of BASE_DURATIONS) {
    if (BASE_TICKS[base] === ticks) return { base, triplet: false };
    if (durationTicks(base, true) === ticks) return { base, triplet: true };
  }
  return null;
}

export function beatTicks(meta: SongMeta): number {
  return (PPQ * 4) / meta.beatUnit;
}

export function barTicks(meta: SongMeta): number {
  return meta.beatsPerBar * beatTicks(meta);
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

/** Snap down to the nearest multiple of `step`. */
export function snapDown(tick: number, step: number): number {
  return Math.max(0, Math.floor(tick / step) * step);
}
