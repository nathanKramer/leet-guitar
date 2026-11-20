/**
 * Domain-level edits. Each function reads the current Song and returns CRDT ops;
 * nothing here mutates state, so commands are easy to test and to run on a server.
 */
import type { Op } from './crdt';
import { TRACK_KINDS } from './instruments';
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
 * Guitar/bass: move notes to an adjacent string while keeping the same pitch.
 * Drums: move hits to the adjacent lane (a different kit piece).
 */
export function moveToString(song: Song, ids: ID[], direction: -1 | 1): Op[] {
  const ops: Op[] = [];
  const moving = new Set(ids);
  for (const id of ids) {
    const n = song.notes[id];
    const track = n && song.tracks[n.trackId];
    if (!track) continue;
    const s = n.string + direction;
    if (s < 0 || s >= track.tuning.length) continue;
    const fret = track.kind === 'drums' ? 0 : n.fret + track.tuning[n.string] - track.tuning[s];
    if (fret < 0 || fret > track.frets) continue;
    ops.push(...clearSpace(song, n.trackId, s, n.start, n.start + n.duration, moving));
    ops.push(patchNote(id, { string: s, fret }));
  }
  return ops;
}

export interface ClipNote {
  string: number;
  fret: number;
  offset: number;
  duration: number;
  velocity: number;
}

export function copyNotes(song: Song, ids: ID[]): ClipNote[] {
  const notes = ids.map((id) => song.notes[id]).filter(Boolean);
  if (!notes.length) return [];
  const min = Math.min(...notes.map((n) => n.start));
  return notes.map((n) => ({
    string: n.string,
    fret: n.fret,
    offset: n.start - min,
    duration: n.duration,
    velocity: n.velocity,
  }));
}

export function pasteNotes(song: Song, clip: ClipNote[], trackId: ID, at: number): { ops: Op[]; ids: ID[] } {
  const ids: ID[] = [];
  const ops = clip.flatMap((c) => {
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
  return { ops, ids };
}

export function notesInTrack(song: Song, trackId: ID): Note[] {
  return Object.values(song.notes).filter((n) => n.trackId === trackId);
}
