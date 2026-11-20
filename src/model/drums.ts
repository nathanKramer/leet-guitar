import { pitchClassName, stringLabel } from './music';
import type { Note, Track } from './types';

/** Default kit lanes, top to bottom in drum-notation order (cymbals above, kick at the bottom). */
export const DRUM_KIT = [49, 51, 46, 42, 50, 47, 43, 38, 36];

const GM_DRUM_NAMES: Record<number, string> = {
  35: 'Kick 2',
  36: 'Kick',
  37: 'Side stick',
  38: 'Snare',
  39: 'Clap',
  40: 'Snare 2',
  41: 'Floor tom 2',
  42: 'Hi-hat',
  43: 'Floor tom',
  44: 'Pedal hat',
  45: 'Tom 3',
  46: 'Open hat',
  47: 'Tom 2',
  48: 'Tom 1.5',
  49: 'Crash',
  50: 'Tom 1',
  51: 'Ride',
  52: 'China',
  53: 'Ride bell',
  55: 'Splash',
  56: 'Cowbell',
  57: 'Crash 2',
  59: 'Ride 2',
};

const CYMBALS = new Set([42, 44, 46, 49, 51, 52, 53, 55, 57, 59]);

export function drumName(pitch: number): string {
  return GM_DRUM_NAMES[pitch] ?? `Drum ${pitch}`;
}

/** Drum notation uses x noteheads for cymbals and hats. */
export function isCymbal(pitch: number): boolean {
  return CYMBALS.has(pitch);
}

export function notePitch(track: Track, note: Pick<Note, 'string' | 'fret'>): number {
  return track.tuning[note.string] + note.fret;
}

/** Row label for a lane: kit piece for drums, string name otherwise (bass tab writes every string upper-case). */
export function laneLabel(track: Track, lane: number): string {
  if (track.kind === 'drums') return drumName(track.tuning[lane]);
  if (track.kind === 'bass') return pitchClassName(track.tuning[lane]);
  return stringLabel(track.tuning, lane);
}
