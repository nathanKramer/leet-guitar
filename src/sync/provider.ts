import type { DocState, StampedOp } from '../model/crdt';
import type { DocumentStore } from '../model/store';
import type { Awareness, PeerState } from './awareness';

/**
 * A transport that keeps a DocumentStore in sync with peers.
 * Implementations only move JSON messages around; all merge logic lives in the store.
 *
 * To add real-time collaboration over the network, implement this with a
 * WebSocket (relay server) or WebRTC, using the same message shapes.
 */
export interface SyncProvider {
  connect(store: DocumentStore, awareness: Awareness): () => void;
}

export type SyncMessage =
  | { type: 'ops'; from: string; ops: StampedOp[] }
  | { type: 'hello'; from: string }
  | { type: 'snapshot'; from: string; to: string; state: DocState }
  | { type: 'presence'; from: string; state: PeerState }
  | { type: 'bye'; from: string };
