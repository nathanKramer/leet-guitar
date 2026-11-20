/** A small additive piano: no samples, a handful of oscillators per note. */
import { midiToFrequency } from '../model/music';
import { audio } from './context';

/** Piano strings are stiff, so overtones run slightly sharp of whole multiples. */
const INHARMONICITY = 0.0002;
const PARTIALS = 6;
const RELEASE_S = 0.12;
const LEVEL = 0.25;

export class PianoSynth {
  play(midi: number, when: number, duration: number, velocity: number): AudioScheduledSourceNode[] {
    const { ctx, master } = audio();
    const f0 = midiToFrequency(midi);
    const vel = Math.max(0.05, velocity / 127);
    // Low notes ring for seconds, high notes die away quickly.
    const decay = Math.min(4, Math.max(0.35, 3 * Math.pow(0.5, (midi - 48) / 20)));
    const end = when + duration;
    const stopAt = end + RELEASE_S * 5;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(LEVEL * vel, when + 0.004);
    out.gain.setTargetAtTime(0, when + 0.004, decay);
    out.gain.setTargetAtTime(0, end, RELEASE_S); // damper falls on key release

    // Harder strikes are brighter; the tone mellows as the note decays.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    tone.frequency.setValueAtTime(Math.min(18000, f0 * (4 + 12 * vel)), when);
    tone.frequency.setTargetAtTime(Math.min(18000, f0 * 3), when + 0.01, decay * 0.6);
    tone.connect(out).connect(master);

    const sources: AudioScheduledSourceNode[] = [];
    const partial = (freq: number, amp: number, partialDecay: number) => {
      if (freq > 16000) return;
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, when);
      g.gain.setTargetAtTime(0, when, partialDecay);
      o.connect(g).connect(tone);
      o.start(when);
      o.stop(stopAt);
      sources.push(o);
    };
    for (let n = 1; n <= PARTIALS; n++) {
      const freq = f0 * n * Math.sqrt(1 + INHARMONICITY * n * n);
      partial(freq, 1 / Math.pow(n, 1.3), decay / Math.pow(n, 0.6));
    }
    // A second, slightly detuned fundamental: unison strings beating gently.
    partial(f0 * 1.0012, 0.35, decay);
    return sources;
  }
}
