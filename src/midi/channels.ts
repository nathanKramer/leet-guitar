import { sortedTracks } from '../model/commands';
import { isStringed } from '../model/instruments';
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

/**
 * Palm muting. General MIDI has one palm-muted sound: program 28, "Electric Guitar (muted)", a clean tone.
 * Clean and acoustic guitar tracks play their palm-muted notes with it, on a channel of their own. Overdriven,
 * distorted and bass tracks keep their own sound so the tone doesn't change. Every palm-muted note is also
 * damped: cut short and played a little softer.
 */
export const MUTED_GUITAR_PROGRAM = 28;
/** Longest a palm-muted note rings, in seconds. */
export const PALM_MUTE_MAX_S = 0.2;
/** Velocity scale for palm-muted notes. */
export const PALM_MUTE_VELOCITY = 0.85;

/** Whether a track's palm-muted notes switch to the muted guitar sound (clean and acoustic guitars). */
export function usesMutedProgram(track: Track): boolean {
  return track.kind === 'guitar' && track.program >= 24 && track.program <= 28;
}

/** Damped length (seconds) and velocity of a note, palm muted or not. */
export function palmMuted(palmMute: boolean | undefined, track: Track, seconds: number, velocity: number) {
  if (!palmMute || !isStringed(track.kind)) return { seconds, velocity };
  return {
    seconds: Math.min(seconds, PALM_MUTE_MAX_S),
    velocity: Math.max(1, Math.round(velocity * PALM_MUTE_VELOCITY)),
  };
}

/**
 * Extra channels for tracks that play palm-muted notes with the muted guitar program, allocated after the
 * track channels. Only tracks that have palm-muted notes get one.
 */
export function palmMuteChannels(song: Song): Map<ID, number> {
  const tracks = sortedTracks(song);
  const muted = new Set(Object.values(song.notes).filter((n) => n.palmMute).map((n) => n.trackId));
  const map = new Map<ID, number>();
  let next = tracks.length;
  for (const t of tracks) if (usesMutedProgram(t) && muted.has(t.id)) map.set(t.id, melodicChannel(next++));
  return map;
}

/** A track's pan (-1 left to 1 right) as a MIDI pan controller (CC 10) value: 0 left, 64 centre, 127 right. */
export function panValue(pan: number): number {
  return Math.min(127, Math.max(0, Math.round(64 + pan * (pan < 0 ? 64 : 63))));
}

/** Per-string channels for the "1 channel / string" export layout. */
export function stringChannels(track: Track): number[] {
  return track.tuning.map((_, s) => melodicChannel(s));
}
