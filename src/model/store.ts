import {
  applyOp,
  emptyState,
  maxClock,
  mergeState,
  normalizeState,
  type Collection,
  type DocState,
  type Op,
  type StampedOp,
} from './crdt';
import { DEFAULT_META, materialize, META_ID, readMeta, readNote, readPattern, readTimeSig, readTrack } from './materialize';
import type { ID, Song } from './types';

type Listener = () => void;
type OpsListener = (ops: StampedOp[]) => void;

const UNDO_LIMIT = 200;
/** Edits sharing a `coalesce` key within this many ms of each other merge into one undo entry. */
const COALESCE_MS = 1000;

/**
 * Owns the CRDT state for one document and exposes:
 * - `transact(ops)` for local edits (stamped, applied, broadcast to sync providers, undoable)
 * - `applyRemote(ops)` / `mergeSnapshot(state)` for edits arriving from peers
 * - `getSong()` / `subscribe()` for React (`useSyncExternalStore`)
 *
 * Undo is per-client: it records inverse ops and replays them as new edits,
 * so undoing never rewinds a collaborator's work.
 */
export class DocumentStore {
  readonly actor: string;
  private clock: number;
  private state: DocState;
  private song: Song;
  private listeners = new Set<Listener>();
  private localOpsListeners = new Set<OpsListener>();
  private undoStack: Op[][] = [];
  private redoStack: Op[][] = [];
  /** Key and time of the newest undo entry, when it was made with `coalesce`. */
  private lastCoalesce: { key: string; at: number } | null = null;

  constructor(opts: { actor: string; state?: DocState }) {
    this.actor = opts.actor;
    this.state = opts.state ? normalizeState(opts.state) : emptyState();
    this.clock = maxClock(this.state);
    this.song = materialize(this.state);
  }

  getSong = (): Song => this.song;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Sync providers listen here to forward local edits to peers. */
  onLocalOps(fn: OpsListener): () => void {
    this.localOpsListeners.add(fn);
    return () => this.localOpsListeners.delete(fn);
  }

  /** Deep copy of the full CRDT state, for persistence or sending to a joining peer. */
  getSnapshot(): DocState {
    return structuredClone(this.state);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * `coalesce` merges a run of edits into one undo entry: while each edit has the
   * same key and comes within COALESCE_MS of the previous one, the newest entry's
   * inverse (which restores the state from before the run) is kept and later
   * inverses are dropped. For repeated edits to the same fields, such as holding
   * a spinner arrow.
   */
  transact(ops: Op[], opts: { undoable?: boolean; coalesce?: string; now?: number } = {}): void {
    if (ops.length === 0) return;
    const inverse = this.commit(ops);
    if (opts.undoable === false || !inverse.length) return;
    const now = opts.now ?? Date.now();
    const last = this.lastCoalesce;
    const merge =
      opts.coalesce !== undefined &&
      last?.key === opts.coalesce &&
      now - last.at <= COALESCE_MS &&
      this.undoStack.length > 0;
    if (!merge) {
      this.undoStack.push(inverse);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastCoalesce = opts.coalesce !== undefined ? { key: opts.coalesce, at: now } : null;
  }

  undo(): void {
    this.lastCoalesce = null;
    const ops = this.undoStack.pop();
    if (ops) this.redoStack.push(this.commit(ops));
  }

  redo(): void {
    this.lastCoalesce = null;
    const ops = this.redoStack.pop();
    if (ops) this.undoStack.push(this.commit(ops));
  }

  applyRemote(ops: StampedOp[]): void {
    const touched: Array<[Collection, ID]> = [];
    for (const s of ops) {
      this.clock = Math.max(this.clock, s.stamp.c);
      applyOp(this.state, s);
      touched.push([s.op.coll, s.op.id]);
    }
    this.refresh(touched);
  }

  mergeSnapshot(remote: DocState): void {
    this.clock = Math.max(this.clock, maxClock(remote));
    this.refresh(mergeState(this.state, remote));
  }

  /** Stamp, apply and broadcast ops. Returns the ops that would undo them. */
  private commit(ops: Op[]): Op[] {
    const inverse: Op[] = [];
    const stamped: StampedOp[] = [];
    for (const op of ops) {
      const inv = this.invert(op);
      if (inv) inverse.push(inv);
      const s: StampedOp = { op, stamp: { c: ++this.clock, a: this.actor } };
      applyOp(this.state, s);
      stamped.push(s);
    }
    this.refresh(stamped.map((s) => [s.op.coll, s.op.id]));
    this.localOpsListeners.forEach((fn) => fn(stamped));
    return inverse.reverse();
  }

  private invert(op: Op): Op | null {
    const e = this.state[op.coll]?.[op.id];
    const { coll, id } = op;
    switch (op.t) {
      case 'put':
        return e?.alive ? { t: 'put', coll, id, value: { ...e.fields } } : { t: 'del', coll, id };
      case 'patch': {
        // A song setting that was never written reads as its default, so undo writes the default back.
        const defaults: Record<string, unknown> = coll === 'meta' ? { ...DEFAULT_META } : {};
        const prev: Record<string, unknown> = {};
        for (const k of Object.keys(op.patch)) {
          if (e && k in e.fields) prev[k] = e.fields[k];
          else if (k in defaults) prev[k] = defaults[k];
        }
        if (!Object.keys(prev).length) return null;
        return { t: 'patch', coll, id, patch: prev };
      }
      case 'del':
        return e?.alive ? { t: 'put', coll, id, value: { ...e.fields } } : null;
    }
  }

  /** Re-materialize only the touched records, keeping referential identity elsewhere. */
  private refresh(touched: Array<[Collection, ID]>): void {
    if (touched.length === 0) return;
    let { meta, tracks, notes, patterns, timeSigs } = this.song;
    let timeSigsCopied = false;
    let tracksCopied = false;
    let notesCopied = false;
    let patternsCopied = false;
    for (const [coll, id] of touched) {
      if (coll === 'meta') {
        if (id === META_ID) meta = readMeta(this.state.meta[id]);
      } else if (coll === 'tracks') {
        if (!tracksCopied) (tracks = { ...tracks }), (tracksCopied = true);
        const t = readTrack(id, this.state.tracks[id]);
        if (t) tracks[id] = t;
        else delete tracks[id];
      } else if (coll === 'timeSigs') {
        if (!timeSigsCopied) (timeSigs = { ...timeSigs }), (timeSigsCopied = true);
        const t = readTimeSig(this.state.timeSigs[id]);
        if (t) timeSigs[id] = t;
        else delete timeSigs[id];
      } else if (coll === 'patterns') {
        if (!patternsCopied) (patterns = { ...patterns }), (patternsCopied = true);
        const p = readPattern(id, this.state.patterns[id]);
        if (p) patterns[id] = p;
        else delete patterns[id];
      } else {
        if (!notesCopied) (notes = { ...notes }), (notesCopied = true);
        const n = readNote(id, this.state.notes[id]);
        if (n) notes[id] = n;
        else delete notes[id];
      }
    }
    this.song = { meta, tracks, notes, patterns, timeSigs };
    this.listeners.forEach((fn) => fn());
  }
}
