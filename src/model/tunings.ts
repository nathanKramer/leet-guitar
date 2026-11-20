/** Preset tunings for stringed tracks. Pitches are MIDI notes, highest string first (tab order). */
import { pitchClassName } from './music';
import type { TrackKind } from './types';

export interface TuningPreset {
  name: string;
  /** Compact label for the track tab. */
  short: string;
  kind: 'guitar' | 'bass';
  pitches: number[];
}

/** Every string `n` semitones lower (or higher, for positive n). */
const shift = (pitches: number[], n: number) => pitches.map((p) => p + n);

const E_STANDARD = [64, 59, 55, 50, 45, 40];
const SEVEN_STANDARD = [64, 59, 55, 50, 45, 40, 35];
const BASS_STANDARD = [43, 38, 33, 28];

export const TUNING_PRESETS: TuningPreset[] = [
  // 6-string guitar
  { kind: 'guitar', name: 'Standard (E)', short: 'E Std', pitches: E_STANDARD },
  { kind: 'guitar', name: 'E♭ Standard', short: 'E♭ Std', pitches: shift(E_STANDARD, -1) },
  { kind: 'guitar', name: 'D Standard', short: 'D Std', pitches: shift(E_STANDARD, -2) },
  { kind: 'guitar', name: 'C Standard', short: 'C Std', pitches: shift(E_STANDARD, -4) },
  { kind: 'guitar', name: 'B Standard', short: 'B Std', pitches: shift(E_STANDARD, -5) },
  { kind: 'guitar', name: 'Drop D', short: 'Drop D', pitches: [64, 59, 55, 50, 45, 38] },
  { kind: 'guitar', name: 'Drop C', short: 'Drop C', pitches: [62, 57, 53, 48, 43, 36] },
  { kind: 'guitar', name: 'Drop B', short: 'Drop B', pitches: [61, 56, 52, 47, 42, 35] },
  { kind: 'guitar', name: 'DADGAD', short: 'DADGAD', pitches: [62, 57, 55, 50, 45, 38] },
  { kind: 'guitar', name: 'Open G', short: 'Open G', pitches: [62, 59, 55, 50, 43, 38] },
  { kind: 'guitar', name: 'Open D', short: 'Open D', pitches: [62, 57, 54, 50, 45, 38] },
  // 7-string guitar
  { kind: 'guitar', name: '7-string Standard (B)', short: '7 B Std', pitches: SEVEN_STANDARD },
  { kind: 'guitar', name: '7-string Drop A', short: '7 Drop A', pitches: [64, 59, 55, 50, 45, 40, 33] },
  { kind: 'guitar', name: '7-string A Standard', short: '7 A Std', pitches: shift(SEVEN_STANDARD, -2) },
  // Bass
  { kind: 'bass', name: 'Standard (E)', short: 'E Std', pitches: BASS_STANDARD },
  { kind: 'bass', name: 'Drop D', short: 'Drop D', pitches: [43, 38, 33, 26] },
  { kind: 'bass', name: 'D Standard', short: 'D Std', pitches: shift(BASS_STANDARD, -2) },
  { kind: 'bass', name: '5-string Standard (B)', short: '5 B Std', pitches: [43, 38, 33, 28, 23] },
];

export const MIN_STRINGS = 4;
export const MAX_STRINGS = 8;
/** Interval used for a newly added low string: a fourth below the current lowest, like standard tuning. */
export const NEW_STRING_INTERVAL = 5;

export function presetsFor(kind: TrackKind): TuningPreset[] {
  return TUNING_PRESETS.filter((p) => p.kind === kind);
}

export function matchPreset(kind: TrackKind, tuning: number[]): TuningPreset | undefined {
  return presetsFor(kind).find((p) => p.pitches.length === tuning.length && p.pitches.every((x, i) => x === tuning[i]));
}

/** Low to high note names, the way tunings are usually written: "B E A D F# B". */
export function spellTuning(tuning: number[]): string {
  return [...tuning].reverse().map(pitchClassName).join(' ');
}

/** Tab label: the preset's short name, or the spelled-out notes for a custom tuning. */
export function tuningLabel(kind: TrackKind, tuning: number[]): string {
  return matchPreset(kind, tuning)?.short ?? spellTuning(tuning).replace(/ /g, '');
}
