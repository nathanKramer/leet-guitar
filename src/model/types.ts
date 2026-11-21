export type ID = string;

export interface SongMeta {
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** Denominator of the time signature (4 = quarter note gets the beat). */
  beatUnit: number;
}

export type TrackKind = 'guitar' | 'bass' | 'piano' | 'drums';

export interface Track {
  id: ID;
  kind: TrackKind;
  name: string;
  /**
   * MIDI pitch of each lane. Guitar/bass: open strings, index 0 = highest-pitched string (tab order).
   * Drums: General MIDI drum notes, one lane per kit piece, top to bottom.
   * Piano: one lane per key, highest first (C8 down to A0).
   * Either way a note's pitch is `tuning[note.string] + note.fret`.
   */
  tuning: number[];
  /** Highest fret; 0 for drums and piano (their notes always have fret 0). */
  frets: number;
  /** General MIDI program (0-indexed). 25 = Acoustic Guitar (steel). */
  program: number;
  /** Bank (MIDI CC 0) for SoundFont variations of the program; 0 = the standard General MIDI sound. */
  bank: number;
  order: number;
}

export interface Note {
  id: ID;
  trackId: ID;
  /** String index into the track's tuning (0 = highest-pitched string). */
  string: number;
  fret: number;
  /** Start position in ticks (see PPQ). */
  start: number;
  /** Length in ticks. */
  duration: number;
  /** 1-127 */
  velocity: number;
  /** Guitar/bass: palm muted (damped with the picking hand). Absent means not muted. */
  palmMute?: boolean;
}

/** The materialized, read-only view of a document that the UI renders. */
export interface Song {
  meta: SongMeta;
  tracks: Record<ID, Track>;
  notes: Record<ID, Note>;
}
