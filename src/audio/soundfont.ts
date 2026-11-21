/**
 * SoundFont playback (.sf2 / .sf3 / .dls) via spessasynth_lib. Loaded lazily: this module
 * and the synth's audio worklet are only fetched once someone loads a SoundFont.
 */
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { MUTED_GUITAR_PROGRAM, PALM_MUTE_MAX_S, palmMuteChannels, trackChannels, usesMutedProgram } from '../midi/channels';
import { GM_PROGRAM_NAMES, type Instrument } from '../model/gm';
import type { ID, Song, Track } from '../model/types';
import { audio } from './context';
import type { SoundEngine } from './engine';
import { LOOKAHEAD_S } from './player';

const workletLoaded = new WeakSet<BaseAudioContext>();
const PROBE_CHANNEL = 15;
const PREVIEW_S = 0.6;
/** Brings SoundFont output up to roughly the built-in synth's level (measured on guitar notes). */
const OUTPUT_GAIN = 5;

export class SoundFontEngine implements SoundEngine {
  private readonly out: GainNode;
  private channels = new Map<ID, number>();
  private muteChannels = new Map<ID, number>();
  /**
   * The synth schedules events against its own clock, which runs a constant amount
   * behind the AudioContext's (~200 ms in Chromium, set when the worklet starts).
   * We measure that offset from the clock value the worklet attaches to every message
   * it sends back, and add it to every scheduled time.
   */
  private clockOffset = 0;
  private offsetSamples: number[] = [];
  private unmuteTimer: ReturnType<typeof setTimeout> | undefined;
  /** performance.now() until which events queued by the last playback may still fire. */
  private drainUntil = 0;

  private constructor(private readonly synth: WorkletSynthesizer) {
    const { ctx, master } = audio();
    this.out = ctx.createGain();
    this.out.gain.value = OUTPUT_GAIN;
    this.out.connect(master);
    synth.connect(this.out);
    // `worklet` is protected in the typings; tapping its port is how we read the synth clock.
    const port = (synth as unknown as { worklet: AudioWorkletNode }).worklet.port;
    const handle = port.onmessage;
    port.onmessage = (e: MessageEvent) => {
      const t = (e.data as Array<{ currentTime?: number }> | undefined)?.[0]?.currentTime;
      if (typeof t === 'number') this.offsetSamples.push(t - ctx.currentTime);
      handle?.call(port, e);
    };
  }

  /** Throws if the file isn't a valid SoundFont/DLS. */
  static async create(data: ArrayBuffer): Promise<SoundFontEngine> {
    const { ctx } = audio();
    if (!workletLoaded.has(ctx)) {
      await ctx.audioWorklet.addModule(processorUrl);
      workletLoaded.add(ctx);
    }
    const synth = new WorkletSynthesizer(ctx);
    const engine = new SoundFontEngine(synth);
    try {
      // The synth takes ownership of the buffer; keep the caller's copy intact.
      await synth.soundBankManager.addSoundBank(data.slice(0), 'main');
      await synth.isReady;
      // The preset list arrives from the worklet as an event; wait for it so the instrument menus can use it.
      if (!synth.presetList.length) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3000);
          synth.eventHandler.addEvent('presetListChange', 'leet-guitar-presets', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    } catch (err) {
      engine.dispose();
      throw err;
    }
    return engine;
  }

  /** Re-measure the clock offset: any message from the synth carries its current time. */
  private async syncClock() {
    this.offsetSamples = [];
    for (let i = 0; i < 3; i++) {
      this.synth.controllerChange(PROBE_CHANNEL, 7, 100);
      await new Promise((r) => setTimeout(r, 15));
    }
    // Messages arrive slightly after they were sent, so the largest sample is the least delayed.
    if (this.offsetSamples.length) this.clockOffset = Math.max(...this.offsetSamples);
  }

