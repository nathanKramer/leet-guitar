import { ticksToSeconds } from '../model/durations';
import { midiToFrequency } from '../model/music';
import type { Song } from '../model/types';

/** Karplus-Strong plucked string, rendered once per pitch and cached. */
class GuitarSynth {
  private ctx?: AudioContext;
  private master?: GainNode;
  private cache = new Map<number, { buffer: AudioBuffer; rate: number }>();

  context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private voice(midi: number) {
    const hit = this.cache.get(midi);
    if (hit) return hit;
    const ctx = this.context();
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

  play(midi: number, when: number, duration: number, velocity = 96): AudioBufferSourceNode {
    const ctx = this.context();
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
    src.connect(gain).connect(this.master!);
    src.start(when);
    src.stop(when + duration + release + 0.01);
    return src;
  }
}

export class Player {
  private synth = new GuitarSynth();
  private sources: AudioBufferSourceNode[] = [];
  private raf = 0;

  /** Short audition when placing a note. */
  preview(midi: number) {
    const ctx = this.synth.context();
    this.synth.play(midi, ctx.currentTime + 0.01, 0.6);
  }

  play(song: Song, fromTick: number, onTick: (tick: number) => void, onEnd: () => void) {
    this.stop();
    const ctx = this.synth.context();
    const bpm = song.meta.bpm;
    const t0 = ctx.currentTime + 0.08;
    let endTick = fromTick;
    for (const n of Object.values(song.notes)) {
      if (n.start < fromTick) continue;
      const track = song.tracks[n.trackId];
      if (!track) continue;
      const pitch = track.tuning[n.string] + n.fret;
      const when = t0 + ticksToSeconds(n.start - fromTick, bpm);
      this.sources.push(this.synth.play(pitch, when, ticksToSeconds(n.duration, bpm), n.velocity));
      endTick = Math.max(endTick, n.start + n.duration);
    }
    const secondsPerTick = ticksToSeconds(1, bpm);
    const frame = () => {
      const tick = fromTick + Math.max(0, ctx.currentTime - t0) / secondsPerTick;
      if (tick >= endTick) {
        this.stop();
        onEnd();
        return;
      }
      onTick(tick);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }
}
