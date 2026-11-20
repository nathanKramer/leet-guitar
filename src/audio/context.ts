/** Shared AudioContext and master bus, created lazily on first use (browsers require a user gesture). */
let shared: { ctx: AudioContext; master: GainNode } | undefined;

export function audio() {
  if (!shared) {
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(comp).connect(ctx.destination);
    shared = { ctx, master };
  }
  if (shared.ctx.state === 'suspended') void shared.ctx.resume();
  return shared;
}