  async prepare(song: Song) {
    // Restarting right after a stop: let the previous playback's queued events drain while
    // muted, then clear them, rather than starting the new playback muted.
    const wait = this.drainUntil - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (this.unmuteTimer !== undefined) {
      clearTimeout(this.unmuteTimer);
      this.unmuteTimer = undefined;
      this.synth.stopAll(true);
      this.unmute();
    }
    this.channels = trackChannels(song);
    for (const track of Object.values(song.tracks)) {
      const ch = this.channels.get(track.id);
      if (ch !== undefined) this.setInstrument(ch, track, track.program);
    }
    this.muteChannels = palmMuteChannels(song);
    for (const [id, ch] of this.muteChannels) this.setInstrument(ch, song.tracks[id], MUTED_GUITAR_PROGRAM, 0);
    await this.syncClock();
  }

  playNote(track: Track, pitch: number, when: number, duration: number, velocity: number, palmMute = false) {
    const muteCh = palmMute ? this.muteChannels.get(track.id) : undefined;
    const ch = muteCh ?? this.channels.get(track.id);
    if (ch === undefined) return;
    const t = when + this.clockOffset;
    this.synth.noteOn(ch, pitch, velocity, { time: t });
    this.synth.noteOff(ch, pitch, { time: t + duration });
  }

  preview(song: Song, track: Track, pitch: number, palmMute = false) {
    const ch = trackChannels(song).get(track.id);
    if (ch === undefined) return;
    // A palm-muted preview borrows the track's channel: a program change only affects notes started after
    // it, so the muted note keeps its sound when the track's own program is set straight back.
    const muted = palmMute && usesMutedProgram(track);
    if (muted) this.setInstrument(ch, track, MUTED_GUITAR_PROGRAM, 0);
    else this.setInstrument(ch, track, track.program);
    this.synth.noteOn(ch, pitch, palmMute ? 85 : 100);
    if (muted) this.setInstrument(ch, track, track.program);
    const length = palmMute ? PALM_MUTE_MAX_S : PREVIEW_S;
    this.synth.noteOff(ch, pitch, { time: audio().ctx.currentTime + this.clockOffset + length });
  }

  /** Bank select (melodic tracks only; the drum channel's kit is chosen by program alone) and program change. */
  private setInstrument(ch: number, track: Track, program: number, bank = track.bank) {
    if (track.kind !== 'drums') {
      this.synth.controllerChange(ch, 0, bank);
      this.synth.controllerChange(ch, 32, 0);
    }
    this.synth.programChange(ch, program);
  }

  /** The SoundFont's melodic presets (drum kits are left out). */
  instruments(): Instrument[] {
    return this.synth.presetList
      .filter((p) => !p.isDrum && p.bankLSB === 0)
      .map((p) => ({ program: p.program, bank: p.bankMSB, name: p.name.trim() || GM_PROGRAM_NAMES[p.program] }));
  }

  stopAll() {
    // The synth can't cancel events it has already queued, and the player queues up to
    // LOOKAHEAD_S ahead. Mute, silence now, then silence again once the queue has drained.
    const { ctx } = audio();
    const g = this.out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0, ctx.currentTime, 0.005);
    this.synth.stopAll(true);
    clearTimeout(this.unmuteTimer);
    const drainMs = (LOOKAHEAD_S + 0.1) * 1000;
    this.drainUntil = performance.now() + drainMs;
    this.unmuteTimer = setTimeout(() => {
      this.unmuteTimer = undefined;
      this.synth.stopAll(true);
      this.unmute();
    }, drainMs);
  }

  private unmute() {
    const { ctx } = audio();
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setValueAtTime(OUTPUT_GAIN, ctx.currentTime);
  }

  dispose() {
    clearTimeout(this.unmuteTimer);
    try {
      this.synth.stopAll(true);
      this.synth.disconnect(this.out);
      this.synth.destroy();
    } catch {
      /* already torn down */
    }
    this.out.disconnect();
  }
}
