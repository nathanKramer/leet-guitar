/**
 * Arranging the song by whole bars, across every track at once: move, duplicate, insert and delete bars.
 *
 * A note belongs to the bar it starts in and goes wherever that bar goes, keeping its length (so a note ringing
 * over a bar line keeps ringing into whatever bar now follows). Afterwards the one-note-per-lane rule is
 * applied: a note that would ring into the next note on its string, key or drum is cut short.
 */
import type { Op } from './crdt';
import { barTicks } from './durations';
import { newId } from './id';
import type { ID, Note, Song } from './types';

/** A run of bars, numbered from 0: [first, first + count). */
export interface BarRange {
  first: number;
  count: number;
}

export const barOf = (song: Song, tick: number) => Math.floor(tick / barTicks(song.meta));

/** Bars that hold a note (its start), counting from 0; 0 for an empty song. */
export function usedBars(song: Song): number {
  let last = -1;
  for (const n of Object.values(song.notes)) last = Math.max(last, barOf(song, n.start));
  return last + 1;
}

/**
 * Where `range` lands when moved to just before bar `to` (numbered as before the move), or null if that
 * leaves it where it is.
 */
export function movedTo(range: BarRange, to: number): number | null {
  if (to >= range.first && to <= range.first + range.count) return null;
  return to < range.first ? to : to - range.count;
}

/**
 * Rebuild the song's bars. `place` says which bars a note starting in bar `b` ends up in: none deletes it, one
 * moves it, several make copies (the original note goes to the first).
 */
function rearrange(song: Song, place: (bar: number) => number[]): Op[] {
  const bar = barTicks(song.meta);
  const ops: Op[] = [];
  const result: Note[] = [];
  const isNew = new Set<ID>();
  for (const n of Object.values(song.notes)) {
    const b = Math.floor(n.start / bar);
    const targets = place(b);
    if (!targets.length) {
      ops.push({ t: 'del', coll: 'notes', id: n.id });
      continue;
    }
    targets.forEach((target, i) => {
      const start = n.start + (target - b) * bar;
      if (i === 0) {
        result.push({ ...n, start });
      } else {
        const copy = { ...n, id: newId(), start };
        isNew.add(copy.id);
        result.push(copy);
      }
    });
  }

  // One note per lane: trim (or, if it would vanish, drop) a note that runs into the next one.
  const byLane = new Map<string, Note[]>();
  for (const n of result) {
    const k = `${n.trackId}:${n.string}`;
    byLane.set(k, [...(byLane.get(k) ?? []), n]);
  }
  const dropped = new Set<ID>();
  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < lane.length; i++) {
      const n = lane[i];
      const next = lane[i + 1];
      if (n.start + n.duration <= next.start) continue;
      if (next.start > n.start) n.duration = next.start - n.start;
      else dropped.add(n.id);
    }
  }

  for (const n of result) {
    const { id, ...fields } = n;
    if (dropped.has(id)) {
      if (!isNew.has(id)) ops.push({ t: 'del', coll: 'notes', id });
    } else if (isNew.has(id)) {
      ops.push({ t: 'put', coll: 'notes', id, value: { ...fields } });
    } else {
      const old = song.notes[id];
      const patch: Partial<Note> = {};
      if (old.start !== n.start) patch.start = n.start;
      if (old.duration !== n.duration) patch.duration = n.duration;
      if (Object.keys(patch).length) ops.push({ t: 'patch', coll: 'notes', id, patch });
    }
  }
  return ops;
}

/** Move `range` to just before bar `to`; the bars in between close up behind it. */
export function moveBars(song: Song, range: BarRange, to: number): Op[] {
  const dest = movedTo(range, to);
  if (dest === null) return [];
  const { first, count } = range;
  const end = first + count;
  return rearrange(song, (b) => {
    if (b >= first && b < end) return [dest + (b - first)];
    if (to < first && b >= to && b < first) return [b + count];
    if (to > end && b >= end && b < to) return [b - count];
    return [b];
  });
}

/** Repeat `range` straight after itself, pushing later bars along. */
export function duplicateBars(song: Song, range: BarRange): Op[] {
  const { first, count } = range;
  const end = first + count;
  return rearrange(song, (b) => (b < first ? [b] : b < end ? [b, b + count] : [b + count]));
}

/** Insert `count` empty bars before bar `at`. */
export function insertBars(song: Song, at: number, count = 1): Op[] {
  return rearrange(song, (b) => [b < at ? b : b + count]);
}

/** Delete the bars in `range` (in every track); later bars move back to fill the gap. */
export function deleteBars(song: Song, range: BarRange): Op[] {
  const { first, count } = range;
  const end = first + count;
  return rearrange(song, (b) => (b < first ? [b] : b < end ? [] : [b - count]));
}
