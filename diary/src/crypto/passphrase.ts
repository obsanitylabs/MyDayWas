import { randomBytes, toB64Url, fromB64Url, utf8 } from "./primitives";

/**
 * Passphrase backup (M2 §4 / CISO R7, binding).
 *
 * - PBKDF2-HMAC-SHA-256 with PBKDF2_ITERATIONS = 600_000 (OWASP floor,
 *   accepted for v1; Argon2id is the stated v2 preference if a WASM path
 *   lands — do not lower the iteration count without re-review).
 * - Salt is 16 bytes from crypto.getRandomValues (CSPRNG, >= 16B per R7)
 *   and is stored ONLY inside the wrapped envelope (never in plaintext
 *   config or the key vault).
 * - checkPassphraseStrength() runs at set time; a change of passphrase
 *   re-wraps the same key material via wrapKeyMaterial (re-wrap flow).
 */

export const PBKDF2_ITERATIONS = 600_000;
export const WRAP_SCHEMA = "mydaywas.backup.v1";

export interface WrappedBackup {
  v: number;
  schema: "mydaywas.backup.v1";
  kdf: "PBKDF2-HMAC-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ct: string;
}

export function checkPassphraseStrength(pw: string): { ok: boolean; reason?: string } {
  if (pw.length < 12) return { ok: false, reason: "at least 12 characters" };
  const classes =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(pw) ? 1 : 0);
  if (classes < 3) return { ok: false, reason: "mix at least 3 of lowercase, uppercase, digits, symbols" };
  return { ok: true };
}

async function deriveWrapKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8(passphrase) as BufferSource, "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function wrapAad(salt: Uint8Array): Uint8Array {
  return utf8(JSON.stringify({ v: 1, schema: WRAP_SCHEMA, salt: toB64Url(salt) }));
}

export async function wrapKeyMaterial(
  keyMaterial: Uint8Array,
  passphrase: string,
): Promise<WrappedBackup> {
  const salt = randomBytes(16);
  const key = await deriveWrapKey(passphrase, salt);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: wrapAad(salt) as BufferSource },
    key,
    keyMaterial as BufferSource,
  );
  return {
    v: 1,
    schema: WRAP_SCHEMA,
    kdf: "PBKDF2-HMAC-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toB64Url(salt),
    iv: toB64Url(iv),
    ct: toB64Url(new Uint8Array(ct)),
  };
}

export async function unwrapKeyMaterial(
  wrapped: WrappedBackup,
  passphrase: string,
): Promise<Uint8Array> {
  if (wrapped.v !== 1 || wrapped.schema !== WRAP_SCHEMA) {
    throw new Error("unknown wrapped-backup schema");
  }
  if (wrapped.kdf !== "PBKDF2-HMAC-SHA-256" || wrapped.iterations < PBKDF2_ITERATIONS) {
    throw new Error("wrapped-backup KDF parameters below policy floor");
  }
  const salt = fromB64Url(wrapped.salt);
  const key = await deriveWrapKey(passphrase, salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64Url(wrapped.iv) as BufferSource, additionalData: wrapAad(salt) as BufferSource },
    key,
    fromB64Url(wrapped.ct) as BufferSource,
  );
  return new Uint8Array(pt);
}