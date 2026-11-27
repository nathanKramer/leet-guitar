/** Synthesized drum kit (no samples), keyed by General MIDI drum note. */
import { audio } from './context';

type Voice = 'kick' | 'snare' | 'hat' | 'openhat' | 'crash' | 'ride' | 'tom' | 'clap' | 'click';

function voiceFor(pitch: number): { voice: Voice; tune?: number } {
  switch (pitch) {
    case 35:
    case 36:
      return { voice: 'kick' };
    case 38:
    case 40:
      return { voice: 'snare' };
    case 37:
      return { voice: 'click' };
    case 39:
      return { voice: 'clap' };
    case 42:
    case 44:
      return { voice: 'hat' };
    case 46:
      return { voice: 'openhat' };
    case 49:
    case 52:
    case 55:
    case 57:
      return { voice: 'crash' };
    case 51:
    case 53:
    case 59:
      return { voice: 'ride' };
    // Toms, low to high: 41 43 45 47 48 50
    case 41:
    case 43:
    case 45:
    case 47:
    case 48:
    case 50:
      return { voice: 'tom', tune: 80 + (pitch - 41) * 14 };
    default:
      return { voice: 'click' };
  }
}

/** Frequency ratios of detuned square waves that make a convincing metallic cymbal tone (808-style). */
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

export class DrumSynth {
  private noise?: AudioBuffer;
  private openHat?: GainNode;

  resetChoke() {
    this.openHat = undefined;
  }

  private noiseBuffer(ctx: AudioContext) {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** Returns the scheduled sources so playback can stop them. */
  play(pitch: number, when: number, velocity: number, dest: AudioNode): AudioScheduledSourceNode[] {
    const { ctx } = audio();
    const level = Math.max(0.05, velocity / 127);
    const { voice, tune } = voiceFor(pitch);
    const out: AudioScheduledSourceNode[] = [];

    const envelope = (peak: number, decay: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak * level, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      g.connect(dest);
      return g;
    };
    const osc = (type: OscillatorType, freq: number, dest: AudioNode, stopAt: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, when);
      o.connect(dest);
      o.start(when);
      o.stop(stopAt);
      out.push(o);
      return o;
    };
    const noise = (dest: AudioNode, stopAt: number) => {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer(ctx);
      n.connect(dest);
      // Start somewhere random in the noise, so hits on two drum tracks at once aren't identical.
      n.start(when, Math.random() * (n.buffer.duration - (stopAt - when)));
      n.stop(stopAt);
      out.push(n);
      return n;
    };
    const filter = (type: BiquadFilterType, freq: number, dest: AudioNode, q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      f.connect(dest);
      return f;
    };
    const metal = (dest: AudioNode, stopAt: number) => {
      for (const r of METAL_RATIOS) osc('square', 40 * r, dest, stopAt);
    };
    const chokeOpenHat = () => {
      const g = this.openHat?.gain;
      if (!g) return;
      if ('cancelAndHoldAtTime' in g) g.cancelAndHoldAtTime(when);
      else (g as AudioParam).cancelScheduledValues(when);
      g.setTargetAtTime(0.0001, when, 0.008);
      this.openHat = undefined;
    };

    switch (voice) {
      case 'kick': {
        const g = envelope(1.2, 0.45);
        const o = osc('sine', 150, g, when + 0.5);
        o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
        break;
      }
      case 'snare': {
        noise(filter('highpass', 1200, envelope(0.7, 0.2)), when + 0.25);
        osc('triangle', 185, envelope(0.5, 0.1), when + 0.15);
        break;
      }
      case 'clap': {
        noise(filter('bandpass', 1500, envelope(0.8, 0.18), 2), when + 0.2);
        break;
      }
      case 'click': {
        osc('square', 1800, envelope(0.25, 0.03), when + 0.05);
        break;
      }
      case 'tom': {
        const g = envelope(0.9, 0.45);
        const o = osc('sine', tune ?? 120, g, when + 0.5);
        o.frequency.exponentialRampToValueAtTime((tune ?? 120) * 0.6, when + 0.3);
        break;
      }
      case 'hat': {
        chokeOpenHat();
        metal(filter('highpass', 7000, filter('bandpass', 10000, envelope(0.35, 0.06))), when + 0.1);
        break;
      }
      case 'openhat': {
        chokeOpenHat();
        const g = envelope(0.35, 0.45);
        metal(filter('highpass', 7000, filter('bandpass', 10000, g)), when + 0.5);
        this.openHat = g;
        break;
      }
      case 'crash': {
        const g = envelope(0.4, 1.6);
        const hp = filter('highpass', 5000, g);
        metal(hp, when + 1.7);
        noise(hp, when + 1.7);
        break;
      }
      case 'ride': {
        const g = envelope(0.25, 1.1);
        metal(filter('bandpass', 6000, g, 0.8), when + 1.2);
        osc('sine', 2400, envelope(0.08, 0.6), when + 0.7);
        break;
      }
    }
    return out;
  }
}
