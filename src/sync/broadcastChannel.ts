import type { DocumentStore } from '../model/store';
import type { Awareness } from './awareness';
import type { SyncMessage, SyncProvider } from './provider';

const HEARTBEAT_MS = 2000;
const PEER_TIMEOUT_MS = 6000;

/**
 * Syncs between browser tabs on the same origin. Exercises the full
 * collaboration path (op broadcast, snapshot handshake, presence) without a server.
 */
export class BroadcastChannelProvider implements SyncProvider {
  constructor(private room: string) {}

  connect(store: DocumentStore, awareness: Awareness): () => void {
    if (typeof BroadcastChannel === 'undefined') return () => {};
    const ch = new BroadcastChannel(`leet-guitar:${this.room}`);
    const me = store.actor;
    const send = (m: SyncMessage) => ch.postMessage(m);

    ch.onmessage = (ev: MessageEvent<SyncMessage>) => {
      const m = ev.data;
      if (!m || m.from === me) return;
      switch (m.type) {
        case 'ops':
          store.applyRemote(m.ops);
          break;
        case 'hello':
          send({ type: 'snapshot', from: me, to: m.from, state: store.getSnapshot() });
          send({ type: 'presence', from: me, state: awareness.local });
          break;
        case 'snapshot':
          if (m.to === me) store.mergeSnapshot(m.state);
          break;
        case 'presence':
          awareness.receive(m.state);
          break;
        case 'bye':
          awareness.remove(m.from);
          break;
      }
    };

    const offOps = store.onLocalOps((ops) => send({ type: 'ops', from: me, ops }));
    const offPresence = awareness.onLocalChange((state) => send({ type: 'presence', from: me, state }));
    const heartbeat = setInterval(() => {
      send({ type: 'presence', from: me, state: awareness.local });
      awareness.prune(PEER_TIMEOUT_MS);
    }, HEARTBEAT_MS);
    const onUnload = () => send({ type: 'bye', from: me });
    window.addEventListener('beforeunload', onUnload);

    send({ type: 'hello', from: me });
    send({ type: 'presence', from: me, state: awareness.local });

    return () => {
      onUnload();
      window.removeEventListener('beforeunload', onUnload);
      clearInterval(heartbeat);
      offOps();
      offPresence();
      ch.close();
    };
  }
}
