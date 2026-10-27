import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  checkPassphraseStrength,
  PBKDF2_ITERATIONS,
  unwrapKeyMaterial,
  wrapKeyMaterial,
  type WrappedBackup,
} from "../src/crypto/passphrase";
import { fromB64Url } from "../src/crypto/primitives";

describe("PBKDF2 passphrase backup (R7)", () => {
  it("uses >= 600,000 iterations (OWASP floor, Argon2id noted as v2 preference)", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("wrap/unwrap round-trips the master key material", async () => {
    const material = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapKeyMaterial(material, "correct horse Battery staple!");
    expect(wrapped.iterations).toBe(PBKDF2_ITERATIONS);
    const salt = fromB64Url(wrapped.salt);
    expect(salt.length).toBeGreaterThanOrEqual(16);
    expect(await unwrapKeyMaterial(wrapped, "correct horse Battery staple!")).toEqual(material);
  });

  it("a fresh wrap uses a fresh CSPRNG salt (>= 16B, stored only in the envelope)", async () => {
    const a: WrappedBackup = await wrapKeyMaterial(new Uint8Array(32), "correct horse Battery staple!");
    const b: WrappedBackup = await wrapKeyMaterial(new Uint8Array(32), "correct horse Battery staple!");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it("wrong passphrase fails closed", async () => {
    const wrapped = await wrapKeyMaterial(new Uint8Array(32), "correct horse Battery staple!");
    await expect(unwrapKeyMaterial(wrapped, "wrong passphrase entirely")).rejects.toThrow();
  });

  it("strength check rejects short and single-class passphrases at set time", () => {
    expect(checkPassphraseStrength("short").ok).toBe(false);
    expect(checkPassphraseStrength("alllowercasecase").ok).toBe(false);
    expect(checkPassphraseStrength("Str0ng!enough-pass").ok).toBe(true);
  });
});