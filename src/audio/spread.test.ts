import { describe, expect, it } from 'vitest';
import { addTrack, initDocument, setTrackPan, sortedTracks } from '../model/commands';
import { DocumentStore } from '../model/store';
import { trackSpread } from './spread';

describe('trackSpread', () => {
  it('leaves centred tracks alone and gives panned neighbours different delays and detunes', () => {
    const s = new DocumentStore({ actor: 'a' });
    s.transact(initDocument(s.getSong()), { undoable: false });
    s.transact(addTrack(s.getSong(), 'guitar').ops);
    s.transact(addTrack(s.getSong(), 'bass').ops);
    const [left, right, centre] = sortedTracks(s.getSong());
    s.transact(setTrackPan(left.id, -1));
    s.transact(setTrackPan(right.id, 1));
    const spread = trackSpread(s.getSong());
    expect(spread.has(centre.id)).toBe(false);
    const a = spread.get(left.id)!;
    const b = spread.get(right.id)!;
    expect(a.delay).not.toBe(b.delay);
    expect(a.cents).not.toBe(b.cents);
    expect(Math.max(a.delay, b.delay)).toBeLessThan(0.02);
  });
});
