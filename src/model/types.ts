export type ID = string;

export interface SongMeta {
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** Denominator of the time signature (4 = quarter note gets the beat). */
  beatUnit: number;
}

export type TrackKind = 'guitar' | 'bass' | 'drums';

export interface Track {
  id: ID;
  kind: TrackKind;
  name: string;
  /**
   * MIDI pitch of each lane. Guitar/bass: open strings, index 0 = highest-pitched string (tab order).
   * Drums: General MIDI drum notes, one lane per kit piece, top to bottom.
   * Either way a note's pitch is `tuning[note.string] + note.fret`.
   */
  tuning: number[];
  /** Highest fret; 0 for drums (hits always have fret 0). */
  frets: number;
  /** General MIDI program (0-indexed). 25 = Acoustic Guitar (steel). */
  program: number;
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
}

/** The materialized, read-only view of a document that the UI renders. */
export interface Song {
  meta: SongMeta;
  tracks: Record<ID, Track>;
  notes: Record<ID, Note>;
}
