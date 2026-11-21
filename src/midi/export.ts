/** Standard MIDI File (format 1) writer. */
import { sortedTracks } from '../model/commands';
import { isStringed } from '../model/instruments';
import { PPQ } from '../model/durations';
import { ticksToSeconds } from '../model/durations';
import {
  DRUM_CHANNEL,
  MUTED_GUITAR_PROGRAM,
  palmMuteChannels,
  palmMuted,
  stringChannels,
  trackChannels,
} from './channels';
import type { Song } from '../model/types';

export type ChannelMode =
  /** One channel per track. */
  | 'per-track'
  /** One channel per string (1-6), the convention MIDI guitar controllers and many tab editors use. */
  | 'per-string';

interface TimedEvent {
  tick: number;
  /** Sorts events at the same tick: meta/program first, then note-offs, then note-ons. */
  order: number;
  bytes: number[];
}

export function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  value >>>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  return bytes;
}

const ascii = (s: string) => Array.from(new TextEncoder().encode(s));
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

function metaEvent(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data];
}

function chunk(id: string, data: number[]): number[] {
  return [...ascii(id), ...u32(data.length), ...data];
}

function trackChunk(events: TimedEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0x00, ...metaEvent(0x2f, []));
  return chunk('MTrk', data);
}

export function exportMidi(song: Song, mode: ChannelMode = 'per-track'): Uint8Array {
  const tracks = sortedTracks(song);
  const trackChannel = trackChannels(song);
  const muteChannel = palmMuteChannels(song);
  const tickSeconds = ticksToSeconds(1, song.meta.bpm);
  const { meta } = song;

  const tempo = Math.round(60_000_000 / meta.bpm);
  const conductor: TimedEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, ascii(meta.title)) },
    { tick: 0, order: 0, bytes: metaEvent(0x51, [(tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff]) },
    {
      tick: 0,
      order: 0,
      bytes: metaEvent(0x58, [meta.beatsPerBar, Math.round(Math.log2(meta.beatUnit)), 24, 8]),
    },
  ];
  const chunks = [trackChunk(conductor)];

  for (const track of tracks) {
    const events: TimedEvent[] = [{ tick: 0, order: 0, bytes: metaEvent(0x03, ascii(track.name)) }];
    const drums = track.kind === 'drums';
    const channels =
      isStringed(track.kind) && mode === 'per-string'
        ? stringChannels(track)
        : track.tuning.map(() => trackChannel.get(track.id) ?? DRUM_CHANNEL);
    // Drums: program change on channel 10 selects the kit (GS convention); the standard kit needs none.
    // Melodic tracks: bank select (CC 0, then CC 32) before the program change picks a SoundFont variation.
    if (!drums || track.program !== 0) {
      for (const ch of new Set(channels)) {
        if (!drums && track.bank) {
          events.push({ tick: 0, order: 0, bytes: [0xb0 | ch, 0, track.bank & 0x7f] });
          events.push({ tick: 0, order: 0, bytes: [0xb0 | ch, 32, 0] });
        }
        events.push({ tick: 0, order: 0, bytes: [0xc0 | ch, track.program & 0x7f] });
      }
    }
    // Palm-muted notes on the muted guitar program get their own channel (per-track layout only, so the
    // per-string layout keeps one channel per string); every palm-muted note is damped, as in playback.
    const pmChannel = mode === 'per-track' ? muteChannel.get(track.id) : undefined;
    if (pmChannel !== undefined) events.push({ tick: 0, order: 0, bytes: [0xc0 | pmChannel, MUTED_GUITAR_PROGRAM] });
    for (const n of Object.values(song.notes)) {
      if (n.trackId !== track.id) continue;
      const ch = n.palmMute && pmChannel !== undefined ? pmChannel : (channels[n.string] ?? channels[0]);
      const pitch = Math.min(127, Math.max(0, track.tuning[n.string] + n.fret));
      const damped = palmMuted(n.palmMute, track, n.duration * tickSeconds, n.velocity);
      const length = Math.max(1, Math.min(n.duration, Math.round(damped.seconds / tickSeconds)));
      const vel = Math.min(127, Math.max(1, Math.round(damped.velocity)));
      events.push({ tick: n.start, order: 2, bytes: [0x90 | ch, pitch, vel] });
      events.push({ tick: n.start + length, order: 1, bytes: [0x80 | ch, pitch, 0] });
    }
    chunks.push(trackChunk(events));
  }

  const header = chunk('MThd', [...u16(1), ...u16(chunks.length), ...u16(PPQ)]);
  return new Uint8Array([...header, ...chunks.flat()]);
}

export function downloadMidi(song: Song, mode: ChannelMode) {
  const bytes = exportMidi(song, mode);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${song.meta.title.trim() || 'untitled'}.mid`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
