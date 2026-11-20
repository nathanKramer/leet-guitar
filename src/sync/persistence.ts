import type { DocState } from '../model/crdt';
import type { DocumentStore } from '../model/store';

const key = (docId: string) => `leet-guitar:doc:${docId}`;

export function loadSnapshot(docId: string): DocState | undefined {
  try {
    const raw = localStorage.getItem(key(docId));
    return raw ? (JSON.parse(raw) as DocState) : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the CRDT snapshot (with stamps, so it can be merged later) after changes settle. */
export function attachPersistence(store: DocumentStore, docId: string, delayMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    try {
      localStorage.setItem(key(docId), JSON.stringify(store.getSnapshot()));
    } catch {
      /* storage full or unavailable */
    }
  };
  const off = store.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(save, delayMs);
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
