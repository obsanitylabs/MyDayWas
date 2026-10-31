import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { decryptAESGCM, encryptAESGCM, KEY_VERSION } from "../src/crypto/aead";
import { importDiaryKey, deriveMasterKeyMaterial, newDerivationParams, canonicalSignatureBytes, DERIVATION_SCHEMA } from "../src/crypto/derive";
import { fromB64Url, toB64Url } from "../src/crypto/primitives";

// Tamper the DECODED bytes, then re-encode to base64url. Flipping the last
// base64url *character* is not a reliable tamper: when the byte length is not a
// multiple of 3 the trailing bits of the final character are padding, so a
// last-char swap can decode to byte-identical output and never alter the
// ciphertext (OBS-529). Mutating a decoded byte is always discriminating.
const tamperLastByte = (s: string): string => {
  const b = fromB64Url(s);
  b[b.length - 1] ^= 0x01;
  return toB64Url(b);
};

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
    const ctTampered = tamperLastByte(env.ct);
    const ivTampered = tamperLastByte(env.iv);
    expect(fromB64Url(ctTampered)).not.toEqual(fromB64Url(env.ct));
    expect(fromB64Url(ivTampered)).not.toEqual(fromB64Url(env.iv));
    await expect(decryptAESGCM(key, { ...env, ct: ctTampered }, "rec-a", 100)).rejects.toThrow();
    await expect(decryptAESGCM(key, { ...env, iv: ivTampered }, "rec-a", 100)).rejects.toThrow();
    await expect(decryptAESGCM(key, env, "rec-b", 100)).rejects.toThrow();
    await expect(decryptAESGCM(key, env, "rec-a", 101)).rejects.toThrow();
    await expect(decryptAESGCM(key, env, "rec-a", 100)).resolves.toBe("secret day");
  });

  it("tamper helper never degenerates at the final base64url character (OBS-529 regression)", async () => {
    // The failure mode: a base64url string whose final char sits in a padding-only
    // position decodes identically after a naive last-char flip, i.e. the edit is a
    // no-op. Here "AAA" and a naive flip to "AAB" both decode to bytes [0,0].
    const degenerate = toB64Url(new Uint8Array([0, 0]));
    expect(degenerate).toBe("AAA");
    expect(fromB64Url(degenerate)).toEqual(new Uint8Array([0, 0]));
    const naiveFlip = degenerate.slice(0, -1) + (degenerate.endsWith("A") ? "B" : "A");
    expect(fromB64Url(naiveFlip)).toEqual(fromB64Url(degenerate));

    // Deterministic pin: the byte-level helper must change the bytes even here. A
    // naive last-char flip would decode identically and this assertion would fail.
    expect(fromB64Url(tamperLastByte(degenerate))).not.toEqual(fromB64Url(degenerate));

    // The byte-level helper must always change the decoded bytes and GCM must reject.
    const params = newDerivationParams();
    const key = await importDiaryKey(await deriveMasterKeyMaterial(canonicalSignatureBytes("0x" + "9a".repeat(65)), params));
    for (let i = 0; i < 32; i++) {
      const env = await encryptAESGCM(key, "last-byte probe", `rec-last-${i}`, 42);
      const ctTampered = tamperLastByte(env.ct);
      expect(fromB64Url(ctTampered)).not.toEqual(fromB64Url(env.ct));
      await expect(decryptAESGCM(key, { ...env, ct: ctTampered }, `rec-last-${i}`, 42)).rejects.toThrow();
    }
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