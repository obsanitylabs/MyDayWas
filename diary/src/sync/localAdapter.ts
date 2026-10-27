import { openKV, wipeDB, type KVStore } from "../storage/idb";
import { SYNC_TTL_MS, type SyncAdapter, type SyncMeta, type SyncRecord } from "./adapter";

/**
 * Local sync adapter for staging (v1).
 *
 * Implements the full SyncAdapter provider contract against IndexedDB,
 * including the GC 72-hour TTL sweep on every access — so the offline /
 * online sync path is exercised end-to-end on staging with no network
 * provider. A real provider (Supabase per M2 §1) implements the same
 * interface server-side in M4; the engine does not change.
 */

const DB = "mydaywas-sync";
const STORE = "sync";

interface StoredAccount {
  meta: SyncMeta;
  records: Record<string, SyncRecord>;
}

export class LocalSyncAdapter implements SyncAdapter {
  private constructor(private kv: KVStore, private now: () => number) {}

  static async open(now: () => number = () => Date.now()): Promise<LocalSyncAdapter> {
    return new LocalSyncAdapter(await openKV(DB, STORE), now);
  }

  private async account(accountId: string): Promise<StoredAccount | null> {
    return ((await this.kv.get(accountId)) as StoredAccount | undefined) ?? null;
  }

  private async save(accountId: string, a: StoredAccount): Promise<void> {
    await this.kv.set(accountId, a);
  }

  /** GC 72-hour rule: drop expired ciphertext (incl. backups) on every access. */
  private sweep(a: StoredAccount): void {
    const now = this.now();
    for (const [id, rec] of Object.entries(a.records)) {
      if (rec.expiresAt <= now) delete a.records[id];
    }
    if (a.meta.wrappedBackup && (a.meta.backupExpiresAt ?? 0) <= now) {
      delete a.meta.wrappedBackup;
      delete a.meta.backupExpiresAt;
    }
  }

  async putMeta(accountId: string, meta: SyncMeta): Promise<void> {
    const a = (await this.account(accountId)) ?? { meta, records: {} };
    a.meta = meta;
    await this.save(accountId, a);
  }

  async getMeta(accountId: string): Promise<SyncMeta | null> {
    const a = await this.account(accountId);
    if (!a) return null;
    this.sweep(a);
    await this.save(accountId, a);
    return a.meta;
  }

  async put(accountId: string, rec: SyncRecord): Promise<void> {
    const a = (await this.account(accountId)) ?? {
      meta: { derivation: { schema: "", nonceHex: "", saltHex: "" }, keyVersion: 1, canary: null as never, createdAt: 0 },
      records: {},
    };
    a.records[rec.id] = { ...rec, expiresAt: this.now() + SYNC_TTL_MS };
    await this.save(accountId, a);
  }

  async list(accountId: string): Promise<SyncRecord[]> {
    const a = await this.account(accountId);
    if (!a) return [];
    this.sweep(a);
    await this.save(accountId, a);
    return Object.values(a.records);
  }

  async delete(accountId: string, id: string): Promise<void> {
    const a = await this.account(accountId);
    if (!a) return;
    delete a.records[id];
    await this.save(accountId, a);
  }

  async deleteAll(accountId: string): Promise<void> {
    await this.kv.del(accountId);
  }

  async wipe(): Promise<void> {
    await wipeDB(DB);
  }
}