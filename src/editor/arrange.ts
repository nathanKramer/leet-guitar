/**
 * Actions for the arrangement view. The unit is a block: one track's bar. Copy, paste, move, duplicate and clear
 * work on blocks; when whole bars are selected (every track), dragging reorders the bars instead, and inserting or
 * removing bars always works on whole bars.
 */
import * as arrange from '../model/arrange';
import type { BarRange, Block, BlockClip, BlockPaste } from '../model/arrange';
import { sortedTracks } from '../model/commands';
import { TRACK_KINDS } from '../model/instruments';
import { meter } from '../model/meter';
import type { ID } from '../model/types';
import { docStore, editor } from '../session';
import { notify } from './actions';
import type { ArrangeSelection } from './editorStore';

const song = () => docStore.getSong();
const tracks = () => sortedTracks(song());
const barStart = (bar: number) => meter(song()).barStart(bar);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

let clipboard: BlockClip | null = null;

/** Selected blocks whose track still exists. */
export function selectedBlocks(sel: ArrangeSelection = editor.get().arrSel): Block[] {
  const s = song();
  return sel.blocks.filter((b) => s.tracks[b.trackId]);
}

/** Every block from `a` to `b` (a rectangle of tracks × bars, in track-list order). */
export function blockRect(a: Block, b: Block): Block[] {
  const ts = tracks();
  const ra = ts.findIndex((t) => t.id === a.trackId);
  const rb = ts.findIndex((t) => t.id === b.trackId);
  if (ra < 0 || rb < 0) return [];
  const out: Block[] = [];
  for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) {
    for (let bar = Math.min(a.bar, b.bar); bar <= Math.max(a.bar, b.bar); bar++) out.push({ trackId: ts[r].id, bar });
  }
  return out;
}

/** The bars covered when every track is selected in a run of bars, else null. */
export function wholeBars(blocks: Block[] = selectedBlocks()): BarRange | null {
  if (!blocks.length) return null;
  const ts = tracks();
  const keys = new Set(blocks.map(arrange.blockKey));
  const first = Math.min(...blocks.map((b) => b.bar));
  const last = Math.max(...blocks.map((b) => b.bar));
  if (keys.size !== ts.length * (last - first + 1)) return null;
  for (let bar = first; bar <= last; bar++) {
    if (!ts.every((t) => keys.has(arrange.blockKey({ trackId: t.id, bar })))) return null;
  }
  return { first, count: last - first + 1 };
}

/** The bars a selection spans, first to last. */
function spannedBars(blocks: Block[]): BarRange | null {
  if (!blocks.length) return null;
  const first = Math.min(...blocks.map((b) => b.bar));
  return { first, count: Math.max(...blocks.map((b) => b.bar)) - first + 1 };
}

/**
 * The bars a time signature change applies to. In the arrangement, the bars the selection spans (later bars keep
 * their own); otherwise the cursor's bar, up to the next change.
 */
export function timeSigBars(s = editor.get()): { first: number; last?: number } {
  const span = s.view === 'arrange' ? spannedBars(selectedBlocks(s.arrSel)) : null;
  if (span) return { first: span.first, last: span.first + span.count - 1 };
  return { first: arrange.barOf(song(), s.cursor) };
}

/**
 * Set the selection. The cursor goes to the start of its first bar (so Space plays from there) and the focused
 * block's track becomes the active track.
 */
export function setSelection(blocks: Block[], anchor: Block | null, focus: Block | null = anchor) {
  const seen = new Set<string>();
  const unique = blocks.filter((b) => {
    const k = arrange.blockKey(b);
    return !seen.has(k) && !!seen.add(k);
  });
  const first = unique.length ? Math.min(...unique.map((b) => b.bar)) : null;
  const s = editor.get();
  const track = focus && song().tracks[focus.trackId];
  const switching = !!track && track.id !== s.trackId;
  editor.set({
    arrSel: { blocks: unique, anchor, focus },
    ...(first !== null && { cursor: barStart(first) }),
    ...(switching && { trackId: track.id, selection: [], cursorString: TRACK_KINDS[track.kind].homeLane }),
  });
}

