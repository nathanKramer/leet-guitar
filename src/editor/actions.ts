/** User-level actions shared by the toolbar, fretboard, timeline and keyboard shortcuts. */
import * as cmd from '../model/commands';
import { durationTicks, type BaseDuration } from '../model/durations';
import { TRACK_KINDS } from '../model/instruments';
import type { ID, TrackKind } from '../model/types';
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
  player.preview(song(), s.trackId, track.tuning[string] + fret);
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
  player.preview(song(), n.trackId, track.tuning[n.string] + fret);
}

/** Changing the note value also applies it to any selected notes. */
/** Narrowest spacing (px) between grid steps before the timeline zooms in to keep notes legible. */
const MIN_STEP_PX = 16;

export function setDuration(base: BaseDuration, triplet = ed().triplet) {
  const ticks = durationTicks(base, triplet);
  editor.set((s) => ({
    base,
    triplet,
    zoom: ticks * s.zoom < MIN_STEP_PX ? Math.min(1, MIN_STEP_PX / ticks) : s.zoom,
  }));
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

/** Move selected notes `delta` lanes: to another string (guitar/bass), key (piano) or kit piece (drums). */
export function moveSelectionString(delta: number) {
  docStore.transact(cmd.moveToString(song(), liveSelection(), delta));
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
    ed().mutedTracks,
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

export function selectTrack(trackId: ID) {
  if (trackId === ed().trackId) return;
  const track = song().tracks[trackId];
  editor.set({ trackId, selection: [], cursorString: track ? TRACK_KINDS[track.kind].homeLane : 0 });
}

export function addTrack(kind: TrackKind) {
  const { ops, id } = cmd.addTrack(song(), kind);
  docStore.transact(ops);
  selectTrack(id);
}

export function deleteTrack(trackId: ID) {
  const remaining = cmd.sortedTracks(song()).filter((t) => t.id !== trackId);
  if (!remaining.length) return;
  if (ed().trackId === trackId) selectTrack(remaining[0].id);
  docStore.transact(cmd.deleteTrack(song(), trackId));
}

export function renameTrack(trackId: ID, name: string) {
  const trimmed = name.trim();
  if (trimmed) docStore.transact(cmd.renameTrack(trackId, trimmed));
}

export function toggleMute(trackId: ID) {
  editor.set((s) => ({
    mutedTracks: s.mutedTracks.includes(trackId)
      ? s.mutedTracks.filter((id) => id !== trackId)
      : [...s.mutedTracks, trackId],
  }));
}

/** Move the selected notes in time and pitch together (timeline drag). */
export function shiftSelection(shift: cmd.NoteShift) {
  docStore.transact(cmd.shiftNotes(song(), liveSelection(), shift));
}

/** Sound a pitch on a track without changing anything (e.g. while dragging a note). */
export function audition(trackId: ID, pitch: number) {
  player.preview(song(), trackId, pitch);
}
