/** General MIDI programs (0-indexed) offered for guitar tracks. */
export const GUITAR_PROGRAMS: Array<{ program: number; name: string }> = [
  { program: 24, name: 'Nylon' },
  { program: 25, name: 'Steel' },
  { program: 26, name: 'Jazz' },
  { program: 27, name: 'Clean' },
  { program: 28, name: 'Muted' },
  { program: 29, name: 'Overdrive' },
  { program: 30, name: 'Distortion' },
  { program: 31, name: 'Harmonics' },
];

/**
 * Drum kits, selected by program change on the drum channel (the GS convention).
 * Which kits exist depends on the SoundFont; missing ones fall back to the standard kit.
 */
export const DRUM_KITS: Array<{ program: number; name: string }> = [
  { program: 0, name: 'Standard' },
  { program: 8, name: 'Room' },
  { program: 16, name: 'Power' },
  { program: 24, name: 'Electronic' },
  { program: 25, name: 'TR-808' },
  { program: 32, name: 'Jazz' },
  { program: 40, name: 'Brush' },
  { program: 48, name: 'Orchestra' },
];