export const clearSelection = () => setSelection([], null);

export function setView(view: 'edit' | 'arrange') {
  const s = editor.get();
  if (view === 'arrange' && !selectedBlocks().length && song().tracks[s.trackId]) {
    const block = { trackId: s.trackId, bar: arrange.barOf(song(), s.cursor) };
    editor.set({ view });
    setSelection([block], block);
  } else {
    editor.set({ view });
  }
}

/** Shift-click: add a block to the selection, or take it out if it's already in. */
export function toggleBlock(block: Block) {
  const blocks = selectedBlocks();
  const k = arrange.blockKey(block);
  const has = blocks.some((b) => arrange.blockKey(b) === k);
  setSelection(has ? blocks.filter((b) => arrange.blockKey(b) !== k) : [...blocks, block], block);
}

/** Select whole bars `from`..`to` (every track), optionally adding them to `base`. */
export function selectBars(from: number, to: number, base: Block[] = []) {
  const ts = tracks();
  if (!ts.length) return;
  const anchor = { trackId: ts[0].id, bar: from };
  const rect = blockRect(anchor, { trackId: ts[ts.length - 1].id, bar: to });
  setSelection([...base, ...rect], anchor, { trackId: ts[0].id, bar: to });
}

/** ←/→/↑/↓: select the neighbouring block; with `extend`, grow the selection as a rectangle from the anchor. */
export function stepSelection(dBars: number, dRows: number, extend = false) {
  const ts = tracks();
  const { focus, anchor } = editor.get().arrSel;
  const fallback = { trackId: editor.get().trackId, bar: 0 };
  const from = focus && song().tracks[focus.trackId] ? focus : fallback;
  const row = Math.min(ts.length - 1, Math.max(0, ts.findIndex((t) => t.id === from.trackId) + dRows));
  const next = { trackId: ts[row].id, bar: Math.max(0, from.bar + dBars) };
  if (extend) {
    const a = anchor && song().tracks[anchor.trackId] ? anchor : from;
    setSelection(blockRect(a, next), a, next);
  } else {
    setSelection([next], next);
  }
}

export function selectAll() {
  const ts = tracks();
  const bars = Math.max(1, arrange.usedBars(song()));
  if (ts.length) selectBars(0, bars - 1);
}

/** Report what a paste or move couldn't do as asked. */
function report(r: BlockPaste, verb: string) {
  const issues = [
    r.refused && `${plural(r.refused, 'block')} left out (drum hits and pitched notes don't mix, or no track there)`,
    r.octaveShifted && `${plural(r.octaveShifted, 'note')} moved by an octave to fit`,
    r.dropped && `${plural(r.dropped, 'note')} left out (no room)`,
  ].filter(Boolean);
  if (!issues.length) return;
  const what = r.blocks.length ? `${verb} ${plural(r.blocks.length, 'block')}` : `Nothing ${verb.toLowerCase()}`;
  notify(`${what}: ${issues.join('; ')}.`);
}

/** Write a block edit and select the blocks it wrote to. */
function applyBlocks(r: BlockPaste, verb: string) {
  if (!r.blocks.length) {
    report(r, verb);
    return;
  }
  docStore.transact(r.ops);
  setSelection(r.blocks, r.blocks[0], r.blocks[r.blocks.length - 1]);
  report(r, verb);
}

/** How far the selection can move: keeps every block on a real track and at or after bar 1. */
export function clampMove(dRows: number, dBars: number, blocks: Block[] = selectedBlocks()) {
  const ts = tracks();
  const rows = blocks.map((b) => ts.findIndex((t) => t.id === b.trackId)).filter((r) => r >= 0);
  if (!rows.length) return { rows: 0, bars: 0 };
  return {
    rows: Math.min(Math.max(dRows, -Math.min(...rows)), ts.length - 1 - Math.max(...rows)),
    bars: Math.max(dBars, -Math.min(...blocks.map((b) => b.bar))),
  };
}

