import { describe, expect, it } from 'vitest';
import { initDocument } from '../model/commands';
import { setTimeSig } from '../model/arrange';
import { meter } from '../model/meter';
import { DocumentStore } from '../model/store';
import { rowLayout } from './rows';

/** A song in 4/4 whose third bar (index 2) is 7/8. */
function song() {
  const s = new DocumentStore({ actor: 'a' });
  s.transact(initDocument(s.getSong()), { undoable: false });
  s.transact(setTimeSig(s.getSong(), { beatsPerBar: 7, beatUnit: 8 }, 2, 2));
  return meter(s.getSong());
}

describe('rowLayout', () => {
  it('holds whole bars at a bar per row or more', () => {
    const rows = rowLayout(song(), 2);
    expect([rows.start(0), rows.end(0), rows.start(1)]).toEqual([0, 3840, 3840]);
    expect(rows.of(3839)).toBe(0);
    expect(rows.of(3840)).toBe(1);
    expect(rows.count(8)).toBe(4);
  });

  it('cuts each bar into equal parts below a bar per row', () => {
    const m = song();
    const rows = rowLayout(m, 0.25);
    expect([0, 1, 2, 3, 4].map(rows.start)).toEqual([0, 480, 960, 1440, 1920]);
    expect(rows.count(8)).toBe(32);
    // The 7/8 bar (1680 ticks) splits into quarters of 420.
    expect([8, 9, 12].map(rows.start)).toEqual([3840, 4260, 3840 + 1680]);
    // Every tick lands in the row whose bounds hold it.
    for (let t = 0; t < m.barStart(4); t += 7) {
      const r = rows.of(t);
      expect(t >= rows.start(r) && t < rows.end(r)).toBe(true);
    }
  });
});
