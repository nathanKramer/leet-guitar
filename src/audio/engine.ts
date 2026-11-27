import type { Song, Track } from '../model/types';

/**
 * Something that turns notes into sound. The Player owns timing (what to play when);
 * an engine only knows how to sound a note at a given AudioContext time.
 */
export interface SoundEngine {
  /** Called when playback starts, e.g. to send program changes for each track. */
  prepare(song: Song): void | Promise<void>;
  /** Schedule a note. `when` is in AudioContext seconds; `duration` in seconds. */
  playNote(track: Track, pitch: number, when: number, duration: number, velocity: number, palmMute?: boolean): void;
  /** Sound a note right away (placing notes, hitting pads). */
  preview(song: Song, track: Track, pitch: number, palmMute?: boolean): void;
  /** Apply each track's mix settings (pan). Called whenever the song changes, so it takes effect during playback. */
  mix(song: Song): void;
  /** Silence everything now, including notes already scheduled. */
  stopAll(): void;
  dispose(): void;
}
