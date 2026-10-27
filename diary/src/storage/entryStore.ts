import { openKV, wipeDB } from "./idb";
import type { Envelope } from "../crypto/aead";

/**
 * Device-first entry store (M2 §5). IndexedDB, keyed by record id.
 * Only ciphertext envelopes plus coarse (UTC-day) metadata and sync
 * bookkeeping are persisted — no plaintext, no precise timestamps.
 */

export interface EntryRecord {
  id: string;
  day: number;
  rev: number;
  envelope: Envelope;
  dirty: boolean;
  deleted: boolean;
}

const DB = "mydaywas-entries";
const STORE = "entries";

export class EntryStore {
  private constructor(private db: IDBDatabase, private suffix: string) {}

  static async open(suffix = ""): Promise<EntryStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB + suffix, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          const s = req.result.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("day", "day");
        }
      };
      req.onsuccess = () => resolve(new EntryStore(req.result, suffix));
      req.onerror = () => reject(req.error);
    });
  }

  private async all(): Promise<EntryRecord[]> {
    return new Promise((res, rej) => {
      const r = this.db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result as EntryRecord[]);
      r.onerror = () => rej(r.error);
    });
  }

  async put(rec: EntryRecord): Promise<void> {
    await new Promise<void>((res, rej) => {
      const r = this.db.transaction(STORE, "readwrite").objectStore(STORE).put(rec);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async get(id: string): Promise<EntryRecord | undefined> {
    return new Promise((res, rej) => {
      const r = this.db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result as EntryRecord | undefined);
      r.onerror = () => rej(r.error);
    });
  }

  async list(): Promise<EntryRecord[]> {
    return (await this.all()).filter((r) => !r.deleted).sort((a, b) => b.day - a.day || cmpId(a.id, b.id));
  }

  async listDirty(): Promise<EntryRecord[]> {
    return (await this.all()).filter((r) => r.dirty);
  }

  async delete(id: string): Promise<void> {
    await new Promise<void>((res, rej) => {
      const r = this.db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async wipe(): Promise<void> {
    this.db.close();
    await wipeDB(DB + this.suffix);
  }

  close(): void {
    this.db.close();
  }
}

export function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}