/** Move (or with `copy`, copy) the selected blocks, replacing what's at the destination. */
export function moveBlocksBy(dRows: number, dBars: number, copy = false) {
  const blocks = selectedBlocks();
  const { rows, bars } = clampMove(dRows, dBars, blocks);
  if (!blocks.length || (!rows && !bars)) return;
  applyBlocks(arrange.moveBlocks(song(), tracks(), blocks, rows, bars, copy), copy ? 'Copied' : 'Moved');
}

/** Move whole selected bars to just before bar `to` (numbered as before the move); the rest close up. */
export function reorderBars(to: number) {
  const range = wholeBars();
  if (!range) return;
  const dest = arrange.movedTo(range, to);
  if (dest === null) return;
  docStore.transact(arrange.moveBars(song(), range, to));
  selectBars(dest, dest + range.count - 1);
}

/** Alt+←/→: whole bars swap places with their neighbour; other blocks move a bar, replacing what's there. */
export function nudge(dir: 1 | -1) {
  const range = wholeBars();
  if (range) {
    if (dir < 0 && range.first > 0) reorderBars(range.first - 1);
    if (dir > 0) reorderBars(range.first + range.count + 1);
    return;
  }
  moveBlocksBy(0, dir);
}

export function copy() {
  clipboard = arrange.copyBlocks(song(), selectedBlocks(), tracks());
  if (clipboard) notify(`Copied ${plural(clipboard.blocks.length, 'block')}.`);
}

export function cut() {
  copy();
  clear();
}

/** Paste with the copied blocks' top-left at the selection's top-left (or the focused block). */
export function paste() {
  if (!clipboard) return;
  const ts = tracks();
  const blocks = selectedBlocks();
  const at = blocks.length ? blocks : [editor.get().arrSel.focus ?? { trackId: editor.get().trackId, bar: 0 }];
  const row = Math.min(...at.map((b) => ts.findIndex((t) => t.id === b.trackId)).filter((r) => r >= 0));
  if (!Number.isFinite(row)) return;
  const bar = Math.min(...at.map((b) => b.bar));
  applyBlocks(arrange.pasteBlocks(song(), ts, clipboard, row, bar), 'Pasted');
}

/** Ctrl+D: whole bars are repeated with later bars pushed along; other blocks are copied over the next bars. */
export function duplicate() {
  const range = wholeBars();
  if (range) {
    docStore.transact(arrange.duplicateBars(song(), range));
    selectBars(range.first + range.count, range.first + 2 * range.count - 1);
    return;
  }
  const blocks = selectedBlocks();
  if (blocks.length) applyBlocks(arrange.duplicateBlocks(song(), tracks(), blocks), 'Duplicated');
}

/** Del: empty the selected blocks. */
export function clear() {
  const blocks = selectedBlocks();
  if (blocks.length) docStore.transact(arrange.clearBlocks(song(), blocks));
}

/** Insert an empty bar (in every track) before the selection. */
export function insertBar() {
  const at = spannedBars(selectedBlocks())?.first ?? arrange.barOf(song(), editor.get().cursor);
  docStore.transact(arrange.insertBars(song(), at));
  selectBars(at, at);
}

/** Shift+Del: remove the bars the selection spans from every track; later bars move back to fill the gap. */
export function removeBars() {
  const range = spannedBars(selectedBlocks());
  if (!range) return;
  docStore.transact(arrange.deleteBars(song(), range));
  selectBars(range.first, range.first);
}

/** Double-click or Enter on a block: edit that track at that bar. */
export function openInEditor(block: Block | null = editor.get().arrSel.focus) {
  const b = block ?? { trackId: editor.get().trackId, bar: 0 };
  const track = song().tracks[b.trackId];
  if (!track) return;
  openTrackAt(track.id, b.bar);
}

function openTrackAt(trackId: ID, bar: number) {
  const track = song().tracks[trackId]!;
  const switching = trackId !== editor.get().trackId;
  editor.set((s) => ({
    view: 'edit',
    trackId,
    cursor: barStart(bar),
    selection: switching ? [] : s.selection,
    cursorString: switching ? TRACK_KINDS[track.kind].homeLane : s.cursorString,
  }));
}
