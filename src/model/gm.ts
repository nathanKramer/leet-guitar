/** General MIDI instrument names (programs 0–127) and their 16 families of 8. */

export const GM_FAMILIES = [
  'Piano',
  'Chromatic Percussion',
  'Organ',
  'Guitar',
  'Bass',
  'Strings',
  'Ensemble',
  'Brass',
  'Reed',
  'Pipe',
  'Synth Lead',
  'Synth Pad',
  'Synth Effects',
  'Ethnic',
  'Percussive',
  'Sound Effects',
];

export const GM_PROGRAM_NAMES = [
  // Piano
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  // Chromatic Percussion
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  // Organ
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica',
  'Tango Accordion',
  // Guitar
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar',
  'Distortion Guitar', 'Guitar Harmonics',
  // Bass
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1',
  'Synth Bass 2',
  // Strings
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  // Ensemble
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs',
  'Synth Voice', 'Orchestra Hit',
  // Brass
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  // Reed
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  // Pipe
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  // Synth Lead
  'Square Lead', 'Sawtooth Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead',
  'Bass + Lead',
  // Synth Pad
  'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  // Synth Effects
  'Rain', 'Soundtrack', 'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-fi',
  // Ethnic
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  // Percussive
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  // Sound Effects
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause',
  'Gunshot',
];

export const familyOf = (program: number) => GM_FAMILIES[Math.floor(program / 8)] ?? 'Other';

/** A melodic instrument: a program, and a bank for variations (GS bank select, CC 0). */
export interface Instrument {
  program: number;
  bank: number;
  name: string;
}

/** The 128 General MIDI instruments, bank 0: what's offered when no SoundFont is loaded. */
export const GM_INSTRUMENTS: Instrument[] = GM_PROGRAM_NAMES.map((name, program) => ({ program, bank: 0, name }));

/** Instruments grouped by General MIDI family, in program order, then bank. */
export function groupByFamily(list: Instrument[]): { family: string; instruments: Instrument[] }[] {
  const sorted = [...list].sort((a, b) => a.program - b.program || a.bank - b.bank);
  const groups = new Map<string, Instrument[]>();
  for (const i of sorted) {
    const f = familyOf(i.program);
    groups.set(f, [...(groups.get(f) ?? []), i]);
  }
  return [...groups].map(([family, instruments]) => ({ family, instruments }));
}

/** Which kind of track an instrument goes on: guitars get a fretboard, basses a bass fretboard, the rest a piano roll. */
export function trackKindFor(program: number): 'guitar' | 'bass' | 'piano' {
  if (program >= 24 && program <= 31) return 'guitar';
  if (program >= 32 && program <= 39) return 'bass';
  return 'piano';
}
