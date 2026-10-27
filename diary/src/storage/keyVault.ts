import { openKV, wipeDB, type KVStore } from "./idb";
import type { DerivationParams } from "../crypto/derive";
import type { WrappedBackup } from "../crypto/passphrase";

/**
 * Key vault (M2 §4 / CISO R5, R6).
 *
 * The diary AES-GCM key is held ONLY as an `extractable: false` CryptoKey
 * persisted via IndexedDB structured clone. Raw key bytes never appear in
 * localStorage or any sync write — hard acceptance test in
 * test/keyhygiene.test.ts (R6).
 *
 * R5 dependency (stated): non-extractable storage is key-PROXY, not
 * key-protection — same-origin script (XSS) can decrypt at will. Strict CSP
 * (no unsafe-inline, index.html) and lockfile-pinned dependencies are
 * therefore part of this storage design, not an add-on.
 */

const DB = "mydaywas-vault";
const STORE = "vault";
const KEY = "diary-key-v1";
const PARAMS = "derivation-params";
const BACKUP = "wrapped-backup";

export interface VaultRecord {
  key: CryptoKey;
  params: DerivationParams;
}

export class KeyVault {
  private constructor(private kv: KVStore, private suffix: string) {}

  static async open(suffix = ""): Promise<KeyVault> {
    return new KeyVault(await openKV(DB + suffix, STORE), suffix);
  }

  async save(r: VaultRecord): Promise<void> {
    await this.kv.set(KEY, r.key);
    await this.kv.set(PARAMS, r.params);
  }

  async load(): Promise<VaultRecord | null> {
    const key = (await this.kv.get(KEY)) as CryptoKey | undefined;
    const params = (await this.kv.get(PARAMS)) as DerivationParams | undefined;
    if (!key || !params) return null;
    return { key, params };
  }

  async saveWrappedBackup(w: WrappedBackup): Promise<void> {
    await this.kv.set(BACKUP, w);
  }

  async loadWrappedBackup(): Promise<WrappedBackup | null> {
    return ((await this.kv.get(BACKUP)) as WrappedBackup | undefined) ?? null;
  }

  kvClose(): void {
    this.kv.close();
  }

  async wipe(): Promise<void> {
    this.kv.close();
    await wipeDB(DB + this.suffix);
  }
}