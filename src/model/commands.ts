/**
 * Domain-level edits. Each function reads the current Song and returns CRDT ops;
 * nothing here mutates state, so commands are easy to test and to run on a server.
 */
import type { Op } from './crdt';
import { notePitch } from './drums';
import { isStringed, TRACK_KINDS } from './instruments';
import { placeClip, type Clip, type Placement } from './transfer';
import { newId } from './id';
import { META_ID } from './materialize';
import type { ID, Note, Song, SongMeta, Track, TrackKind } from './types';

export const DEFAULT_TRACK_ID = 'track-1';

const put = (coll: 'notes' | 'tracks' | 'meta', id: ID, value: Record<string, unknown>): Op => ({
  t: 'put',
  coll,
  id,
  value,
});
const patchNote = (id: ID, patch: Partial<Omit<Note, 'id'>>): Op => ({ t: 'patch', coll: 'notes', id, patch });

export function initDocument(song: Song): Op[] {
  const ops: Op[] = [];
  if (Object.keys(song.tracks).length === 0) {
    ops.push(put('tracks', DEFAULT_TRACK_ID, { ...newTrack('guitar', 'Guitar', 0) }));
  }
  return ops;
}

function newTrack(kind: TrackKind, name: string, order: number): Omit<Track, 'id'> {
  return { kind, name, order, ...TRACK_KINDS[kind].defaults };
}

