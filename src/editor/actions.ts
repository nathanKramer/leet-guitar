/** User-level actions shared by the toolbar, fretboard, timeline and keyboard shortcuts. */
import * as cmd from '../model/commands';
import { setTimeSig as setBarsTimeSig } from '../model/arrange';
import { durationTicks, type BaseDuration } from '../model/durations';
import { meter } from '../model/meter';
import { TRACK_KINDS } from '../model/instruments';
import { trackKindFor, type Instrument } from '../model/gm';
import type { Clip } from '../model/transfer';
import type { ID, TimeSig, TrackKind } from '../model/types';
import { BARS_PER_ROW, type EditorState } from './editorStore';
import { docStore, editor, player, saveCountIn } from '../session';

let clipboard: Clip | null = null;

const NOTICE_MS = 5000;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Show a short message in the status bar. */
export function notify(message: string) {
  clearTimeout(noticeTimer);
  editor.set({ notice: message });
  noticeTimer = setTimeout(() => editor.set({ notice: null }), NOTICE_MS);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const song = () => docStore.getSong();
const ed = () => editor.get();
export const stepTicks = () => durationTicks(ed().base, ed().triplet, ed().dotted);

/** Selection filtered to notes that still exist (a collaborator may have deleted some). */
export function liveSelection(): ID[] {
  const notes = song().notes;
  return ed().selection.filter((id) => notes[id]);
}

export function placeNote(string: number, fret: number, opts: { advance: boolean }) {
  const s = ed();
  const track = song().tracks[s.trackId];
  if (!track) return;
  const selectedBefore = liveSelection();
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
  // The new note is selected. Notes stacked at the cursor (chord mode, Shift-click, typing on
  // another string without moving) join the selection, so the whole chord stays selected.
  // (A note the new one replaced is simply gone from the selection.)
  const notes = song().notes;
  const stacked = selectedBefore.filter((sid) => notes[sid]);
  const stacking =
    (!opts.advance || s.chordMode) &&
    stacked.every((sid) => notes[sid].trackId === s.trackId && notes[sid].start === s.cursor);
  editor.set({
    selection: stacking ? [...stacked, id] : [id],
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

/** Move the cursor `bars` bars later (or earlier), keeping its place in the bar where the new bar is long enough. */
export function moveCursorBars(bars: number) {
  const m = meter(song());
  editor.set((s) => {
    const bar = m.barAt(s.cursor);
    const target = Math.max(0, bar + bars);
    const offset = Math.min(s.cursor - m.barStart(bar), m.barLength(target) - 1);
    return { cursor: m.barStart(target) + offset };
  });
}

/** PgUp/PgDn: one timeline row (a few bars) later or earlier. */
export const moveCursorRow = (dir: 1 | -1) => moveCursorBars(dir * ed().barsPerRow);

/**
 * Set the time signature from the cursor's bar: up to the next change, or with `last`, for bars up to `last` only
 * (later bars keep theirs). Only the bar lines move; the notes stay where they are.
 */
export function setTimeSig(sig: TimeSig, first = meter(song()).barAt(ed().cursor), last?: number) {
  const ops = setBarsTimeSig(song(), sig, first, last);
  if (!ops.length) return;
  docStore.transact(ops);
  // Keep the cursor at the start of the bar it was in.
  editor.set({ cursor: meter(song()).barStart(first) });
}

/**
 * Set the note value for new notes, and apply it to any selected notes. If the selected notes all end at the
 * cursor (e.g. a note just entered from the fretboard), the cursor moves with their end.
 */
export function setDuration(base: BaseDuration, triplet = ed().triplet, dotted = ed().dotted && !triplet) {
  const ticks = durationTicks(base, triplet, dotted);
  editor.set({ base, triplet, dotted });
  const sel = liveSelection();
  if (!sel.length) return;
  const notes = sel.map((id) => song().notes[id]);
  const start = notes[0].start;
  const followCursor = notes.every((n) => n.start === start && n.start + n.duration === ed().cursor);
  docStore.transact(cmd.setDurations(song(), sel, ticks));
  if (followCursor) editor.set({ cursor: start + ticks });
}

/** Triplet and dotted are exclusive: turning one on turns the other off. */
export function toggleTriplet() {
  setDuration(ed().base, !ed().triplet, false);
}

export function toggleDotted() {
  setDuration(ed().base, false, !ed().dotted);
}

/**
 * Step the cursor by the current note value and select whatever starts at the new position (a whole chord,
 * if several notes start there), sounding it. Stepping onto empty space clears the selection.
 */
export function stepCursor(dir: 1 | -1) {
  editor.set((s) => ({ cursor: meter(song()).step(s.cursor, stepTicks(), dir) }));
  const { cursor, trackId } = ed();
  const here = cmd
    .notesInTrack(song(), trackId)
    .filter((n) => n.start === cursor)
    .map((n) => n.id);
  editor.set({ selection: here });
  here.forEach(previewNote);
}

/** Zoom: step the number of bars per row (dir -1 = fewer bars, i.e. zoom in). */
export function stepBarsPerRow(dir: 1 | -1) {
  editor.set((s) => {
    const i = BARS_PER_ROW.indexOf(s.barsPerRow);
    const next = BARS_PER_ROW[Math.min(BARS_PER_ROW.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
    return { barsPerRow: next };
  });
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

/** Deletes the selected notes. Deleting a single note selects the one before it, so you can keep deleting. */
export function deleteSelection() {
  const sel = liveSelection();
  const before = sel.length === 1 ? cmd.previousNote(song(), sel[0]) : null;
  docStore.transact(cmd.deleteNotes(sel));
  if (before) selectNote(before.id);
  else editor.set({ selection: [] });
}

/** Select just this note, put the cursor on it (so the fretboard shows it), and sound it. */
export function selectNote(id: ID) {
  const n = song().notes[id];
  if (!n) return;
  editor.set({ selection: [id], cursor: n.start, cursorString: n.string });
  previewNote(id);
}

/** Sound a note as it's written. */
export function previewNote(id: ID) {
  const n = song().notes[id];
  const track = n && song().tracks[n.trackId];
  if (track) player.preview(song(), track.id, track.tuning[n.string] + n.fret, n.palmMute);
}

/** Palm mute the selected guitar/bass notes, or unmute them if they all are already. */
export function togglePalmMute() {
  const sel = liveSelection();
  const ops = cmd.togglePalmMute(song(), sel);
  if (!ops.length) {
    if (sel.length) notify('Palm muting is for guitar and bass notes.');
    return;
  }
  docStore.transact(ops);
  if (sel.length === 1) previewNote(sel[0]);
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
  if (clipboard) placeAt(clipboard, ed().cursor, 'Pasted');
}

/**
 * Put a clip on the active track at a tick, re-fingered for that instrument, and select it. `verb` names the
 * action in messages ("Pasted", "Inserted").
 */
function placeAt(clip: Clip, at: number, verb: string) {
  if (!clip.notes.length) return;
  const s = ed();
  const target = song().tracks[s.trackId];
  if (!target) return;
  const { ops, ids, placement } = cmd.pasteNotes(song(), clip, s.trackId, at);
  if (placement.refused) {
    notify(
      clip.kind === 'drums'
        ? `Drum hits can only go on a drum track.`
        : `Pitched notes can't go on a drum track.`,
    );
    return;
  }
  docStore.transact(ops);
  const end = Math.max(...clip.notes.map((c) => c.offset + c.duration));
  editor.set({ selection: ids, cursor: at + end });
  const changes = [
    placement.octaveShifted && `${plural(placement.octaveShifted, 'note')} moved by an octave to fit ${target.name}`,
    placement.dropped &&
      `${plural(placement.dropped, 'note')} left out (no room for ${placement.dropped === 1 ? 'it' : 'them'})`,
  ].filter(Boolean);
  if (changes.length) notify(`${verb} ${plural(ids.length, 'note')}: ${changes.join('; ')}.`);
}

/** Save the selected notes as a named pattern. Returns whether one was saved. */
export function savePattern(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const { ops } = cmd.savePattern(song(), liveSelection(), trimmed);
  if (!ops.length) return false;
  docStore.transact(ops);
  notify(`Saved pattern “${trimmed}”.`);
  return true;
}

/**
 * Insert a saved pattern on the active track at the playhead: the cursor, or while playing, the playback
 * position snapped to the current note value.
 */
export function insertPattern(id: ID) {
  const pattern = song().patterns[id];
  if (!pattern) return;
  const { playhead, cursor } = ed();
  const at = playhead === null ? cursor : meter(song()).round(playhead, stepTicks());
  placeAt(pattern, at, 'Inserted');
}

export function deletePattern(id: ID) {
  const pattern = song().patterns[id];
  if (!pattern) return;
  docStore.transact(cmd.deletePattern(id));
  notify(`Deleted pattern “${pattern.name}”. Ctrl+Z brings it back.`);
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
    // Read at scheduling time, so muting or soloing during playback takes effect straight away.
    (trackId) => !isAudible(trackId),
    (tick) => editor.set({ playhead: tick }),
    () => editor.set({ playing: false, playhead: null, countBeat: null }),
    ed().countIn ? { onCount: (countBeat) => editor.set({ countBeat }) } : undefined,
  );
}

export function stop() {
  player.stop();
  editor.set({ playing: false, playhead: null, countBeat: null });
}

export function toggleCountIn() {
  const countIn = !ed().countIn;
  editor.set({ countIn });
  saveCountIn(countIn);
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

/** Add a track for an instrument: guitars and basses get a fretboard, everything else a piano roll. */
export function addInstrumentTrack(instrument: Instrument) {
  const { ops, id } = cmd.addTrack(song(), trackKindFor(instrument.program), instrument);
  docStore.transact(ops);
  selectTrack(id);
}

/** Change a track's instrument. A track still named after its old instrument (or its kind) takes the new name. */
export function setInstrument(trackId: ID, instrument: Instrument, oldName: string | undefined) {
  const track = song().tracks[trackId];
  if (!track) return;
  const ops = cmd.setTrackProgram(trackId, instrument.program, instrument.bank);
  const autoNamed = track.name === oldName || track.name === TRACK_KINDS[track.kind].label;
  if (autoNamed && track.kind === 'piano') ops.push(...cmd.renameTrack(trackId, instrument.name));
  docStore.transact(ops);
}

/** Set a track's stereo position (-1 left to 1 right). A slider drag makes one undo step. */
export function setPan(trackId: ID, pan: number) {
  if (!song().tracks[trackId]) return;
  docStore.transact(cmd.setTrackPan(trackId, pan), { coalesce: `pan:${trackId}` });
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

const toggled = (list: ID[], id: ID) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function toggleMute(trackId: ID) {
  editor.set((s) => ({ mutedTracks: toggled(s.mutedTracks, trackId) }));
}

/** Solo a track. Several can be soloed at once; with `exclusive`, this one becomes the only solo. */
export function toggleSolo(trackId: ID, exclusive = false) {
  editor.set((s) => ({
    soloTracks:
      exclusive && !(s.soloTracks.length === 1 && s.soloTracks[0] === trackId)
        ? [trackId]
        : toggled(s.soloTracks, trackId),
  }));
}

/** Whether a track is heard: not muted, and soloed if any track is (mute wins over solo). */
export function isAudible(trackId: ID, s: EditorState = ed()) {
  const solos = s.soloTracks.filter((id) => song().tracks[id]);
  return !s.mutedTracks.includes(trackId) && (!solos.length || solos.includes(trackId));
}

/** Move the selected notes in time and pitch together (timeline drag). */
export function shiftSelection(shift: cmd.NoteShift) {
  docStore.transact(cmd.shiftNotes(song(), liveSelection(), shift));
}

/** Sound a pitch on a track without changing anything (e.g. while dragging a note). */
export function audition(trackId: ID, pitch: number) {
  player.preview(song(), trackId, pitch);
}

/** Retune the active guitar/bass track; reports notes that had to move or go because a string was removed. */
export function setTuning(trackId: ID, tuning: number[]) {
  const { ops, moved, removed } = cmd.setTuning(song(), trackId, tuning);
  if (!ops.length) return;
  docStore.transact(ops);
  const track = song().tracks[trackId];
  if (track) editor.set((s) => ({ cursorString: Math.min(s.cursorString, track.tuning.length - 1) }));
  const parts = [
    moved && `${plural(moved, 'note')} moved to another string`,
    removed && `${plural(removed, 'note')} removed (no other string could play ${removed === 1 ? 'it' : 'them'})`,
  ].filter(Boolean);
  if (parts.length) notify(`Removed a string: ${parts.join('; ')}.`);
}
