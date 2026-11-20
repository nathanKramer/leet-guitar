/** User-level actions shared by the toolbar, fretboard, timeline and keyboard shortcuts. */
import * as cmd from '../model/commands';
import { durationTicks, type BaseDuration } from '../model/durations';
import type { ID } from '../model/types';
import { docStore, editor, player } from '../session';

let clipboard: cmd.ClipNote[] = [];

const song = () => docStore.getSong();
const ed = () => editor.get();
export const stepTicks = () => durationTicks(ed().base, ed().triplet);

/** Selection filtered to notes that still exist (a collaborator may have deleted some). */
export function liveSelection(): ID[] {
  const notes = song().notes;
  return ed().selection.filter((id) => notes[id]);
}

export function placeNote(string: number, fret: number, opts: { advance: boolean }) {
  const s = ed();
  const track = song().tracks[s.trackId];
  if (!track) return;
  const duration = stepTicks();
  const { ops, id } = cmd.addNote(song(), {
    trackId: s.trackId,
    string,
    fret,
    start: s.cursor,
    duration,
    velocity: 96,
  });
  docStore.transact(ops);
  player.preview(track.tuning[string] + fret);
  // Entry deliberately leaves the selection empty: changing the note value
  // between entries must not resize the note just placed.
  editor.set({
    selection: [],
    cursorString: string,
    cursor: opts.advance && !s.chordMode ? s.cursor + duration : s.cursor,
  });
  return id;
}

export function setFret(id: ID, fret: number) {
  const n = song().notes[id];
  const track = n && song().tracks[n.trackId];
  if (!track) return;
  docStore.transact([{ t: 'patch', coll: 'notes', id, patch: { fret } }]);
  player.preview(track.tuning[n.string] + fret);
}

/** Changing the note value also applies it to any selected notes. */
export function setDuration(base: BaseDuration, triplet = ed().triplet) {
  editor.set({ base, triplet });
  const sel = liveSelection();
  if (sel.length) docStore.transact(cmd.setDurations(song(), sel, durationTicks(base, triplet)));
}

export function toggleTriplet() {
  setDuration(ed().base, !ed().triplet);
}

export function moveCursor(deltaTicks: number) {
  editor.set((s) => ({ cursor: Math.max(0, s.cursor + deltaTicks) }));
}

export function moveCursorString(delta: number) {
  const track = song().tracks[ed().trackId];
  if (!track) return;
  editor.set((s) => ({
    cursorString: Math.min(track.tuning.length - 1, Math.max(0, s.cursorString + delta)),
  }));
}

export function moveSelection(deltaTicks: number) {
  docStore.transact(cmd.moveNotes(song(), liveSelection(), deltaTicks));
}

export function shiftSelectionFret(delta: number) {
  docStore.transact(cmd.shiftFrets(song(), liveSelection(), delta));
}

export function moveSelectionString(direction: -1 | 1) {
  docStore.transact(cmd.moveToString(song(), liveSelection(), direction));
}

export function deleteSelection() {
  docStore.transact(cmd.deleteNotes(liveSelection()));
  editor.set({ selection: [] });
}

export function selectAll() {
  editor.set({ selection: cmd.notesInTrack(song(), ed().trackId).map((n) => n.id) });
}

export function copy() {
  clipboard = cmd.copyNotes(song(), liveSelection());
}

export function cut() {
  copy();
  deleteSelection();
}

export function paste() {
  if (!clipboard.length) return;
  const s = ed();
  const { ops, ids } = cmd.pasteNotes(song(), clipboard, s.trackId, s.cursor);
  docStore.transact(ops);
  const end = Math.max(...clipboard.map((c) => c.offset + c.duration));
  editor.set({ selection: ids, cursor: s.cursor + end });
}

export function togglePlay() {
  if (ed().playing) {
    stop();
    return;
  }
  editor.set({ playing: true, playhead: ed().cursor });
  player.play(
    song(),
    ed().cursor,
    (tick) => editor.set({ playhead: tick }),
    () => editor.set({ playing: false, playhead: null }),
  );
}

export function stop() {
  player.stop();
  editor.set({ playing: false, playhead: null });
}

export function undo() {
  docStore.undo();
}

export function redo() {
  docStore.redo();
}
