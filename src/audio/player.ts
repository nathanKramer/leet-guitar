import { ticksToSeconds } from '../model/durations';
import { palmMuted } from '../midi/channels';
import { notePitch } from '../model/drums';
import type { ID, Note, Song } from '../model/types';
import { audio } from './context';
import type { SoundEngine } from './engine';
import { meter } from '../model/meter';
import { countInClicks, scheduleClicks } from './metronome';
import { NO_SPREAD, trackSpread, type Spread } from './spread';

/** How far ahead notes are handed to the engine, and how often the scheduler runs. */
export const LOOKAHEAD_S = 0.2;
const TICK_MS = 25;

/**
 * Index of the first note at or after `horizonTick`. Notes before it (from `from`) are due for scheduling.
 * `notes` must be sorted by start.
 */
export function dueUntil(notes: Note[], from: number, horizonTick: number): number {
  let i = from;
  while (i < notes.length && notes[i].start < horizonTick) i++;
  return i;
}

/**
 * Owns playback timing. Notes are handed to the current engine a short window ahead of time
 * (rather than all at once) so that stopping is immediate for every engine.
 */
export class Player {
  private engine: SoundEngine;
  private raf = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private onEnd: (() => void) | undefined;
  private active = false;
  private cancelClicks: (() => void) | undefined;
  /** The song last mixed, so a newly selected engine starts with the same mix. */
  private song: Song | undefined;
  private spread = new Map<ID, Spread>();

  constructor(engine: SoundEngine) {
    this.engine = engine;
  }

  /** Switch engines. The caller owns engine lifetimes (a loaded SoundFont outlives switching away). */
  setEngine(engine: SoundEngine) {
    if (engine === this.engine) return;
    this.stop();
    this.engine = engine;
    if (this.song) engine.mix(this.song, this.spread);
  }

  /** Keep the engine's mix (pan) in step with the song, including during playback. */
  mix(song: Song) {
    this.song = song;
    this.spread = trackSpread(song);
    this.engine.mix(song, this.spread);
  }

  preview(song: Song, trackId: ID, pitch: number, palmMute = false) {
    const track = song.tracks[trackId];
    if (track) this.engine.preview(song, track, pitch, palmMute);
  }

  async play(
    song: Song,
    fromTick: number,
    isSilenced: (trackId: ID) => boolean,
    onTick: (tick: number) => void,
    onEnd: () => void,
    /** Play a bar of metronome clicks first; `onCount` hears each beat of it (1, 2, …), then null. */
    countIn?: { onCount: (beat: number | null) => void },
  ) {
    this.stop();
    this.active = true;
    this.onEnd = onEnd;
    const engine = this.engine;
    await engine.prepare(song);
    if (this.onEnd !== onEnd) return; // stopped or restarted while preparing

    const { ctx } = audio();
    const bpm = song.meta.bpm;
    const secondsPerTick = ticksToSeconds(1, bpm);
    const start = ctx.currentTime + 0.08;
    // Count in with the time signature of the bar playback starts in.
    const m = meter(song);
    const count = countIn ? countInClicks({ ...song.meta, ...m.sigAt(m.barAt(fromTick)) }) : null;
    if (count) this.cancelClicks = scheduleClicks(count.clicks, start);
    const t0 = start + (count?.seconds ?? 0);
    const notes = Object.values(song.notes)
      .filter((n) => n.start >= fromTick && song.tracks[n.trackId])
      .sort((a, b) => a.start - b.start);
    const endTick = notes.reduce((m, n) => Math.max(m, n.start + n.duration), fromTick);
    const tickAt = (time: number) => fromTick + (time - t0) / secondsPerTick;

    let next = 0;
    const schedule = () => {
      const due = dueUntil(notes, next, tickAt(ctx.currentTime + LOOKAHEAD_S));
      for (; next < due; next++) {
        const n = notes[next];
        if (isSilenced(n.trackId)) continue;
        const track = song.tracks[n.trackId];
        const { seconds, velocity } = palmMuted(n.palmMute, track, n.duration * secondsPerTick, n.velocity);
        engine.playNote(
          track,
          notePitch(track, n),
          t0 + (n.start - fromTick) * secondsPerTick + (this.spread.get(n.trackId) ?? NO_SPREAD).delay,
          seconds,
          velocity,
          !!n.palmMute,
        );
      }
    };
    schedule();
    this.timer = setInterval(schedule, TICK_MS);

    let beat: number | null = null;
    const frame = () => {
      const now = ctx.currentTime;
      if (count) {
        const b = now < t0 ? Math.max(1, Math.floor((now - start) / count.beatSeconds) + 1) : null;
        if (b !== beat) countIn!.onCount((beat = b));
      }
      const tick = Math.max(fromTick, tickAt(now));
      if (now >= t0 && tick >= endTick) {
        this.finish();
        return;
      }
      onTick(tick);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Ends playback and reports it (used when the song runs out). */
  private finish() {
    const cb = this.onEnd;
    this.halt();
    cb?.();
  }

  /** Stops playback. Only silences the engine if something was playing (silencing can mute briefly). */
  stop() {
    const wasActive = this.active;
    this.halt();
    if (wasActive) this.engine.stopAll();
  }

  private halt() {
    this.active = false;
    this.cancelClicks?.();
    this.cancelClicks = undefined;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.timer = undefined;
    this.onEnd = undefined;
  }
}
