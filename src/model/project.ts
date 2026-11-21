/**
 * Project files: the whole song as plain JSON (`.leetguitar`).
 *
 * A project keeps everything MIDI can't: track kinds, tunings, strings and frets, fret counts and instrument
 * choices. It stores the song itself, not the CRDT state, so files are small, readable and diffable; opening one
 * replaces the current document's contents as a single (undoable) edit that syncs to collaborators.
 */
import type { Op } from './crdt';
import { newId } from './id';
import { DEFAULT_META, META_ID } from './materialize';
import { sortedTracks } from './commands';
import type { ID, Note, Song, SongMeta, Track, TrackKind } from './types';

export const PROJECT_FORMAT = 'leet-guitar';
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = '.leetguitar';

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  meta: SongMeta;
  tracks: Track[];
  notes: Note[];
}

export function serializeProject(song: Song): string {
  const tracks = sortedTracks(song);
  const order = new Map(tracks.map((t, i) => [t.id, i]));
  const notes = Object.values(song.notes)
    .filter((n) => order.has(n.trackId))
    .sort((a, b) => order.get(a.trackId)! - order.get(b.trackId)! || a.start - b.start || a.string - b.string);
  const file: ProjectFile = { format: PROJECT_FORMAT, version: PROJECT_VERSION, meta: song.meta, tracks, notes };
  // One note per line: readable, and diffs well under version control.
  return JSON.stringify(file, null, 2)
    .replace(/\{\s+("id": [^{}\[\]]*?)\s+\}/g, (_, body: string) => `{ ${body.replace(/,\s+/g, ', ')} }`)
    .replace(/\[\s+([\d,\s]+?)\s+\]/g, (_, nums: string) => `[${nums.replace(/,\s+/g, ', ')}]`);
}

export interface ParsedProject {
  meta: SongMeta;
  tracks: Track[];
  notes: Note[];
  /** Notes left out because they were malformed or referred to a missing track or string. */
  skipped: number;
}

const KINDS: TrackKind[] = ['guitar', 'bass', 'piano', 'drums'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Parses and validates a project file. Throws an Error with a user-facing message if it can't be opened. */
export function parseProject(text: string): ParsedProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a leet·guitar project (it isn't valid JSON).");
  }
  if (!isObj(data) || data.format !== PROJECT_FORMAT) throw new Error("This file isn't a leet·guitar project.");
  if (typeof data.version !== 'number' || data.version > PROJECT_VERSION) {
    throw new Error('This project was saved by a newer version of leet·guitar.');
  }

  const m = isObj(data.meta) ? data.meta : {};
  const meta: SongMeta = {
    title: typeof m.title === 'string' ? m.title : DEFAULT_META.title,
    bpm: isInt(m.bpm, 20, 400) ? m.bpm : DEFAULT_META.bpm,
    beatsPerBar: isInt(m.beatsPerBar, 1, 32) ? m.beatsPerBar : DEFAULT_META.beatsPerBar,
    beatUnit: [2, 4, 8, 16].includes(m.beatUnit as number) ? (m.beatUnit as number) : DEFAULT_META.beatUnit,
  };

  const tracks: Track[] = [];
  for (const [i, t] of (Array.isArray(data.tracks) ? data.tracks : []).entries()) {
    if (!isObj(t) || typeof t.id !== 'string' || !KINDS.includes(t.kind as TrackKind)) continue;
    if (!Array.isArray(t.tuning) || !t.tuning.length || !t.tuning.every((p) => isInt(p, 0, 127))) continue;
    if (tracks.some((x) => x.id === t.id)) continue;
    tracks.push({
      id: t.id,
      kind: t.kind as TrackKind,
      name: typeof t.name === 'string' && t.name.trim() ? t.name : `Track ${i + 1}`,
      tuning: t.tuning as number[],
      frets: isInt(t.frets, 0, 36) ? t.frets : 0,
      program: isInt(t.program, 0, 127) ? t.program : 0,
      bank: isInt(t.bank, 0, 127) ? t.bank : 0,
      order: i,
    });
  }
  if (!tracks.length) throw new Error('This project has no tracks that can be opened.');

  const byId = new Map(tracks.map((t) => [t.id, t]));
  const notes: Note[] = [];
  const rawNotes = Array.isArray(data.notes) ? data.notes : [];
  for (const n of rawNotes) {
    if (!isObj(n) || typeof n.trackId !== 'string') continue;
    const track = byId.get(n.trackId);
    if (!track || !isInt(n.string, 0, track.tuning.length - 1)) continue;
    if (!isInt(n.fret, 0, track.frets) || !isInt(n.start, 0, Number.MAX_SAFE_INTEGER)) continue;
    if (!isInt(n.duration, 1, Number.MAX_SAFE_INTEGER) || track.tuning[n.string] + n.fret > 127) continue;
    notes.push({
      id: typeof n.id === 'string' ? n.id : newId(),
      trackId: n.trackId,
      string: n.string,
      fret: n.fret,
      start: n.start,
      duration: n.duration,
      velocity: isInt(n.velocity, 1, 127) ? n.velocity : 96,
      ...(n.palmMute === true && (track.kind === 'guitar' || track.kind === 'bass') && { palmMute: true }),
    });
  }
  return { meta, tracks, notes, skipped: rawNotes.length - notes.length };
}

/**
 * Ops that replace everything in `song` with the project. Tracks and notes get fresh ids, so opening the same
 * file twice (or a file saved from this document) never collides with records that were just deleted.
 */
export function openProjectOps(song: Song, project: ParsedProject): { ops: Op[]; firstTrackId: ID } {
  const ops: Op[] = [];
  for (const id of Object.keys(song.notes)) ops.push({ t: 'del', coll: 'notes', id });
  for (const id of Object.keys(song.tracks)) ops.push({ t: 'del', coll: 'tracks', id });
  ops.push({ t: 'patch', coll: 'meta', id: META_ID, patch: { ...project.meta } });

  const trackIds = new Map<ID, ID>();
  for (const { id, ...fields } of project.tracks) {
    const fresh = newId();
    trackIds.set(id, fresh);
    ops.push({ t: 'put', coll: 'tracks', id: fresh, value: { ...fields, tuning: [...fields.tuning] } });
  }
  for (const { id: _id, trackId, ...fields } of project.notes) {
    ops.push({ t: 'put', coll: 'notes', id: newId(), value: { ...fields, trackId: trackIds.get(trackId)! } });
  }
  return { ops, firstTrackId: trackIds.get(project.tracks[0].id)! };
}

/** A file name for the project, from the song title. */
export function projectFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ') || 'Untitled';
  return base + PROJECT_EXT;
}
