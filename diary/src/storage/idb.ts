export interface KVStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  entries(): Promise<Array<[string, unknown]>>;
  close(): void;
}

export async function openKV(dbName: string, storeName: string): Promise<KVStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    req.onsuccess = () => {
      const db = req.result;
      const close = () => db.close();
      const tx = (mode: IDBTransactionMode) => db.transaction(storeName, mode);
      const store = () => {
        const t = tx("readonly");
        return t.objectStore(storeName);
      };
      const storeW = () => {
        const t = tx("readwrite");
        return t.objectStore(storeName);
      };
      resolve({
        close,
        get: (key) =>
          new Promise((res, rej) => {
            const r = store().get(key);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          }),
        set: (key, value) =>
          new Promise((res, rej) => {
            const r = storeW().put(value, key);
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
          }),
        del: (key) =>
          new Promise((res, rej) => {
            const r = storeW().delete(key);
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
          }),
        entries: () =>
          new Promise((res, rej) => {
            const r = store().getAllKeys();
            const r2 = store().getAll();
            const done = { a: false, b: false } as { a: boolean; b: boolean; keys?: IDBValidKey[]; vals?: unknown[] };
            const check = () => {
              if (done.a && done.b) {
                res((done.keys ?? []).map((k, i) => [String(k), (done.vals ?? [])[i]] as [string, unknown]));
              }
            };
            r.onsuccess = () => { done.a = true; done.keys = r.result; check(); };
            r.onerror = () => rej(r.error);
            r2.onsuccess = () => { done.b = true; done.vals = r2.result; check(); };
            r2.onerror = () => rej(r2.error);
          }),
      });
    };
    req.onerror = () => reject(req.error);
  });
}

export function wipeDB(dbName: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}