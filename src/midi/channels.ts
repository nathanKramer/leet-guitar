import { sortedTracks } from '../model/commands';
import type { ID, Song, Track } from '../model/types';

/** General MIDI channel 10 (index 9) is reserved for drums. */
export const DRUM_CHANNEL = 9;

/** Melodic tracks skip the drum channel and wrap after 15. */
export function melodicChannel(index: number): number {
  const ch = index % 15;
  return ch >= 9 ? ch + 1 : ch;
}

/**
 * The MIDI channel each track plays on: drums on channel 10, each guitar track on its own channel.
 * Shared by MIDI export and SoundFont playback so what you hear is what you export.
 */
export function trackChannels(song: Song): Map<ID, number> {
  const map = new Map<ID, number>();
  sortedTracks(song).forEach((t, i) => map.set(t.id, t.kind === 'drums' ? DRUM_CHANNEL : melodicChannel(i)));
  return map;
}

/** Per-string channels for the "1 channel / string" export layout. */
export function stringChannels(track: Track): number[] {
  return track.tuning.map((_, s) => melodicChannel(s));
}
