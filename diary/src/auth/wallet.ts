import { canonicalSignatureBytes } from "../crypto/derive";

/**
 * Wallet auth (M3 scope 1).
 *
 * EIP-1193 provider, `eth_requestAccounts` + `personal_sign`. The wallet
 * address lives in MEMORY ONLY for the session: it is never persisted, never
 * attached to diary content, and never logged. The onboarding signature is
 * a one-time input consumed by HKDF derivation and then discarded.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export function getInjectedProvider(): Eip1193Provider | null {
  const eth = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
  return eth ?? null;
}

export async function connectAccounts(p: Eip1193Provider): Promise<string[]> {
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("no accounts returned");
  return accounts;
}

export async function personalSign(p: Eip1193Provider, address: string, message: string): Promise<string> {
  const sig = (await p.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
  return sig;
}

/**
 * Canonical signature bytes for HKDF IKM (R3): the exact 65-byte compact
 * (r,s,v) hex the wallet returned, decoded as-is. No DER re-encoding, no
 * v-normalization — both would silently derive a different key across
 * wallet implementations. Asserts the 65-byte form.
 */
export function canonicalSignBytes(sigHex: string): Uint8Array {
  return canonicalSignatureBytes(sigHex);
}