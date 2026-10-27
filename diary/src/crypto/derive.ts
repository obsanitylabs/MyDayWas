import { fromHex, randomBytes, sha256Hex, toHex, utf8 } from "./primitives";

/**
 * Key derivation: HKDF-SHA-256 over canonical wallet signature bytes
 * (M2 §4 / CISO R3, binding).
 *
 * - Derivation method is PINNED to ONE template: `personal_sign` over the
 *   message built by buildDerivationMessage(). No EIP-712 variant exists in
 *   code, so the two can never be confused.
 * - The derivation schema version (`mydaywas.derivation.v1`) is embedded in
 *   the signed message itself, so a future schema change cannot silently
 *   re-derive over an old message.
 * - The nonce is 16 bytes from crypto.getRandomValues (CSPRNG, >= 16B per
 *   R3) and defeats deterministic-signature replay (RFC-6979 wallets would
 *   otherwise produce an identical signature for an identical message).
 * - HKDF IKM is the CANONICAL signature bytes: the exact 65-byte compact
 *   (r, s, v) form returned by the wallet as a 0x-hex string, decoded as-is.
 *   No DER re-encoding, no v-normalization — wallets differ in both, and
 *   any normalization would silently derive a different key on another
 *   device. canonicalSignatureBytes() asserts the 65-byte form.
 * - The 32-byte device random HKDF salt and the info string are public
 *   parameters stored in sync account metadata; nothing secret is stored.
 * - The wallet signature is a ONE-TIME onboarding input: it is never stored
 *   (not in localStorage, not in the vault, not in sync) and never logged.
 *
 * Cross-device note (R4, documented trade): a wallet re-signature on a new
 * device only re-derives the SAME master key if the wallet reproduces the
 * identical signature bytes (RFC-6979 style) over the SAME stored message.
 * That is NOT guaranteed across wallets/versions, so the supported recovery
 * path is the passphrase-wrapped backup; the re-signature path verifies
 * itself against the account canary envelope before use.
 */

export const DERIVATION_SCHEMA = "mydaywas.derivation.v1";
export const HKDF_INFO = "mydaywas.master.v1";
export const ACCOUNT_ID_SCHEMA = "mydaywas.account.v1";

export interface DerivationParams {
  schema: string;
  nonceHex: string;
  saltHex: string;
}

export function newDerivationParams(): DerivationParams {
  return {
    schema: DERIVATION_SCHEMA,
    nonceHex: toHex(randomBytes(16)),
    saltHex: toHex(randomBytes(32)),
  };
}

export function buildDerivationMessage(params: DerivationParams): string {
  if (params.schema !== DERIVATION_SCHEMA) {
    throw new Error(`unknown derivation schema: ${params.schema}`);
  }
  return (
    "MyDayWas — diary key derivation. This signature is used only to derive " +
    `your diary encryption key on this device.\nSchema: ${DERIVATION_SCHEMA}\nNonce: ${params.nonceHex}`
  );
}

export function canonicalSignatureBytes(sigHex: string): Uint8Array {
  const b = fromHex(sigHex);
  if (b.length !== 65) {
    throw new Error(`unexpected signature length: ${b.length} (want 65-byte compact r,s,v)`);
  }
  return b;
}

export async function deriveMasterKeyMaterial(
  canonicalSig: Uint8Array,
  params: DerivationParams,
): Promise<Uint8Array> {
  if (params.schema !== DERIVATION_SCHEMA) {
    throw new Error(`unknown derivation schema: ${params.schema}`);
  }
  const ikm = await crypto.subtle.importKey("raw", canonicalSig as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: fromHex(params.saltHex) as BufferSource,
      info: utf8(HKDF_INFO) as BufferSource,
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

export async function importDiaryKey(raw32: Uint8Array): Promise<CryptoKey> {
  if (raw32.length !== 32) throw new Error("master key material must be 32 bytes");
  return crypto.subtle.importKey("raw", raw32 as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function deriveAccountId(params: DerivationParams): Promise<string> {
  return sha256Hex(utf8(`${ACCOUNT_ID_SCHEMA}|${params.saltHex}|${params.nonceHex}`));
}