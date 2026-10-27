import { log } from "../log";
import type { Envelope } from "../crypto/aead";
import { decryptAESGCM, encryptAESGCM } from "../crypto/aead";
import type { EntryRecord, EntryStore } from "../storage/entryStore";
import { expiry, type SyncAdapter, type SyncMeta, type SyncRecord } from "./adapter";

/**
 * Sync engine (M3 scope 4).
 *
 * - Device-first: every write lands in the local EntryStore first; the app
 *   is fully functional offline (M2 §5: sync is optional).
 * - Offline/reconnect: local records carry a `dirty` flag; nothing touches
 *   the sync adapter until a coalesced flush (R8: interval + online event +
 *   app background, never per-save). Reconcile pulls remote records and
 *   applies last-write-wins by per-record `rev`; record ids are primary
 *   keys on both sides, so reconnect can never duplicate or lose entries.
 * - Ciphertext-only: SyncRecords hold envelopes + coarse day + rev +
 *   expiresAt (72h TTL enforced by the adapter, GC rule).
 */

export const FLUSH_INTERVAL_MS = 30_000;

export interface EntryPlaintext {
  text: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  createdAtMs: number;
}

export async function decryptRecord(key: CryptoKey, rec: EntryRecord): Promise<EntryPlaintext> {
  const json = await decryptAESGCM(key, rec.envelope, rec.id, rec.day);
  return JSON.parse(json) as EntryPlaintext;
}

export function encryptPlaintext(
  key: CryptoKey,
  id: string,
  day: number,
  pt: EntryPlaintext,
): Promise<Envelope> {
  return encryptAESGCM(key, JSON.stringify(pt), id, day);
}

export class SyncEngine {
  constructor(
    private adapter: SyncAdapter,
    private accountId: string,
    private entries: EntryStore,
    private key: CryptoKey,
    private meta: SyncMeta,
  ) {}

  async flush(): Promise<number> {
    const dirty = await this.entries.listDirty();
    if (dirty.length === 0) return 0;
    const now = Date.now();
    for (const rec of dirty) {
      await this.adapter.put(this.accountId, {
        id: rec.id,
        day: rec.day,
        rev: rec.rev,
        envelope: rec.envelope,
        expiresAt: expiry(now),
      });
      await this.entries.put({ ...rec, dirty: false });
    }
    log("sync", "flushed coalesced batch", dirty.length);
    return dirty.length;
  }

  async reconcile(): Promise<number> {
    await this.flush();
    const remote = await this.adapter.list(this.accountId);
    const byId = new Map(remote.map((r) => [r.id, r]));
    const localAll = await this.entries.list();
    let changes = 0;
    for (const local of localAll) {
      const r = byId.get(local.id);
      if (!r || r.rev <= local.rev) continue;
      await this.entries.put({ ...local, rev: r.rev, envelope: r.envelope, dirty: false });
      changes++;
    }
    const localIds = new Set(localAll.map((l) => l.id));
    for (const r of byId.values()) {
      if (localIds.has(r.id)) continue;
      await this.entries.put({
        id: r.id,
        day: r.day,
        rev: r.rev,
        envelope: r.envelope,
        dirty: false,
        deleted: false,
      });
      changes++;
    }
    log("sync", "reconcile applied remote changes", changes);
    return changes;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.entries.delete(id);
    await this.adapter.delete(this.accountId, id);
  }

  async deleteAccount(): Promise<void> {
    await this.entries.wipe();
    await this.adapter.deleteAll(this.accountId);
  }

  scheduleFlush(onFlush: () => Promise<void>): () => void {
    const flush = async () => {
      try {
        await onFlush();
      } catch {
        log("sync", "flush failed; will retry on next trigger");
      }
    };
    const t = setInterval(flush, FLUSH_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }
}