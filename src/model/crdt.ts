/**
 * A small state-based + op-based CRDT: collections of last-writer-wins records.
 *
 * - Every field of every record carries a Lamport stamp; a write only lands if
 *   its stamp is newer than the field's current stamp.
 * - Record existence ("alive") is itself an LWW register, so delete vs. re-add
 *   resolves deterministically (this is what makes collaborative undo work).
 * - Applying the same set of ops in any order, or merging snapshots in any
 *   order, converges to the same state.
 *
 * All data here is plain JSON, so ops and snapshots can go over any transport
 * (BroadcastChannel, WebSocket, WebRTC) or into storage unchanged.
 */
import type { ID } from './types';

export interface Stamp {
  /** Lamport clock */
  c: number;
  /** Actor (client) id, used as a tie-breaker */
  a: string;
}

export const ZERO_STAMP: Stamp = { c: 0, a: '' };

export function compareStamps(x: Stamp, y: Stamp): number {
  if (x.c !== y.c) return x.c - y.c;
  if (x.a === y.a) return 0;
  return x.a < y.a ? -1 : 1;
}

export const COLLECTIONS = ['meta', 'tracks', 'notes', 'patterns', 'timeSigs'] as const;
export type Collection = (typeof COLLECTIONS)[number];
export type Fields = Record<string, unknown>;

export type Op =
  | { t: 'put'; coll: Collection; id: ID; value: Fields }
  | { t: 'patch'; coll: Collection; id: ID; patch: Fields }
  | { t: 'del'; coll: Collection; id: ID };

export interface StampedOp {
  op: Op;
  stamp: Stamp;
}

export interface Entry {
  fields: Fields;
  stamps: Record<string, Stamp>;
  alive: boolean;
  aliveStamp: Stamp;
}

export type DocState = Record<Collection, Record<ID, Entry>>;

export function emptyState(): DocState {
  return { meta: {}, tracks: {}, notes: {}, patterns: {}, timeSigs: {} };
}

/** Fill in collections missing from a state saved before they existed. Mutates and returns `state`. */
export function normalizeState(state: DocState): DocState {
  for (const coll of COLLECTIONS) state[coll] ??= {};
  return state;
}

function getEntry(state: DocState, coll: Collection, id: ID): Entry {
  const records = (state[coll] ??= {});
  let e = records[id];
  if (!e) {
    e = { fields: {}, stamps: {}, alive: false, aliveStamp: ZERO_STAMP };
    records[id] = e;
  }
  return e;
}

function writeFields(e: Entry, fields: Fields, stamp: Stamp) {
  for (const [k, v] of Object.entries(fields)) {
    const prev = e.stamps[k];
    if (!prev || compareStamps(stamp, prev) > 0) {
      e.fields[k] = v;
      e.stamps[k] = stamp;
    }
  }
}

/** Mutates `state`. */
export function applyOp(state: DocState, { op, stamp }: StampedOp): void {
  const e = getEntry(state, op.coll, op.id);
  switch (op.t) {
    case 'put':
      if (compareStamps(stamp, e.aliveStamp) > 0) {
        e.alive = true;
        e.aliveStamp = stamp;
      }
      writeFields(e, op.value, stamp);
      break;
    case 'patch':
      writeFields(e, op.patch, stamp);
      break;
    case 'del':
      if (compareStamps(stamp, e.aliveStamp) > 0) {
        e.alive = false;
        e.aliveStamp = stamp;
      }
      break;
  }
}

/** Merge `source` into `target` (mutates target). Returns touched [coll, id] pairs. */
export function mergeState(target: DocState, source: DocState): Array<[Collection, ID]> {
  const touched: Array<[Collection, ID]> = [];
  for (const coll of COLLECTIONS) {
    for (const [id, src] of Object.entries(source[coll] ?? {})) {
      const e = getEntry(target, coll, id);
      if (compareStamps(src.aliveStamp, e.aliveStamp) > 0) {
        e.alive = src.alive;
        e.aliveStamp = src.aliveStamp;
      }
      for (const [k, s] of Object.entries(src.stamps)) {
        const prev = e.stamps[k];
        if (!prev || compareStamps(s, prev) > 0) {
          e.fields[k] = src.fields[k];
          e.stamps[k] = s;
        }
      }
      touched.push([coll, id]);
    }
  }
  return touched;
}

export function maxClock(state: DocState): number {
  let max = 0;
  for (const coll of COLLECTIONS) {
    for (const e of Object.values(state[coll] ?? {})) {
      max = Math.max(max, e.aliveStamp.c);
      for (const s of Object.values(e.stamps)) max = Math.max(max, s.c);
    }
  }
  return max;
}
