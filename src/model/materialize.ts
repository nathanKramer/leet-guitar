/** Turns raw CRDT entries into the typed Song view, with defaults and validation. */
import type { DocState, Entry } from './crdt';
import { STANDARD_TUNING } from './music';
import type { ID, Note, Pattern, PatternNote, Song, SongMeta, Track, TrackKind } from './types';

export const META_ID = 'song';

export const DEFAULT_META: SongMeta = { title: 'Untitled', bpm: 120, beatsPerBar: 4, beatUnit: 4 };

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

export function readMeta(e: Entry | undefined): SongMeta {
  const f = e?.fields ?? {};
  return {
    title: str(f.title, DEFAULT_META.title),
    bpm: num(f.bpm, DEFAULT_META.bpm),
    beatsPerBar: num(f.beatsPerBar, DEFAULT_META.beatsPerBar),
    beatUnit: num(f.beatUnit, DEFAULT_META.beatUnit),
  };
}

export function readTrack(id: ID, e: Entry | undefined): Track | null {
  if (!e?.alive) return null;
  const f = e.fields;
  return {
    id,
    kind: f.kind === 'drums' || f.kind === 'bass' || f.kind === 'piano' ? f.kind : 'guitar',
    name: str(f.name, 'Guitar'),
    tuning: Array.isArray(f.tuning) ? (f.tuning as number[]) : STANDARD_TUNING,
    frets: num(f.frets, 22),
    program: num(f.program, 25),
    bank: num(f.bank, 0),
    order: num(f.order, 0),
  };
}

export function readNote(id: ID, e: Entry | undefined): Note | null {
  if (!e?.alive) return null;
  const f = e.fields;
  if (typeof f.trackId !== 'string') return null;
  for (const k of ['string', 'fret', 'start', 'duration'] as const) {
    if (typeof f[k] !== 'number') return null;
  }
  return {
    id,
    trackId: f.trackId,
    string: f.string as number,
    fret: f.fret as number,
    start: f.start as number,
    duration: f.duration as number,
    velocity: num(f.velocity, 96),
    ...(f.palmMute === true && { palmMute: true }),
  };
}

const KINDS: TrackKind[] = ['guitar', 'bass', 'piano', 'drums'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readPatternNote(v: unknown): PatternNote | null {
  if (typeof v !== 'object' || v === null) return null;
  const f = v as Record<string, unknown>;
  for (const k of ['pitch', 'string', 'fret', 'offset', 'duration'] as const) {
    if (!isNum(f[k])) return null;
  }
  return {
    pitch: f.pitch as number,
    string: f.string as number,
    fret: f.fret as number,
    offset: f.offset as number,
    duration: f.duration as number,
    velocity: num(f.velocity, 96),
    ...(f.palmMute === true && { palmMute: true }),
  };
}

export function readPattern(id: ID, e: Entry | undefined): Pattern | null {
  if (!e?.alive) return null;
  const f = e.fields;
  if (!KINDS.includes(f.kind as TrackKind) || !Array.isArray(f.tuning) || !f.tuning.every(isNum)) return null;
  const notes = (Array.isArray(f.notes) ? f.notes : []).map(readPatternNote).filter((n): n is PatternNote => !!n);
  if (!notes.length) return null;
  return { id, name: str(f.name, 'Pattern'), kind: f.kind as TrackKind, tuning: f.tuning as number[], notes };
}

export function materialize(state: DocState): Song {
  const tracks: Record<ID, Track> = {};
  for (const [id, e] of Object.entries(state.tracks)) {
    const t = readTrack(id, e);
    if (t) tracks[id] = t;
  }
  const notes: Record<ID, Note> = {};
  for (const [id, e] of Object.entries(state.notes)) {
    const n = readNote(id, e);
    if (n) notes[id] = n;
  }
  const patterns: Record<ID, Pattern> = {};
  for (const [id, e] of Object.entries(state.patterns ?? {})) {
    const p = readPattern(id, e);
    if (p) patterns[id] = p;
  }
  return { meta: readMeta(state.meta[META_ID]), tracks, notes, patterns };
}
