import { describe, expect, it } from 'vitest';
import { addNote, DEFAULT_TRACK_ID, initDocument, moveNotes, moveToString, setMeta } from './commands';
import { applyOp, emptyState, mergeState, type StampedOp } from './crdt';
import { BASE_TICKS, describeDuration, durationTicks, PPQ } from './durations';
import { materialize } from './materialize';
import { DocumentStore } from './store';

function newStore(actor: string) {
  const s = new DocumentStore({ actor });
  s.transact(initDocument(s.getSong()), { undoable: false });
  return s;
}

const noteAt = (start: number, string = 0, fret = 3, duration = 240) => ({
  trackId: DEFAULT_TRACK_ID,
  string,
  fret,
  start,
  duration,
  velocity: 96,
});

describe('durations', () => {
  it('triplets fit three in the space of two', () => {
    expect(durationTicks('eighth', true)).toBe(160);
    expect(durationTicks('sixteenth', true)).toBe(80);
    expect(durationTicks('quarter', true) * 3).toBe(BASE_TICKS.half);
    expect(durationTicks('eighth', true) * 3).toBe(PPQ);
  });

  it('all durations are whole ticks', () => {
    for (const base of Object.keys(BASE_TICKS) as Array<keyof typeof BASE_TICKS>) {
      expect(Number.isInteger(durationTicks(base, true))).toBe(true);
    }
  });

  it('describes tick lengths', () => {
    expect(describeDuration(160)).toEqual({ base: 'eighth', triplet: true });
    expect(describeDuration(480)).toEqual({ base: 'quarter', triplet: false });
    expect(describeDuration(100)).toBeNull();
  });
});

describe('crdt', () => {
  it('converges regardless of op order', () => {
    const ops: StampedOp[] = [
      { op: { t: 'put', coll: 'notes', id: 'n', value: { fret: 1, start: 0 } }, stamp: { c: 1, a: 'a' } },
      { op: { t: 'patch', coll: 'notes', id: 'n', patch: { fret: 5 } }, stamp: { c: 2, a: 'b' } },
      { op: { t: 'patch', coll: 'notes', id: 'n', patch: { fret: 7 } }, stamp: { c: 2, a: 'a' } },
      { op: { t: 'del', coll: 'notes', id: 'n' }, stamp: { c: 3, a: 'a' } },
      { op: { t: 'put', coll: 'notes', id: 'n', value: { fret: 9 } }, stamp: { c: 4, a: 'b' } },
    ];
    const forward = emptyState();
    ops.forEach((o) => applyOp(forward, o));
    const backward = emptyState();
    [...ops].reverse().forEach((o) => applyOp(backward, o));
    expect(backward).toEqual(forward);
    expect(forward.notes.n.alive).toBe(true);
    expect(forward.notes.n.fields.fret).toBe(9);
  });

  it('merge is commutative and idempotent', () => {
    const a = newStore('a');
    const b = newStore('b');
    a.transact(addNote(a.getSong(), noteAt(0)).ops);
    b.transact(addNote(b.getSong(), noteAt(240, 1)).ops);
    b.transact(setMeta({ bpm: 90 }));

    const ab = mergeThenMaterialize(a.getSnapshot(), b.getSnapshot());
    const ba = mergeThenMaterialize(b.getSnapshot(), a.getSnapshot());
    expect(ab).toEqual(ba);
    expect(Object.keys(ab.notes)).toHaveLength(2);
    expect(ab.meta.bpm).toBe(90);
    expect(mergeThenMaterialize(a.getSnapshot(), a.getSnapshot())).toEqual(a.getSong());
  });
});

function mergeThenMaterialize(x: ReturnType<DocumentStore['getSnapshot']>, y: typeof x) {
  mergeState(x, y);
  return materialize(x);
}

describe('DocumentStore', () => {
  it('syncs two peers via ops', () => {
    const a = newStore('a');
    const b = newStore('b');
    a.onLocalOps((ops) => b.applyRemote(ops));
    b.onLocalOps((ops) => a.applyRemote(ops));
    a.transact(addNote(a.getSong(), noteAt(0)).ops);
    b.transact(addNote(b.getSong(), noteAt(480, 2)).ops);
    expect(a.getSong()).toEqual(b.getSong());
    expect(Object.keys(a.getSong().notes)).toHaveLength(2);
  });

  it('undo/redo only affects local edits', () => {
    const a = newStore('a');
    const b = newStore('b');
    a.onLocalOps((ops) => b.applyRemote(ops));
    b.onLocalOps((ops) => a.applyRemote(ops));
    const { ops, id } = addNote(a.getSong(), noteAt(0));
    a.transact(ops);
    b.transact(addNote(b.getSong(), noteAt(480, 2)).ops);

    a.undo();
    expect(a.getSong().notes[id]).toBeUndefined();
    expect(Object.keys(b.getSong().notes)).toHaveLength(1);
    a.redo();
    expect(b.getSong().notes[id]?.fret).toBe(3);
  });

  it('keeps identity of untouched collections', () => {
    const a = newStore('a');
    const before = a.getSong();
    a.transact(setMeta({ title: 'Riff' }));
    expect(a.getSong().notes).toBe(before.notes);
    expect(a.getSong().meta.title).toBe('Riff');
  });
});

describe('commands', () => {
  it('a new note on the same string cuts off a ringing note', () => {
    const s = newStore('a');
    const first = addNote(s.getSong(), noteAt(0, 0, 3, 480));
    s.transact(first.ops);
    s.transact(addNote(s.getSong(), noteAt(240, 0, 5, 240)).ops);
    expect(s.getSong().notes[first.id].duration).toBe(240);
  });

  it('replaces notes starting inside the new note on the same string, keeps other strings', () => {
    const s = newStore('a');
    const a = addNote(s.getSong(), noteAt(240, 0));
    s.transact(a.ops);
    const other = addNote(s.getSong(), noteAt(240, 1));
    s.transact(other.ops);
    s.transact(addNote(s.getSong(), noteAt(0, 0, 7, 480)).ops);
    expect(s.getSong().notes[a.id]).toBeUndefined();
    expect(s.getSong().notes[other.id]).toBeDefined();
  });

  it('moves a note to another string keeping its pitch', () => {
    const s = newStore('a');
    const { ops, id } = addNote(s.getSong(), noteAt(0, 0, 5)); // high E, fret 5 = A4
    s.transact(ops);
    s.transact(moveToString(s.getSong(), [id], 1));
    const n = s.getSong().notes[id];
    expect(n.string).toBe(1);
    expect(n.fret).toBe(10); // B string fret 10 = A4
  });

  it('moving a note onto another on the same string replaces it, but not when both move', () => {
    const s = newStore('a');
    const a = addNote(s.getSong(), noteAt(0));
    s.transact(a.ops);
    const b = addNote(s.getSong(), noteAt(240));
    s.transact(b.ops);
    s.transact(moveNotes(s.getSong(), [a.id, b.id], 240));
    expect(Object.keys(s.getSong().notes)).toHaveLength(2);
    s.transact(moveNotes(s.getSong(), [a.id], 240));
    expect(s.getSong().notes[b.id]).toBeUndefined();
    expect(s.getSong().notes[a.id].start).toBe(480);
  });
});
