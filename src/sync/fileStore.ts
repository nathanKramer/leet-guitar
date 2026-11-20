/**
 * Minimal IndexedDB key/value store for large local files (localStorage tops out around 5 MB).
 * Local to this browser; nothing here is synced.
 */
const DB_NAME = 'leet-guitar';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const fileStore = {
  get: <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key)),
  put: (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)),
  delete: (key: string) => run('readwrite', (s) => s.delete(key)),
};
