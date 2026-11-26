/**
 * Arranging the song by bars. Whole-bar edits work across every track at once (reorder, duplicate, insert and
 * delete bars); block edits work on one track's bar at a time (copy, paste, move, duplicate, clear).
 *
 * A note belongs to the bar it starts in and goes wherever that bar goes, keeping its length (so a note ringing
 * over a bar line keeps ringing into whatever bar now follows). Afterwards the one-note-per-lane rule is
 * applied: a note that would ring into the next note on its string, key or drum is cut short.
 */
import type { Op } from './crdt';
import { barTicks } from './durations';
import { notePitch } from './drums';
import { newId } from './id';
import { isStringed } from './instruments';
import { placeClip, type Clip } from './transfer';
import type { ID, Note, Song, Track } from './types';

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
 * Ops that turn the song's notes into `result`: notes missing from it are deleted, notes in `added` are created,
 * and the rest are patched where they changed. First applies the one-note-per-lane rule: a note that runs into
 * the next one on its lane is cut short (or dropped if they start together, the older note giving way).
 */
function commit(song: Song, result: Note[], added: Set<ID>): Op[] {
  const byLane = new Map<string, Note[]>();
  for (const n of result) {
    const k = `${n.trackId}:${n.string}`;
    byLane.set(k, [...(byLane.get(k) ?? []), n]);
  }
  const dropped = new Set<ID>();
  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.start - b.start || Number(added.has(a.id)) - Number(added.has(b.id)));
    for (let i = 0; i + 1 < lane.length; i++) {
      const n = lane[i];
      const next = lane[i + 1];
      if (n.start + n.duration <= next.start) continue;
      if (next.start > n.start) n.duration = next.start - n.start;
      else dropped.add(n.id);
    }
  }

  const ops: Op[] = [];
  const kept = new Set(result.filter((n) => !dropped.has(n.id)).map((n) => n.id));
  for (const id of Object.keys(song.notes)) if (!kept.has(id)) ops.push({ t: 'del', coll: 'notes', id });
  for (const n of result) {
    if (dropped.has(n.id)) continue;
    const { id, ...fields } = n;
    if (added.has(id)) {
      ops.push({ t: 'put', coll: 'notes', id, value: { ...fields } });
      continue;
    }
    const old = song.notes[id];
    const patch: Partial<Note> = {};
    for (const k of ['start', 'duration'] as const) if (old[k] !== n[k]) patch[k] = n[k];
    if (Object.keys(patch).length) ops.push({ t: 'patch', coll: 'notes', id, patch });
  }
  return ops;
}

/**
 * Rebuild the song's bars. `place` says which bars a note starting in bar `b` ends up in: none deletes it, one
 * moves it, several make copies (the original note goes to the first).
 */
