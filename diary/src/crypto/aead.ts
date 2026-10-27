import { fromB64Url, fromUtf8, toB64Url, utf8 } from "./primitives";

/**
 * AES-GCM-256 AEAD envelope (M2 §4).
 *
 * R1 (CISO, binding): IVs are drawn from crypto.getRandomValues ONLY — 96
 * fresh random bits per encryption. NIST SP 800-38D caps random-IV GCM at
 * ~2^32 encryptions per key; a diary key will never approach that, and this
 * bound must NOT be "optimized" into a counter. Enforced by test:
 * aead.test.ts asserts a fresh random IV per encryption.
 *
 * R2 (CISO, binding): the record id and the coarse creation day are bound
 * into the AAD so a ciphertext cannot be re-registered under another record
 * id (cut-and-paste). Envelopes with unknown `v` or `keyVersion` are rejected
 * by decrypt() — never attempt-decrypted. keyVersion rotation path: bump
 * KEY_VERSION, re-encrypt all records client-side with the new key, then
 * tombstone old-version envelopes (sync tombstones already delete by id).
 */

export const AEAD_VERSION = 1;
export const KEY_VERSION = 1;
export const ALG = "A256GCM";

export interface Envelope {
  v: number;
  keyVersion: number;
  alg: "A256GCM";
  iv: string;
  ct: string;
}

export function aadString(recordId: string, day: number): Uint8Array {
  return utf8(
    JSON.stringify({
      v: AEAD_VERSION,
      keyVersion: KEY_VERSION,
      alg: ALG,
      recordId,
      day,
    }),
  );
}

export async function encryptAESGCM(
  key: CryptoKey,
  plaintext: string,
  recordId: string,
  day: number,
): Promise<Envelope> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aadString(recordId, day) as BufferSource },
    key,
    utf8(plaintext) as BufferSource,
  );
  return { v: AEAD_VERSION, keyVersion: KEY_VERSION, alg: "A256GCM", iv: toB64Url(iv), ct: toB64Url(new Uint8Array(ct)) };
}

export async function decryptAESGCM(
  key: CryptoKey,
  env: Envelope,
  recordId: string,
  day: number,
): Promise<string> {
  if (env.v !== AEAD_VERSION) {
    throw new Error(`unknown envelope version: ${env.v}`);
  }
  if (env.keyVersion !== KEY_VERSION) {
    throw new Error(`unknown keyVersion: ${env.keyVersion}`);
  }
  if (env.alg !== ALG) {
    throw new Error(`unknown alg: ${env.alg}`);
  }
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64Url(env.iv) as BufferSource, additionalData: aadString(recordId, day) as BufferSource },
    key,
    fromB64Url(env.ct) as BufferSource,
  );
  return fromUtf8(new Uint8Array(pt));
}