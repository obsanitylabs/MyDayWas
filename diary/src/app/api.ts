import { encryptAESGCM, decryptAESGCM, type Envelope } from "../crypto/aead";
import {
  buildDerivationMessage,
  canonicalSignatureBytes,
  deriveAccountId,
  deriveMasterKeyMaterial,
  importDiaryKey,
  newDerivationParams,
  type DerivationParams,
} from "../crypto/derive";
import {
  checkPassphraseStrength,
  unwrapKeyMaterial,
  wrapKeyMaterial,
  type WrappedBackup,
} from "../crypto/passphrase";
import { KeyVault } from "../storage/keyVault";
import { EntryStore } from "../storage/entryStore";
import { LocalSyncAdapter } from "../sync/localAdapter";
import { encryptPlaintext, SyncEngine, type EntryPlaintext } from "../sync/engine";
import type { SyncMeta } from "../sync/adapter";
import type { Eip1193Provider } from "../auth/wallet";
import { personalSign } from "../auth/wallet";
import { log } from "../log";

export type Sentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export interface DecryptedEntry {
  id: string;
  day: number;
  text: string;
  sentiment: Sentiment;
  createdAtMs: number;
}

export const CANARY_RECORD_ID = "mydaywas.canary.v1";
export const CANARY_PLAINTEXT = "mydaywas.canary.v1";

export function utcDay(ms: number = Date.now()): number {
  return Math.floor(ms / 86_400_000);
}

export interface BackupFile {
  v: 1;
  kind: "mydaywas.backup.v1";
  derivation: DerivationParams;
  wrappedBackup: WrappedBackup;
  entries: Array<{ id: string; day: number; rev: number; envelope: Envelope }>;
}

/**
 * Application facade for the MyDayWas diary v1 (M3).
 *
 * Session model (scope 1): wallet connect + a one-time personal_sign at
 * onboarding derives the AES-GCM-256 diary key; afterwards the app runs
 * device-first from the non-extractable CryptoKey in the vault — the wallet
 * address is never persisted or logged, only held in memory during the
 * onboarding call. Recovery: passphrase-wrapped key backup (R7); wallet
 * re-signature over the SAME stored derivation message only works on
 * deterministic-signature wallets and is verified against the account
 * canary envelope before it is trusted (documented R4 trade).
 */
export class Diary {
  private constructor(
    public readonly accountId: string,
    private key: CryptoKey,
    private params: DerivationParams,
    private vault: KeyVault,
    private entries: EntryStore,
    private adapter: LocalSyncAdapter,
    private engine: SyncEngine,
    private metaRef: SyncMeta,
  ) {}

  static async adapter(): Promise<LocalSyncAdapter> {
    return LocalSyncAdapter.open();
  }

  /** Onboarding: wallet connect + signature -> HKDF -> non-extractable key. */
  static async onboard(
    provider: Eip1193Provider,
    address: string,
    passphrase?: string,
    localSuffix = "",
  ): Promise<Diary> {
    const params = newDerivationParams();
    const message = buildDerivationMessage(params);
    const sigHex = await personalSign(provider, address, message);
    const material = await deriveMasterKeyMaterial(canonicalSignatureBytes(sigHex), params);
    return Diary.fromMaterial(material, params, passphrase, localSuffix);
  }

  static async fromMaterial(
    material: Uint8Array,
    params: DerivationParams,
    passphrase?: string,
    localSuffix = "",
  ): Promise<Diary> {
    const key = await importDiaryKey(material);
    if (key.extractable) throw new Error("diary key must be non-extractable");
    const accountId = await deriveAccountId(params);
    const vault = await KeyVault.open(localSuffix);
    const entries = await EntryStore.open(localSuffix);
    const adapter = await LocalSyncAdapter.open();
    const canary = await encryptAESGCM(key, CANARY_PLAINTEXT, CANARY_RECORD_ID, 0);
    const meta: SyncMeta = {
      derivation: params,
      keyVersion: 1,
      canary,
      createdAt: utcDay(),
    };
    if (passphrase !== undefined) {
      const strength = checkPassphraseStrength(passphrase);
      if (!strength.ok) throw new Error(`passphrase too weak: needs ${strength.reason}`);
      meta.wrappedBackup = await wrapKeyMaterial(material, passphrase);
      meta.backupExpiresAt = Date.now() + 72 * 3600 * 1000;
      await vault.saveWrappedBackup(meta.wrappedBackup);
    }
    await vault.save({ key, params });
    await adapter.putMeta(accountId, meta);
    const engine = new SyncEngine(adapter, accountId, entries, key, meta);
    log("app", "onboarded diary account");
    return new Diary(accountId, key, params, vault, entries, adapter, engine, meta);
  }

  /** Unlock from the device vault (no wallet needed for daily use). */
  static async unlock(localSuffix = ""): Promise<Diary | null> {
    const vault = await KeyVault.open(localSuffix);
    const rec = await vault.load();
    if (!rec) {
      vault.kvClose();
      return null;
    }
    const adapter = await LocalSyncAdapter.open();
    const accountId = await deriveAccountId(rec.params);
    let meta = await adapter.getMeta(accountId);
    if (!meta) {
      meta = {
        derivation: rec.params,
        keyVersion: 1,
        canary: await encryptAESGCM(rec.key, CANARY_PLAINTEXT, CANARY_RECORD_ID, 0),
        createdAt: utcDay(),
      };
      await adapter.putMeta(accountId, meta);
    }
    const entries = await EntryStore.open(localSuffix);
    const engine = new SyncEngine(adapter, accountId, entries, rec.key, meta);
    return new Diary(accountId, rec.key, rec.params, vault, entries, adapter, engine, meta);
  }

