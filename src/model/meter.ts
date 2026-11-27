/**
 * Bars and time signatures. The song's first bar takes its time signature from the song settings; any later bar
 * can change it, and a change holds until the next one (as in written music). Everything that turns ticks into
 * bars or bars into ticks goes through a Meter, since bars can differ in length.
 */
import type { Op } from './crdt';
import { PPQ } from './durations';
import { META_ID } from './materialize';
import type { Song, TimeSig, TimeSigChange } from './types';

/** A run of bars that share a time signature, starting at bar `bar` (tick `tick`). */
interface Segment {
  bar: number;
  tick: number;
  sig: TimeSig;
  /** Ticks per bar. */
  len: number;
}

export const sameSig = (a: TimeSig, b: TimeSig) => a.beatsPerBar === b.beatsPerBar && a.beatUnit === b.beatUnit;
export const sigLabel = (s: TimeSig) => `${s.beatsPerBar}/${s.beatUnit}`;
export const sigBeatTicks = (s: TimeSig) => (PPQ * 4) / s.beatUnit;
export const sigBarTicks = (s: TimeSig) => s.beatsPerBar * sigBeatTicks(s);

/** The CRDT id of the time signature change at a bar (one record per bar, so concurrent edits converge). */
export const timeSigId = (bar: number) => `bar-${bar}`;

export class Meter {
  private readonly segs: Segment[];

  /** `changes` need not be sorted; changes at bar 0 or that repeat the previous signature are ignored. */
  constructor(first: TimeSig, changes: Iterable<TimeSigChange> = []) {
    const segs: Segment[] = [{ bar: 0, tick: 0, sig: pick(first), len: sigBarTicks(first) }];
    const sorted = [...changes].filter((c) => Number.isInteger(c.bar) && c.bar > 0).sort((a, b) => a.bar - b.bar);
    for (const c of sorted) {
      const prev = segs[segs.length - 1];
      if (c.bar === prev.bar || sameSig(c, prev.sig)) continue;
      segs.push({ bar: c.bar, tick: prev.tick + (c.bar - prev.bar) * prev.len, sig: pick(c), len: sigBarTicks(c) });
    }
    this.segs = segs;
  }

  /** A meter with these signatures for bars 0..n-1; later bars keep the last one. */
  static fromBars(sigs: TimeSig[]): Meter {
    return new Meter(
      sigs[0],
      sigs.map((s, bar) => ({ bar, ...s })),
    );
  }

  private segForBar(bar: number): Segment {
    let lo = 0;
    for (let i = 1; i < this.segs.length && this.segs[i].bar <= bar; i++) lo = i;
    return this.segs[lo];
  }

  private segForTick(tick: number): Segment {
    let lo = 0;
    for (let i = 1; i < this.segs.length && this.segs[i].tick <= tick; i++) lo = i;
    return this.segs[lo];
  }

  sigAt(bar: number): TimeSig {
    return this.segForBar(bar).sig;
  }

  /** Whether bar `bar` starts a new time signature (bar 0 always does). */
  changesAt(bar: number): boolean {
    return this.segForBar(bar).bar === bar;
  }

  barStart(bar: number): number {
    const s = this.segForBar(bar);
    return s.tick + (bar - s.bar) * s.len;
  }

  barLength(bar: number): number {
    return this.segForBar(bar).len;
  }

  beatTicks(bar: number): number {
    return sigBeatTicks(this.segForBar(bar).sig);
  }

  /** The bar a tick falls in, counting from 0. */
  barAt(tick: number): number {
    const s = this.segForTick(tick);
    return s.bar + Math.floor((tick - s.tick) / s.len);
  }

  /** The first bar after `bar` that changes time signature, or Infinity if none does. */
  nextChange(bar: number): number {
    return this.segs.find((s) => s.bar > bar)?.bar ?? Infinity;
  }

  /** The first bar after which nothing changes (later bars all share one signature). */
  get settledFrom(): number {
    return this.segs[this.segs.length - 1].bar;
  }

  /** Snap down to the grid of `step`, measured from the start of the tick's bar. */
  snap(tick: number, step: number): number {
    const t = Math.max(0, tick);
    const start = this.barStart(this.barAt(t));
    return start + Math.floor((t - start) / step) * step;
  }

  /** Round to the nearest point on the grid of `step` in the tick's bar (or the next bar line, if nearer). */
  round(tick: number, step: number): number {
    const t = Math.max(0, tick);
    const bar = this.barAt(t);
    const start = this.barStart(bar);
    return Math.min(this.barStart(bar + 1), start + Math.round((t - start) / step) * step);
  }

  /**
   * The next grid point after `tick` (dir 1) or before it (dir -1), on the grid of `step` in each bar, never
   * stepping over a bar line: a bar that isn't a whole number of steps long ends on a short step.
   */
  step(tick: number, step: number, dir: 1 | -1): number {
    if (dir > 0) {
      const bar = this.barAt(tick);
      const start = this.barStart(bar);
      return Math.min(this.barStart(bar + 1), start + (Math.floor((tick - start) / step) + 1) * step);
    }
    if (tick <= 0) return 0;
    return this.snap(tick - 1, step);
  }
}

const pick = (s: TimeSig): TimeSig => ({ beatsPerBar: s.beatsPerBar, beatUnit: s.beatUnit });

const cache = new WeakMap<object, Meter>();

/** The song's meter (cached per song snapshot). */
export function meter(song: Pick<Song, 'meta' | 'timeSigs'>): Meter {
  let m = cache.get(song);
  if (!m) {
    m = new Meter(song.meta, Object.values(song.timeSigs ?? {}));
    cache.set(song, m);
  }
  return m;
}

/** Each bar's signature for bars 0..count-1. */
export function barSigs(m: Meter, count: number): TimeSig[] {
  return Array.from({ length: count }, (_, b) => m.sigAt(b));
}

/**
 * Ops that make the song's time signatures `sigs` (one per bar, from bar 0; later bars keep the last one): the
 * first bar's goes in the song settings, the rest as change records wherever the signature changes.
 */
export function timeSigOps(song: Song, sigs: TimeSig[]): Op[] {
  const ops: Op[] = [];
  if (!sigs.length) return ops;
  if (!sameSig(sigs[0], song.meta)) ops.push({ t: 'patch', coll: 'meta', id: META_ID, patch: { ...pick(sigs[0]) } });
  const want = new Map<string, TimeSigChange>();
  for (let b = 1; b < sigs.length; b++) {
    if (!sameSig(sigs[b], sigs[b - 1])) want.set(timeSigId(b), { bar: b, ...pick(sigs[b]) });
  }
  const have = song.timeSigs ?? {};
  for (const id of Object.keys(have)) if (!want.has(id)) ops.push({ t: 'del', coll: 'timeSigs', id });
  for (const [id, c] of want) {
    const old = have[id];
    if (!old || old.bar !== c.bar || !sameSig(old, c)) ops.push({ t: 'put', coll: 'timeSigs', id, value: { ...c } });
  }
  return ops;
}
