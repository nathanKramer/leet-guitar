import type { Meter } from '../model/meter';

/**
 * How the timeline splits into rows for a given bars-per-row setting. At 1 bar per row or more, each row holds
 * whole bars; below that (½, ¼), each bar is cut into equal parts, one part per row.
 */
export interface RowLayout {
  /** Where row `r` starts, in ticks. */
  start(r: number): number;
  /** Where row `r` ends (the start of the next row), in ticks. */
  end(r: number): number;
  /** The row a tick falls in. */
  of(tick: number): number;
  /** How many rows cover the first `bars` bars. */
  count(bars: number): number;
}

export function rowLayout(m: Meter, barsPerRow: number): RowLayout {
  if (barsPerRow >= 1) {
    const start = (r: number) => m.barStart(r * barsPerRow);
    return {
      start,
      end: (r) => start(r + 1),
      of: (tick) => Math.floor(m.barAt(tick) / barsPerRow),
      count: (bars) => Math.ceil(bars / barsPerRow),
    };
  }
  const split = Math.round(1 / barsPerRow);
  const start = (r: number) => {
    const b = Math.floor(r / split);
    return m.barStart(b) + Math.round((m.barLength(b) * (r % split)) / split);
  };
  return {
    start,
    end: (r) => start(r + 1),
    of: (tick) => {
      const b = m.barAt(tick);
      let r = b * split + Math.floor(((tick - m.barStart(b)) * split) / m.barLength(b));
      // Part boundaries are rounded to whole ticks; nudge onto the row that really holds the tick.
      while (r > b * split && tick < start(r)) r--;
      while (r < (b + 1) * split - 1 && tick >= start(r + 1)) r++;
      return r;
    },
    count: (bars) => bars * split,
  };
}
