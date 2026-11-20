/**
 * Ephemeral per-user state (cursor position, name, colour). Kept separate from the
 * document: it is never persisted or undone, and it disappears when a peer leaves.
 */
export interface PeerState {
  actor: string;
  name: string;
  color: string;
  cursor: number;
  string: number;
  trackId: string;
}

type Listener = () => void;

export class Awareness {
  private localState: PeerState;
  private peers = new Map<string, { state: PeerState; seen: number }>();
  private peerList: PeerState[] = [];
  private listeners = new Set<Listener>();
  private localListeners = new Set<(s: PeerState) => void>();

  constructor(initial: PeerState) {
    this.localState = initial;
  }

  get local(): PeerState {
    return this.localState;
  }

  setLocal(patch: Partial<PeerState>) {
    const next = { ...this.localState, ...patch };
    const changed = (Object.keys(patch) as Array<keyof PeerState>).some((k) => next[k] !== this.localState[k]);
    if (!changed) return;
    this.localState = next;
    this.localListeners.forEach((fn) => fn(next));
  }

  onLocalChange(fn: (s: PeerState) => void): () => void {
    this.localListeners.add(fn);
    return () => this.localListeners.delete(fn);
  }

  receive(state: PeerState) {
    this.peers.set(state.actor, { state, seen: Date.now() });
    this.emit();
  }

  remove(actor: string) {
    if (this.peers.delete(actor)) this.emit();
  }

  prune(maxAgeMs: number) {
    const now = Date.now();
    let changed = false;
    for (const [actor, p] of this.peers) {
      if (now - p.seen > maxAgeMs) {
        this.peers.delete(actor);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  getPeers = (): PeerState[] => this.peerList;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    this.peerList = [...this.peers.values()].map((p) => p.state);
    this.listeners.forEach((fn) => fn());
  }
}