function rearrange(song: Song, place: (bar: number) => number[]): Op[] {
  const bar = barTicks(song.meta);
  const result: Note[] = [];
  const added = new Set<ID>();
  for (const n of Object.values(song.notes)) {
    const b = Math.floor(n.start / bar);
    place(b).forEach((target, i) => {
      const start = n.start + (target - b) * bar;
      if (i === 0) {
        result.push({ ...n, start });
      } else {
        const copy = { ...n, id: newId(), start };
        added.add(copy.id);
        result.push(copy);
      }
    });
  }
  return commit(song, result, added);
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

// ---------------------------------------------------------------------------------------------------------------
// Blocks: one track's bar. Copy, paste, move, duplicate and clear work on blocks, so parts can be rearranged
// within a track or carried to another one.

/** One bar of one track. */
export interface Block {
  trackId: ID;
  bar: number;
}

export const blockKey = (b: Block) => `${b.trackId}:${b.bar}`;

/** Copied blocks: their contents (with real pitches) and their layout, relative to the top-left block. */
export interface BlockClip {
  blocks: { row: number; bar: number; clip: Clip }[];
  rows: number;
  bars: number;
}

/** A block's notes as a clip, offsets measured from the start of its bar. */
function blockClip(song: Song, block: Block): Clip {
  const track = song.tracks[block.trackId];
  const bar = barTicks(song.meta);
  const start = block.bar * bar;
  return {
    kind: track.kind,
    tuning: track.tuning,
    notes: Object.values(song.notes)
      .filter((n) => n.trackId === block.trackId && n.start >= start && n.start < start + bar)
      .map((n) => ({
        pitch: notePitch(track, n),
        string: n.string,
        fret: n.fret,
        offset: n.start - start,
        duration: n.duration,
        velocity: n.velocity,
        ...(n.palmMute && { palmMute: true }),
      })),
  };
}

/** Copy blocks. `tracks` is the track order, which gives each block its row. Empty blocks are copied too. */
export function copyBlocks(song: Song, blocks: Block[], tracks: Track[]): BlockClip | null {
  const rowOf = new Map(tracks.map((t, i) => [t.id, i]));
  const live = blocks.filter((b) => rowOf.has(b.trackId) && song.tracks[b.trackId]);
  if (!live.length) return null;
  const rows = live.map((b) => rowOf.get(b.trackId)!);
  const top = Math.min(...rows);
  const left = Math.min(...live.map((b) => b.bar));
  return {
    blocks: live.map((b, i) => ({ row: rows[i] - top, bar: b.bar - left, clip: blockClip(song, b) })),
    rows: Math.max(...rows) - top + 1,
    bars: Math.max(...live.map((b) => b.bar)) - left + 1,
  };
}

export interface BlockPaste {
  ops: Op[];
  /** The blocks that were written to. */
  blocks: Block[];
  /** Blocks left out because the target track can't hold them (drum hits ↔ pitched notes) or doesn't exist. */
  refused: number;
  octaveShifted: number;
  dropped: number;
}

/**
 * Empty the `cleared` blocks, then write `clip` with its top-left block at (`row`, `bar`). Each target block's
 * old contents are replaced; notes are re-placed for the target instrument by pitch, as when pasting notes.
 */
function writeBlocks(
  song: Song,
  tracks: Track[],
  cleared: Block[],
  clip: BlockClip | null,
  row = 0,
  bar = 0,
): BlockPaste {
  const barLen = barTicks(song.meta);
  const out: BlockPaste = { ops: [], blocks: [], refused: 0, octaveShifted: 0, dropped: 0 };
  const placed: Note[] = [];
  const empty = new Set(cleared.map(blockKey));
  for (const b of clip?.blocks ?? []) {
    const track = tracks[row + b.row];
    const target = bar + b.bar;
    if (!track || target < 0) {
      out.refused++;
      continue;
    }
    const placement = placeClip(b.clip, track);
    if (placement.refused) {
      out.refused++;
      continue;
    }
    const block = { trackId: track.id, bar: target };
    empty.add(blockKey(block));
    out.blocks.push(block);
    out.octaveShifted += placement.octaveShifted;
    out.dropped += placement.dropped;
    for (const c of placement.notes) {
      placed.push({
        id: newId(),
        trackId: track.id,
        string: c.string,
        fret: c.fret,
        start: target * barLen + c.offset,
        duration: c.duration,
        velocity: c.velocity,
        ...(c.palmMute && isStringed(track.kind) && { palmMute: true }),
      });
    }
  }
  const keep = Object.values(song.notes)
    .filter((n) => !empty.has(blockKey({ trackId: n.trackId, bar: Math.floor(n.start / barLen) })))
    .map((n) => ({ ...n }));
  out.ops = commit(song, [...keep, ...placed], new Set(placed.map((n) => n.id)));
  return out;
}

/** Paste copied blocks with their top-left block at track `row` (in `tracks`), bar `bar`, replacing what's there. */
export function pasteBlocks(song: Song, tracks: Track[], clip: BlockClip, row: number, bar: number): BlockPaste {
  return writeBlocks(song, tracks, [], clip, row, bar);
}

/** Empty blocks (their notes are deleted; the bars stay). */
export function clearBlocks(song: Song, blocks: Block[]): Op[] {
  return writeBlocks(song, [], blocks, null).ops;
}

/**
 * Move blocks `rows` tracks down and `bars` bars later, replacing what's at the destination and leaving the
 * originals empty. With `copy`, the originals stay.
 */
export function moveBlocks(
  song: Song,
  tracks: Track[],
  blocks: Block[],
  rows: number,
  bars: number,
  copy = false,
): BlockPaste {
  const clip = copyBlocks(song, blocks, tracks);
  if (!clip) return { ops: [], blocks: [], refused: 0, octaveShifted: 0, dropped: 0 };
  const rowOf = new Map(tracks.map((t, i) => [t.id, i]));
  const top = Math.min(...blocks.filter((b) => rowOf.has(b.trackId)).map((b) => rowOf.get(b.trackId)!));
  const left = Math.min(...blocks.map((b) => b.bar));
  return writeBlocks(song, tracks, copy ? [] : blocks, clip, top + rows, left + bars);
}

/** Repeat blocks straight after themselves (after the last bar they span), replacing what's there. */
export function duplicateBlocks(song: Song, tracks: Track[], blocks: Block[]): BlockPaste {
  const span = Math.max(...blocks.map((b) => b.bar)) - Math.min(...blocks.map((b) => b.bar)) + 1;
  return moveBlocks(song, tracks, blocks, 0, span, true);
}
