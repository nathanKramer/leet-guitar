import { DRUM_KIT } from './drums';
import { GM_INSTRUMENTS, trackKindFor, type Instrument } from './gm';
import { MIDDLE_C, PIANO_KEYS, STANDARD_BASS_TUNING, STANDARD_TUNING } from './music';
import type { Track, TrackKind } from './types';

export interface Program {
  program: number;
  name: string;
}

/** General MIDI programs (0-indexed) offered for guitar tracks. */
export const GUITAR_PROGRAMS: Program[] = [
  { program: 24, name: 'Nylon' },
  { program: 25, name: 'Steel' },
  { program: 26, name: 'Jazz' },
  { program: 27, name: 'Clean' },
  { program: 28, name: 'Muted' },
  { program: 29, name: 'Overdrive' },
  { program: 30, name: 'Distortion' },
  { program: 31, name: 'Harmonics' },
];

/** General MIDI programs (0-indexed) offered for bass tracks. */
export const BASS_PROGRAMS: Program[] = [
  { program: 32, name: 'Acoustic' },
  { program: 33, name: 'Finger' },
  { program: 34, name: 'Pick' },
  { program: 35, name: 'Fretless' },
  { program: 36, name: 'Slap' },
  { program: 37, name: 'Slap 2' },
  { program: 38, name: 'Synth' },
  { program: 39, name: 'Synth 2' },
];

/** General MIDI programs (0-indexed) offered for piano tracks: the piano family. */
export const PIANO_PROGRAMS: Program[] = [
  { program: 0, name: 'Grand' },
  { program: 1, name: 'Bright' },
  { program: 2, name: 'Electric grand' },
  { program: 3, name: 'Honky-tonk' },
  { program: 4, name: 'Rhodes' },
  { program: 5, name: 'FM electric' },
  { program: 6, name: 'Harpsichord' },
  { program: 7, name: 'Clavinet' },
];

/**
 * Drum kits, selected by program change on the drum channel (the GS convention).
 * Which kits exist depends on the SoundFont; missing ones fall back to the standard kit.
 */
export const DRUM_KITS: Program[] = [
  { program: 0, name: 'Standard' },
  { program: 8, name: 'Room' },
  { program: 16, name: 'Power' },
  { program: 24, name: 'Electronic' },
  { program: 25, name: 'TR-808' },
  { program: 32, name: 'Jazz' },
  { program: 40, name: 'Brush' },
  { program: 48, name: 'Orchestra' },
];

export interface TrackKindInfo {
  label: string;
  /** Instrument (or kit) choices for the track's program. */
  programs: Program[];
  /** Settings a new track of this kind starts with. */
  defaults: Pick<Track, 'tuning' | 'frets' | 'program' | 'bank'>;
  /** Lane the cursor starts on when switching to a track of this kind. */
  homeLane: number;
}

/** Everything kind-specific about a track, in the order the "add track" buttons appear. */
export const TRACK_KINDS: Record<TrackKind, TrackKindInfo> = {
  guitar: {
    label: 'Guitar',
    programs: GUITAR_PROGRAMS,
    defaults: { tuning: STANDARD_TUNING, frets: 22, program: 25, bank: 0 },
    homeLane: 0,
  },
  bass: {
    label: 'Bass',
    programs: BASS_PROGRAMS,
    defaults: { tuning: STANDARD_BASS_TUNING, frets: 24, program: 33, bank: 0 },
    homeLane: 0,
  },
  piano: {
    label: 'Piano',
    programs: PIANO_PROGRAMS,
    defaults: { tuning: PIANO_KEYS, frets: 0, program: 0, bank: 0 },
    homeLane: PIANO_KEYS.indexOf(MIDDLE_C),
  },
  drums: { label: 'Drums', programs: DRUM_KITS, defaults: { tuning: DRUM_KIT, frets: 0, program: 0, bank: 0 }, homeLane: 0 },
};

export const TRACK_KIND_ORDER: TrackKind[] = ['guitar', 'bass', 'piano', 'drums'];

/**
 * Instruments offered for a track. With a SoundFont loaded, its own presets (every melodic one for a piano-roll
 * track, the guitar or bass family for those); without one, the General MIDI list for piano-roll tracks and the
 * short lists above for the rest. Drum tracks always choose a kit.
 */
export function instrumentChoices(kind: TrackKind, font: Instrument[] | null): Instrument[] {
  if (kind === 'drums') return DRUM_KITS.map((k) => ({ program: k.program, bank: 0, name: k.name }));
  if (font?.length) return kind === 'piano' ? font : font.filter((i) => trackKindFor(i.program) === kind);
  if (kind === 'piano') return GM_INSTRUMENTS;
  return TRACK_KINDS[kind].programs.map((p) => ({ program: p.program, bank: 0, name: p.name }));
}

/** Guitar and bass: lanes are strings and notes have frets. Piano and drums: one lane per key / kit piece. */
export function isStringed(kind: TrackKind): boolean {
  return kind === 'guitar' || kind === 'bass';
}
