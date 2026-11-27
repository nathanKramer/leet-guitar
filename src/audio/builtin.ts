/** The default engine: synthesized in the browser, nothing to download. */
import { midiToFrequency } from '../model/music';
import type { ID, Song, Track } from '../model/types';
import { audio } from './context';
import { DrumSynth } from './drums';
import { PianoSynth } from './piano';
import type { SoundEngine } from './engine';

/**
 * How many times the initial noise burst is smoothed. More smoothing removes high harmonics
 * from the pluck: a guitar pick is bright, a bass played with fingers is round.
 */
const SMOOTHING: Record<'guitar' | 'bass', number> = { guitar: 0, bass: 6 };

/** Karplus-Strong plucked string, rendered once per pitch and tone, and cached. */
/** Palm muting: extra smoothing (darker attack) and how long the damped string takes to die away (to -40 dB). */
const MUTED_SMOOTHING = 3;
const MUTED_DECAY_S = 0.3;

class PluckSynth {
  private cache = new Map<string, { buffer: AudioBuffer; rate: number }>();

  private voice(midi: number, tone: 'guitar' | 'bass', muted: boolean) {
    const key = `${tone}:${midi}:${muted ? 'pm' : ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const { ctx } = audio();
    const sr = ctx.sampleRate;
    const freq = midiToFrequency(midi);
    // The two-point average adds half a sample of delay; the leftover fractional
    // error is corrected with playbackRate so every pitch is in tune.
    const period = Math.max(2, Math.round(sr / freq - 0.5));
    const rate = (freq * (period + 0.5)) / sr;
    const length = Math.floor(sr * (muted ? MUTED_DECAY_S * 1.5 : 3));
    const buffer = ctx.createBuffer(1, length, sr);
    const out = buffer.getChannelData(0);
    const ring = new Float32Array(period);
    let prev = 0;
    for (let i = 0; i < period; i++) {
      // Slightly low-passed noise burst = softer pick attack.
      const r = Math.random() * 2 - 1;
      ring[i] = (r + prev) * 0.5;
      prev = r;
    }
    for (let pass = 0; pass < SMOOTHING[tone] + (muted ? MUTED_SMOOTHING : 0); pass++) {
      let last = ring[period - 1];
      for (let i = 0; i < period; i++) {
        const cur = ring[i];
        ring[i] = (last + cur * 2 + ring[(i + 1) % period]) / 4;
        last = cur;
      }
    }
    // Smoothing lowers the burst's energy; bring it back up so loudness stays consistent.
    let peak = 0;
    for (let i = 0; i < period; i++) peak = Math.max(peak, Math.abs(ring[i]));
    if (peak > 0) for (let i = 0; i < period; i++) ring[i] /= peak;
    // The loop scales each sample once per period, so a palm mute's decay is set per period: the string
    // loses 40 dB over MUTED_DECAY_S whatever its pitch.
    const decay = muted ? Math.pow(0.01, 1 / (MUTED_DECAY_S * freq)) : 0.996;
    let idx = 0;
    for (let i = 0; i < length; i++) {
      const next = (idx + 1) % period;
      out[i] = ring[idx];
      ring[idx] = (ring[idx] + ring[next]) * 0.5 * decay;
      idx = next;
    }
    const v = { buffer, rate };
    this.cache.set(key, v);
    return v;
  }

  play(
    dest: AudioNode,
    midi: number,
    when: number,
    duration: number,
    velocity = 96,
    tone: 'guitar' | 'bass' = 'guitar',
    muted = false,
  ): AudioScheduledSourceNode[] {
    const { ctx } = audio();
    const { buffer, rate } = this.voice(midi, tone, muted);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    const level = (velocity / 127) * 0.9;
    const release = 0.05;
    gain.gain.setValueAtTime(level, when);
    gain.gain.setValueAtTime(level, when + duration);
    gain.gain.linearRampToValueAtTime(0, when + duration + release);
    src.connect(gain).connect(dest);
    src.start(when);
    src.stop(when + duration + release + 0.01);
    return [src];
  }
}

export class BuiltInEngine implements SoundEngine {
  private strings = new PluckSynth();
  private piano = new PianoSynth();
  private drums = new DrumSynth();
  private sources = new Set<AudioScheduledSourceNode>();
  /** One stereo panner per track, feeding the master bus. */
  private panners = new Map<ID, StereoPannerNode>();
  /** The song last mixed: its pans are newer than those of the copy playback started with. */
  private mixed: Song | undefined;

  prepare(_song: Song) {
    this.drums.resetChoke();
  }

  private bus(track: Track): AudioNode {
    let p = this.panners.get(track.id);
    if (!p) {
      const { ctx, master } = audio();
      p = ctx.createStereoPanner();
      p.pan.value = this.mixed?.tracks[track.id]?.pan ?? track.pan;
      p.connect(master);
      this.panners.set(track.id, p);
    }
    return p;
  }

  mix(song: Song) {
    this.mixed = song;
    for (const [id, p] of this.panners) {
      const track = song.tracks[id];
      if (!track) {
        p.disconnect();
        this.panners.delete(id);
      } else if (p.pan.value !== track.pan) {
        // A short glide so moving the slider during playback doesn't click.
        p.pan.setTargetAtTime(track.pan, p.context.currentTime, 0.01);
      }
    }
  }

  playNote(track: Track, pitch: number, when: number, duration: number, velocity: number, palmMute = false) {
    const dest = this.bus(track);
    const nodes =
      track.kind === 'drums'
        ? this.drums.play(pitch, when, velocity, dest)
        : track.kind === 'piano'
          ? this.piano.play(pitch, when, duration, velocity, dest)
          : this.strings.play(dest, pitch, when, duration, velocity, track.kind, palmMute);
    for (const n of nodes) {
      this.sources.add(n);
      n.addEventListener('ended', () => this.sources.delete(n));
    }
  }

  preview(_song: Song, track: Track, pitch: number, palmMute = false) {
    const when = audio().ctx.currentTime + 0.01;
    const dest = this.bus(track);
    if (track.kind === 'drums') this.drums.play(pitch, when, 100, dest);
    else if (track.kind === 'piano') this.piano.play(pitch, when, 0.6, 96, dest);
    else if (palmMute) this.strings.play(dest, pitch, when, MUTED_DECAY_S, 82, track.kind, true);
    else this.strings.play(dest, pitch, when, 0.6, 96, track.kind);
  }

  stopAll() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started or already stopped */
      }
    }
    this.sources.clear();
  }

  dispose() {
    this.stopAll();
    for (const p of this.panners.values()) p.disconnect();
    this.panners.clear();
  }
}
