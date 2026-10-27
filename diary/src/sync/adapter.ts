import type { Envelope } from "../crypto/aead";
import type { DerivationParams } from "../crypto/derive";
import type { WrappedBackup } from "../crypto/passphrase";

/**
 * Sync provider contract (M2 §4/§5, GC 72-hour rule, R8).
 *
 * The sync store holds ONLY ciphertext envelopes plus the pseudonymous
 * account id and coarse bookkeeping — never plaintext, never key material,
 * never wallet addresses. Records (including the wrapped-key backup and
 * account metadata) carry expiresAt and MUST be deleted server-side
 * within 72 hours of their last write; every adapter implementation
 * enforces this TTL on read and on a sweep (localAdapter sweeps on every
 * access). Deletes by the client propagate immediately.
 *
 * Sync write batching (R8): the ENGINE coalesces local writes and flushes
 * in one batch per flush() — on app background/close, on reconnect, or on
 * a fixed interval — never per-save. Providers should expect batched puts.
 */

export const SYNC_TTL_MS = 72 * 3600 * 1000;

export interface SyncMeta {
  derivation: DerivationParams;
  keyVersion: number;
  canary: Envelope;
  createdAt: number;
  wrappedBackup?: WrappedBackup;
  backupExpiresAt?: number;
}

export interface SyncRecord {
  id: string;
  day: number;
  rev: number;
  envelope: Envelope;
  expiresAt: number;
}

export interface SyncAdapter {
  putMeta(accountId: string, meta: SyncMeta): Promise<void>;
  getMeta(accountId: string): Promise<SyncMeta | null>;
  put(accountId: string, rec: SyncRecord): Promise<void>;
  list(accountId: string): Promise<SyncRecord[]>;
  delete(accountId: string, id: string): Promise<void>;
  deleteAll(accountId: string): Promise<void>;
}

export function expiry(now: number): number {
  return now + SYNC_TTL_MS;
}