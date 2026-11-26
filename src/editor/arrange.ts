/** Actions for the arrangement view: selecting bars and moving, duplicating, inserting and deleting them. */
import * as arrange from '../model/arrange';
import type { BarRange } from '../model/arrange';
import { barTicks } from '../model/durations';
import { TRACK_KINDS } from '../model/instruments';
import type { ID } from '../model/types';
import { docStore, editor } from '../session';

const song = () => docStore.getSong();
const barStart = (bar: number) => bar * barTicks(song().meta);

/** The selected bars as a range, or null. */
export function selectedBars(sel = editor.get().barSel): BarRange | null {
  if (!sel) return null;
  const first = Math.min(sel.anchor, sel.focus);
  return { first, count: Math.abs(sel.anchor - sel.focus) + 1 };
}

/** Select the bars from `anchor` to `focus`, with the cursor at the start of them so Space plays from there. */
function setBars(anchor: number, focus = anchor) {
  editor.set({ barSel: { anchor, focus }, cursor: barStart(Math.min(anchor, focus)) });
}

export function setView(view: 'edit' | 'arrange') {
  const s = editor.get();
  if (view === 'arrange' && !s.barSel) {
    const bar = arrange.barOf(song(), s.cursor);
    editor.set({ view, barSel: { anchor: bar, focus: bar } });
  } else {
    editor.set({ view });
  }
}

/** Click on a bar: select it, or with `extend` (Shift) stretch the selection to it. */
export function selectBar(bar: number, extend = false) {
  const sel = editor.get().barSel;
  if (extend && sel) setBars(sel.anchor, bar);
  else setBars(bar);
}

/** ←/→: select the next or previous bar; with `extend`, grow or shrink the selection that way. */
export function stepBarSelection(dir: 1 | -1, extend = false) {
  const sel = editor.get().barSel;
  if (!sel) return setBars(0);
  const focus = Math.max(0, sel.focus + dir);
  if (extend) setBars(sel.anchor, focus);
  else setBars(focus);
}

/** Move the selected bars to just before bar `to` (numbered as before the move), keeping them selected. */
export function moveSelectedBars(to: number) {
  const range = selectedBars();
  if (!range) return;
  const dest = arrange.movedTo(range, to);
  if (dest === null) return;
  docStore.transact(arrange.moveBars(song(), range, to));
  const forwards = editor.get().barSel!.anchor <= editor.get().barSel!.focus;
  const last = dest + range.count - 1;
  setBars(forwards ? dest : last, forwards ? last : dest);
}

/** Alt+←/→: move the selected bars one bar earlier or later. */
export function nudgeSelectedBars(dir: 1 | -1) {
  const range = selectedBars();
  if (!range) return;
  if (dir < 0 && range.first > 0) moveSelectedBars(range.first - 1);
  if (dir > 0) moveSelectedBars(range.first + range.count + 1);
}

/** Repeat the selected bars straight after themselves, then select the copy. */
export function duplicateSelectedBars() {
  const range = selectedBars();
  if (!range) return;
  docStore.transact(arrange.duplicateBars(song(), range));
  setBars(range.first + range.count, range.first + 2 * range.count - 1);
}

/** Insert an empty bar before the selection (or before the cursor's bar) and select it. */
export function insertBar() {
  const at = selectedBars()?.first ?? arrange.barOf(song(), editor.get().cursor);
  docStore.transact(arrange.insertBars(song(), at));
  setBars(at);
}

/** Delete the selected bars from every track; the bar that moves into their place is selected. */
export function deleteSelectedBars() {
  const range = selectedBars();
  if (!range) return;
  docStore.transact(arrange.deleteBars(song(), range));
  setBars(range.first);
}

/** Double-click on a track's bar: edit it. */
export function openInEditor(trackId: ID, bar: number) {
  const track = song().tracks[trackId];
  if (!track) return;
  const switching = trackId !== editor.get().trackId;
  editor.set((s) => ({
    view: 'edit',
    trackId,
    cursor: barStart(bar),
    selection: switching ? [] : s.selection,
    cursorString: switching ? TRACK_KINDS[track.kind].homeLane : s.cursorString,
  }));
}