export function sortedTracks(song: Song): Track[] {
  return Object.values(song.tracks).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

export function addTrack(song: Song, kind: TrackKind): { ops: Op[]; id: ID } {
  const tracks = sortedTracks(song);
  const sameKind = tracks.filter((t) => t.kind === kind).length;
  const base = TRACK_KINDS[kind].label;
  const name = sameKind ? `${base} ${sameKind + 1}` : base;
  const order = tracks.reduce((m, t) => Math.max(m, t.order), -1) + 1;
  const id = newId();
  return { ops: [put('tracks', id, { ...newTrack(kind, name, order) })], id };
}

/** Removes the track and all of its notes, in one undoable step. */
export function deleteTrack(song: Song, id: ID): Op[] {
  const ops: Op[] = deleteNotes(notesInTrack(song, id).map((n) => n.id));
  ops.push({ t: 'del', coll: 'tracks', id });
  return ops;
}

/** General MIDI program: the instrument sound, or the kit on a drum track. */
export function setTrackProgram(id: ID, program: number): Op[] {
  return [{ t: 'patch', coll: 'tracks', id, patch: { program } }];
}

/**
 * Retune a guitar or bass track (string count may change). Like retuning a real instrument, notes keep
 * their string and fret, so the tab reads the same and the pitches follow the new tuning. Notes on strings
 * that no longer exist move to another string at the same pitch where there's room; otherwise they're removed.
 */
export function setTuning(song: Song, trackId: ID, tuning: number[]): { ops: Op[]; moved: number; removed: number } {
  const track = song.tracks[trackId];
  if (!track || !isStringed(track.kind) || !tuning.length) return { ops: [], moved: 0, removed: 0 };
  const ops: Op[] = [{ t: 'patch', coll: 'tracks', id: trackId, patch: { tuning: [...tuning] } }];
  const notes = notesInTrack(song, trackId);
  const stranded = notes.filter((n) => n.string >= tuning.length).sort((a, b) => a.start - b.start);
  // Time spans already taken on each remaining string.
  const taken = tuning.map((_, s) =>
    notes.filter((n) => n.string === s).map((n) => [n.start, n.start + n.duration] as const),
  );
  let moved = 0;
  let removed = 0;
  for (const n of stranded) {
    const pitch = notePitch(track, n);
    const end = n.start + n.duration;
    // Prefer the lowest remaining string: closest to where the note was.
    let placed = false;
    for (let s = tuning.length - 1; s >= 0 && !placed; s--) {
      const fret = pitch - tuning[s];
      const free = taken[s].every(([a, b]) => b <= n.start || a >= end);
      if (fret >= 0 && fret <= track.frets && free) {
        ops.push(patchNote(n.id, { string: s, fret }));
        taken[s].push([n.start, end]);
        moved++;
        placed = true;
      }
    }
    if (!placed) {
      ops.push({ t: 'del', coll: 'notes', id: n.id });
      removed++;
    }
  }
  return { ops, moved, removed };
}

export function renameTrack(id: ID, name: string): Op[] {
  return [{ t: 'patch', coll: 'tracks', id, patch: { name } }];
}

export function setMeta(patch: Partial<SongMeta>): Op[] {
  return [{ t: 'patch', coll: 'meta', id: META_ID, patch }];
}

export type NoteInput = Omit<Note, 'id'>;

/**
 * A string can only sound one note at a time. Make room for a note on
 * [start, end): a note ringing into it is cut short, and notes starting inside
 * it are removed. Notes in `exclude` (e.g. the ones being moved) are left alone.
 */
function clearSpace(
  song: Song,
  trackId: ID,
  string: number,
  start: number,
  end: number,
  exclude: Set<ID> = new Set(),
): Op[] {
  const ops: Op[] = [];
  for (const n of Object.values(song.notes)) {
    if (n.trackId !== trackId || n.string !== string || exclude.has(n.id)) continue;
    if (n.start >= start && n.start < end) {
      ops.push({ t: 'del', coll: 'notes', id: n.id });
    } else if (n.start < start && n.start + n.duration > start) {
      ops.push(patchNote(n.id, { duration: start - n.start }));
    }
  }
  return ops;
}

export function addNote(song: Song, input: NoteInput): { ops: Op[]; id: ID } {
  const id = newId();
  const ops = clearSpace(song, input.trackId, input.string, input.start, input.start + input.duration);
  ops.push(put('notes', id, { ...input }));
  return { ops, id };
}

/** The note before this one in its track: the latest earlier start, then the next lane up at the same start. */
export function previousNote(song: Song, id: ID): Note | null {
  const target = song.notes[id];
  if (!target) return null;
  let best: Note | null = null;
  const before = (a: Note, b: Note) => a.start < b.start || (a.start === b.start && a.string < b.string);
  for (const n of Object.values(song.notes)) {
    if (n.trackId !== target.trackId || n.id === id || !before(n, target)) continue;
    if (!best || before(best, n)) best = n;
  }
  return best;
}

export function deleteNotes(ids: ID[]): Op[] {
  return ids.map((id) => ({ t: 'del', coll: 'notes', id }));
}

export function moveNotes(song: Song, ids: ID[], deltaTicks: number): Op[] {
  const notes = ids.map((id) => song.notes[id]).filter(Boolean);
  if (!notes.length) return [];
  const minStart = Math.min(...notes.map((n) => n.start));
  const delta = Math.max(deltaTicks, -minStart);
  if (delta === 0) return [];
  const moving = new Set(ids);
  return notes.flatMap((n) => [
    ...clearSpace(song, n.trackId, n.string, n.start + delta, n.start + delta + n.duration, moving),
    patchNote(n.id, { start: n.start + delta }),
  ]);
}

/** A move of a group of notes: in time, across lanes (piano keys / drums), and up or down the neck (frets). */
export interface NoteShift {
  ticks: number;
  lanes: number;
  frets: number;
}

/**
 * Limit a shift so every note in the group stays in range (start >= 0, a real lane, a real fret).
 * The whole group stops together, so chords and intervals keep their shape.
 */
export function clampShift(song: Song, ids: ID[], shift: NoteShift): NoteShift {
  let { ticks, lanes, frets } = shift;
  for (const id of ids) {
    const n = song.notes[id];
    const track = n && song.tracks[n.trackId];
    if (!track) continue;
    // `0 - x` rather than `-x`, so a note at zero yields 0 and not -0.
    ticks = Math.max(ticks, 0 - n.start);
    lanes = Math.min(Math.max(lanes, 0 - n.string), track.tuning.length - 1 - n.string);
    frets = Math.min(Math.max(frets, 0 - n.fret), track.frets - n.fret);
  }
  return { ticks, lanes, frets };
}

/** Move notes by a (clamped) shift in one step, applying the one-note-per-lane rule at their destinations. */
export function shiftNotes(song: Song, ids: ID[], shift: NoteShift): Op[] {
  const { ticks, lanes, frets } = clampShift(song, ids, shift);
  if (!ticks && !lanes && !frets) return [];
  const moving = new Set(ids);
  const ops: Op[] = [];
  for (const id of ids) {
    const n = song.notes[id];
    if (!n || !song.tracks[n.trackId]) continue;
    const start = n.start + ticks;
    const string = n.string + lanes;
    ops.push(...clearSpace(song, n.trackId, string, start, start + n.duration, moving));
    ops.push(patchNote(id, { start, string, fret: n.fret + frets }));
  }
  return ops;
}

export function setDurations(song: Song, ids: ID[], duration: number): Op[] {
  return ids.filter((id) => song.notes[id]).map((id) => patchNote(id, { duration }));
}

export function shiftFrets(song: Song, ids: ID[], delta: number): Op[] {
  const ops: Op[] = [];
  for (const id of ids) {
    const n = song.notes[id];
    const track = n && song.tracks[n.trackId];
    if (!track) continue;
    const fret = n.fret + delta;
    if (fret >= 0 && fret <= track.frets) ops.push(patchNote(id, { fret }));
  }
  return ops;
}

/**
 * Guitar/bass: move notes to another string while keeping the same pitch.
 * Piano: move notes by `delta` keys (lane 0 is the top key, so -1 is a semitone up).
 * Drums: move hits to another lane (a different kit piece).
 */
export function moveToString(song: Song, ids: ID[], delta: number): Op[] {
  const ops: Op[] = [];
  const moving = new Set(ids);
  for (const id of ids) {
    const n = song.notes[id];
    const track = n && song.tracks[n.trackId];
    if (!track) continue;
    const s = n.string + delta;
    if (s < 0 || s >= track.tuning.length) continue;
    const fret = isStringed(track.kind) ? n.fret + track.tuning[n.string] - track.tuning[s] : 0;
    if (fret < 0 || fret > track.frets) continue;
    ops.push(...clearSpace(song, n.trackId, s, n.start, n.start + n.duration, moving));
    ops.push(patchNote(id, { string: s, fret }));
  }
  return ops;
}

/** Copy notes with their real pitches, so they can be pasted onto any kind of track. */
export function copyNotes(song: Song, ids: ID[]): Clip | null {
  const notes = ids.map((id) => song.notes[id]).filter(Boolean);
  const track = notes[0] && song.tracks[notes[0].trackId];
  if (!track) return null;
  const min = Math.min(...notes.map((n) => n.start));
  return {
    kind: track.kind,
    tuning: track.tuning,
    notes: notes
      .filter((n) => song.tracks[n.trackId])
      .map((n) => ({
        pitch: notePitch(song.tracks[n.trackId], n),
        string: n.string,
        fret: n.fret,
        offset: n.start - min,
        duration: n.duration,
        velocity: n.velocity,
      })),
  };
}

/**
 * Paste a clip at a tick on a track. Notes are re-placed for the target instrument by pitch
 * (see placeClip); the placement report says what had to be moved or left out.
 */
export function pasteNotes(
  song: Song,
  clip: Clip,
  trackId: ID,
  at: number,
): { ops: Op[]; ids: ID[]; placement: Placement } {
  const track = song.tracks[trackId];
  const placement: Placement = track
    ? placeClip(clip, track)
    : { notes: [], octaveShifted: 0, dropped: clip.notes.length, refused: false };
  const ids: ID[] = [];
  const ops = placement.notes.flatMap((c) => {
    const id = newId();
    ids.push(id);
    const note: NoteInput = {
      trackId,
      string: c.string,
      fret: c.fret,
      start: at + c.offset,
      duration: c.duration,
      velocity: c.velocity,
    };
    return [
      ...clearSpace(song, trackId, c.string, note.start, note.start + note.duration),
      put('notes', id, { ...note }),
    ];
  });
  return { ops, ids, placement };
}

export function notesInTrack(song: Song, trackId: ID): Note[] {
  return Object.values(song.notes).filter((n) => n.trackId === trackId);
}
