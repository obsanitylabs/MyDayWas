import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  buildDerivationMessage,
  canonicalSignatureBytes,
  deriveAccountId,
  deriveMasterKeyMaterial,
  importDiaryKey,
  newDerivationParams,
} from "../src/crypto/derive";

describe("HKDF-from-signature key derivation (R3)", () => {
  const sig = "0x" + "11".repeat(32) + "22".repeat(32) + "1f";

  it("canonical signature bytes are the raw 65-byte compact form, no normalization", () => {
    const b = canonicalSignatureBytes(sig);
    expect(b.length).toBe(65);
    expect(b[64]).toBe(0x1f);
  });

  it("rejects non-65-byte signatures", () => {
    expect(() => canonicalSignatureBytes("0x1234")).toThrow(/65/);
  });

  it("same wallet signature + stored public params re-derive the identical master key (automated re-derivation)", async () => {
    const params = newDerivationParams();
    const m1 = await deriveMasterKeyMaterial(canonicalSignatureBytes(sig), params);
    const m2 = await deriveMasterKeyMaterial(canonicalSignatureBytes(sig), params);
    expect(m1).toEqual(m2);
    expect(m1.length).toBe(32);
    const k1 = await importDiaryKey(m1);
    const k2 = await importDiaryKey(m2);
    expect(k1.extractable).toBe(false);
    expect(k2.extractable).toBe(false);
    expect(k1.algorithm).toEqual(k2.algorithm);
  });

  it("different salt or different signature derives a different key", async () => {
    const p1 = newDerivationParams();
    const p2 = newDerivationParams();
    const m1 = await deriveMasterKeyMaterial(canonicalSignatureBytes(sig), p1);
    expect(await deriveMasterKeyMaterial(canonicalSignatureBytes(sig), p2)).not.toEqual(m1);
    expect(await deriveMasterKeyMaterial(canonicalSignatureBytes("0x" + "99".repeat(65)), p1)).not.toEqual(m1);
  });

  it("account id is deterministic from public params only (pseudonymous, no wallet address)", async () => {
    const params = newDerivationParams();
    expect(await deriveAccountId(params)).toBe(await deriveAccountId(params));
    expect(await deriveAccountId(newDerivationParams())).not.toBe(await deriveAccountId(params));
  });

  it("derivation message pins the personal_sign template and nonce", () => {
    const params = newDerivationParams();
    const msg = buildDerivationMessage(params);
    expect(msg).toContain("mydaywas.derivation.v1");
    expect(msg).toContain(params.nonceHex);
    expect(msg.startsWith("MyDayWas — diary key derivation.")).toBe(true);
  });
});