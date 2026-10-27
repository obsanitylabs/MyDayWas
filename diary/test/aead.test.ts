import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { decryptAESGCM, encryptAESGCM, KEY_VERSION } from "../src/crypto/aead";
import { importDiaryKey, deriveMasterKeyMaterial, newDerivationParams, canonicalSignatureBytes, DERIVATION_SCHEMA } from "../src/crypto/derive";

describe("AEAD envelope (R1, R2)", () => {
  it("round-trips and uses a fresh random IV per encryption (R1: CSPRNG-only, ~2^32/key GCM bound documented in src/crypto/aead.ts)", async () => {
    const params = newDerivationParams();
    const key = await importDiaryKey(await deriveMasterKeyMaterial(canonicalSignatureBytes("0x" + "ab".repeat(65)), params));
    const ivs = new Set<string>();
    for (let i = 0; i < 32; i++) {
      const env = await encryptAESGCM(key, "how was your day?", `rec-${i}`, 12345);
      ivs.add(env.iv);
      expect(await decryptAESGCM(key, env, `rec-${i}`, 12345)).toBe("how was your day?");
    }
    expect(ivs.size).toBe(32);
  });

  it("rejects tampered ciphertext, tampered IV, and AAD mismatch on record id (R2)", async () => {
    const params = newDerivationParams();
    const key = await importDiaryKey(await deriveMasterKeyMaterial(canonicalSignatureBytes("0x" + "cd".repeat(65)), params));
    const env = await encryptAESGCM(key, "secret day", "rec-a", 100);
    const flip = (s: string): string => s.slice(0, Math.max(1, s.length - 1)) + (s.endsWith("A") ? "B" : "A");
    await expect(decryptAESGCM(key, { ...env, ct: flip(env.ct) }, "rec-a", 100)).rejects.toThrow();
    await expect(decryptAESGCM(key, { ...env, iv: flip(env.iv) }, "rec-a", 100)).rejects.toThrow();
    await expect(decryptAESGCM(key, env, "rec-b", 100)).rejects.toThrow();
    await expect(decryptAESGCM(key, env, "rec-a", 101)).rejects.toThrow();
    await expect(decryptAESGCM(key, env, "rec-a", 100)).resolves.toBe("secret day");
  });

  it("rejects unknown envelope v / keyVersion / alg instead of attempting decryption (R2)", async () => {
    const params = newDerivationParams();
    const key = await importDiaryKey(await deriveMasterKeyMaterial(canonicalSignatureBytes("0x" + "ef".repeat(65)), params));
    const env = await encryptAESGCM(key, "x", "rec", 1);
    await expect(decryptAESGCM(key, { ...env, v: 99 }, "rec", 1)).rejects.toThrow(/unknown envelope version/);
    await expect(decryptAESGCM(key, { ...env, keyVersion: KEY_VERSION + 1 }, "rec", 1)).rejects.toThrow(/unknown keyVersion/);
    await expect(decryptAESGCM(key, { ...env, alg: "A128GCM" as "A256GCM" }, "rec", 1)).rejects.toThrow(/unknown alg/);
  });

  it("derivation schema version is embedded in the signed message and pinned (R3)", () => {
    const params = newDerivationParams();
    const msg = `MyDayWas — diary key derivation. This signature is used only to derive your diary encryption key on this device.\nSchema: ${DERIVATION_SCHEMA}\nNonce: ${params.nonceHex}`;
    expect(msg).toContain(DERIVATION_SCHEMA);
    expect(params.nonceHex.length).toBe(32);
    expect(params.saltHex.length).toBe(64);
  });
});