import type { TimeSig } from './types';

/**
 * Ticks per quarter note. 480 divides cleanly by 3 at every subdivision we
 * offer, so triplets are exact integers (eighth triplet = 160, 32nd triplet = 40), and by 2 at every one, so
 * dotted notes are too (dotted 32nd = 90).
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

/**
 * A triplet fits three notes in the space of two; a dotted note lasts one and a half times as long. A note is one
 * or the other, never both (triplet wins if both are passed).
 */
export function durationTicks(base: BaseDuration, triplet: boolean, dotted = false): number {
  const t = BASE_TICKS[base];
  return triplet ? (t * 2) / 3 : dotted ? (t * 3) / 2 : t;
}

export interface NoteValue {
  base: BaseDuration;
  triplet: boolean;
  dotted: boolean;
}

/** Reverse lookup: which note value produces this tick length, if any. */
export function describeDuration(ticks: number): NoteValue | null {
  for (const base of BASE_DURATIONS) {
    if (BASE_TICKS[base] === ticks) return { base, triplet: false, dotted: false };
    if (durationTicks(base, true) === ticks) return { base, triplet: true, dotted: false };
    if (durationTicks(base, false, true) === ticks) return { base, triplet: false, dotted: true };
  }
  return null;
}

/** E.g. "dotted quarter", "eighth triplet". */
export function describeNoteValue({ base, triplet, dotted }: NoteValue): string {
  return `${dotted ? 'dotted ' : ''}${DURATION_NAMES[base]}${triplet ? ' triplet' : ''}`;
}

export function beatTicks(meta: TimeSig): number {
  return (PPQ * 4) / meta.beatUnit;
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

/** Snap down to the nearest multiple of `step`. */
export function snapDown(tick: number, step: number): number {
  return Math.max(0, Math.floor(tick / step) * step);
}
