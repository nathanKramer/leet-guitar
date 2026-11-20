/** The default engine: synthesized in the browser, nothing to download. */
import { midiToFrequency } from '../model/music';
import type { Song, Track } from '../model/types';
import { audio } from './context';
import { DrumSynth } from './drums';
import type { SoundEngine } from './engine';

/** Karplus-Strong plucked string, rendered once per pitch and cached. */
class GuitarSynth {
  private cache = new Map<number, { buffer: AudioBuffer; rate: number }>();

  private voice(midi: number) {
    const hit = this.cache.get(midi);
    if (hit) return hit;
    const { ctx } = audio();
    const sr = ctx.sampleRate;
    const freq = midiToFrequency(midi);
    // The two-point average adds half a sample of delay; the leftover fractional
    // error is corrected with playbackRate so every pitch is in tune.
    const period = Math.max(2, Math.round(sr / freq - 0.5));
    const rate = (freq * (period + 0.5)) / sr;
    const length = Math.floor(sr * 3);
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
    const decay = 0.996;
    let idx = 0;
    for (let i = 0; i < length; i++) {
      const next = (idx + 1) % period;
      out[i] = ring[idx];
      ring[idx] = (ring[idx] + ring[next]) * 0.5 * decay;
      idx = next;
    }
    const v = { buffer, rate };
    this.cache.set(midi, v);
    return v;
  }

  play(midi: number, when: number, duration: number, velocity = 96): AudioScheduledSourceNode[] {
    const { ctx, master } = audio();
    const { buffer, rate } = this.voice(midi);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    const level = (velocity / 127) * 0.9;
    const release = 0.05;
    gain.gain.setValueAtTime(level, when);
    gain.gain.setValueAtTime(level, when + duration);
    gain.gain.linearRampToValueAtTime(0, when + duration + release);
    src.connect(gain).connect(master);
    src.start(when);
    src.stop(when + duration + release + 0.01);
    return [src];
  }
}

export class BuiltInEngine implements SoundEngine {
  private guitar = new GuitarSynth();
  private drums = new DrumSynth();
  private sources = new Set<AudioScheduledSourceNode>();

  prepare(_song: Song) {
    this.drums.resetChoke();
  }

  playNote(track: Track, pitch: number, when: number, duration: number, velocity: number) {
    const nodes =
      track.kind === 'drums' ? this.drums.play(pitch, when, velocity) : this.guitar.play(pitch, when, duration, velocity);
    for (const n of nodes) {
      this.sources.add(n);
      n.addEventListener('ended', () => this.sources.delete(n));
    }
  }

  preview(_song: Song, track: Track, pitch: number) {
    const when = audio().ctx.currentTime + 0.01;
    if (track.kind === 'drums') this.drums.play(pitch, when, 100);
    else this.guitar.play(pitch, when, 0.6);
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
  }
}