  /** Restore on a new device from an exported backup file + passphrase. */
  static async restore(file: BackupFile, passphrase: string, localSuffix = ""): Promise<Diary> {
    if (file.v !== 1 || file.kind !== "mydaywas.backup.v1") throw new Error("unknown backup file");
    const material = await unwrapKeyMaterial(file.wrappedBackup, passphrase);
    const diary = await Diary.fromMaterial(material, file.derivation, undefined, localSuffix);
    for (const e of file.entries) {
      await diary.entries.put({ id: e.id, day: e.day, rev: e.rev, envelope: e.envelope, dirty: true, deleted: false });
    }
    await diary.adoptWrappedBackup(file.wrappedBackup);
    await diary.flush();
    return diary;
  }

  /** Persist an existing wrapped key backup on this device (restore path). */
  async adoptWrappedBackup(w: WrappedBackup): Promise<void> {
    await this.vault.saveWrappedBackup(w);
    this.metaRef.wrappedBackup = w;
    this.metaRef.backupExpiresAt = Date.now() + 72 * 3600 * 1000;
    await this.adapter.putMeta(this.accountId, this.metaRef);
  }

  async addEntry(text: string, sentiment: Sentiment): Promise<DecryptedEntry> {
    if (!text.trim()) throw new Error("entry text required");
    const id = crypto.randomUUID();
    const day = utcDay();
    const pt: EntryPlaintext = { text, sentiment, createdAtMs: Date.now() };
    const envelope = await encryptPlaintext(this.key, id, day, pt);
    await this.entries.put({ id, day, rev: Date.now(), envelope, dirty: true, deleted: false });
    log("app", "entry saved locally (encrypted)");
    return { id, day, ...pt };
  }

  async listEntries(): Promise<DecryptedEntry[]> {
    const out: DecryptedEntry[] = [];
    for (const rec of await this.entries.list()) {
      const pt = await decryptAESGCM(this.key, rec.envelope, rec.id, rec.day);
      const parsed = JSON.parse(pt) as EntryPlaintext;
      out.push({ id: rec.id, day: rec.day, text: parsed.text, sentiment: parsed.sentiment, createdAtMs: parsed.createdAtMs });
    }
    return out;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.engine.deleteEntry(id);
    log("app", "entry deleted (local + sync ciphertext)");
  }

  async deleteAccount(): Promise<void> {
    await this.engine.deleteAccount();
    await this.vault.wipe();
    log("app", "account deleted (local + sync ciphertext)");
  }

  /** Full plaintext export (user-controlled, in-browser, never touches sync). */
  async exportJSON(): Promise<string> {
    const entries = await this.listEntries();
    return JSON.stringify(
      {
        v: 1,
        kind: "mydaywas.export.v1",
        exportedAtDay: utcDay(),
        entries: entries.map((e) => ({
          day: e.day,
          sentiment: e.sentiment,
          text: e.text,
          createdAtMs: e.createdAtMs,
        })),
      },
      null,
      2,
    );
  }

  async hasPassphraseBackup(): Promise<boolean> {
    return (await this.vault.loadWrappedBackup()) !== null;
  }

  async changePassphrase(oldPw: string, newPw: string): Promise<void> {
    const wrapped = await this.vault.loadWrappedBackup();
    if (!wrapped) throw new Error("no passphrase backup set on this account");
    const material = await unwrapKeyMaterial(wrapped, oldPw);
    const strength = checkPassphraseStrength(newPw);
    if (!strength.ok) throw new Error(`passphrase too weak: needs ${strength.reason}`);
    const rewrapped = await wrapKeyMaterial(material, newPw);
    await this.vault.saveWrappedBackup(rewrapped);
    this.metaRef.wrappedBackup = rewrapped;
    this.metaRef.backupExpiresAt = Date.now() + 72 * 3600 * 1000;
    await this.adapter.putMeta(this.accountId, this.metaRef);
    log("crypto", "passphrase backup re-wrapped");
  }

  /** Encrypted backup export: wrapped key + ciphertext envelopes (never plaintext). */
  async exportEncryptedBackup(): Promise<string> {
    const wrapped = await this.vault.loadWrappedBackup();
    if (!wrapped) throw new Error("no passphrase backup set on this account");
    const file: BackupFile = {
      v: 1,
      kind: "mydaywas.backup.v1",
      derivation: this.params,
      wrappedBackup: wrapped,
      entries: (await this.entries.list()).map((r) => ({ id: r.id, day: r.day, rev: r.rev, envelope: r.envelope })),
    };
    return JSON.stringify(file);
  }

  async flush(): Promise<number> {
    return this.engine.flush();
  }

  async reconcile(): Promise<number> {
    return this.engine.reconcile();
  }

  scheduleFlush(): () => void {
    return this.engine.scheduleFlush(async () => {
      await this.engine.flush();
    });
  }
}