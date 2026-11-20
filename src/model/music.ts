const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Standard tuning, high E first (tab order). */
export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];

/** Standard 4-string bass tuning (G2 D2 A1 E1), highest first. */
export const STANDARD_BASS_TUNING = [43, 38, 33, 28];

export function pitchClassName(midi: number): string {
  return NAMES[((midi % 12) + 12) % 12];
}

export function pitchName(midi: number): string {
  return `${pitchClassName(midi)}${Math.floor(midi / 12) - 1}`;
}

/** Tab-style string label: lowest string upper-case, the rest lower-case. */
export function stringLabel(tuning: number[], index: number): string {
  const name = pitchClassName(tuning[index]);
  return index === tuning.length - 1 ? name : name.toLowerCase();
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
