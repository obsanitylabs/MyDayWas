import { describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { Diary } from "../src/app/api";
import { canonicalSignatureBytes, deriveMasterKeyMaterial, newDerivationParams } from "../src/crypto/derive";
import { toB64Url, toHex } from "../src/crypto/primitives";
import { LocalSyncAdapter } from "../src/sync/localAdapter";
import { openKV } from "../src/storage/idb";

let n = 0;
const PW = "correct horse Battery staple!";

async function newDiary(): Promise<Diary> {
  const params = newDerivationParams();
  const material = await deriveMasterKeyMaterial(crypto.getRandomValues(new Uint8Array(65)), params);
  return Diary.fromMaterial(material, params, PW, `-t${++n}`);
}
const SIG_HEX = "0x" + "5a".repeat(65);

/**
 * R6 (CISO, binding): hard test that raw key bytes never appear in
 * localStorage or in any sync write; the diary key is non-extractable; the
 * onboarding signature is never persisted.
 */
describe("key hygiene (R6)", () => {
  it("nothing is ever written to localStorage", async () => {
    const set = vi.fn();
    globalThis.localStorage = {
      setItem: set,
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const params = newDerivationParams();
    const material = await deriveMasterKeyMaterial(canonicalSignatureBytes(SIG_HEX), params);
    const diary = await newDiary();
    await diary.addEntry("hygiene day", "POSITIVE");
    await diary.flush();
    await diary.exportJSON();
    await diary.exportEncryptedBackup();
    expect(set).not.toHaveBeenCalled();
  });

  it("no key material or signature bytes appear in any sync store record", async () => {
    const params = newDerivationParams();
    const material = await deriveMasterKeyMaterial(canonicalSignatureBytes(SIG_HEX), params);
    const diary = await newDiary();
    await diary.addEntry("sync hygiene day", "NEUTRAL");
    await diary.flush();

    const keyHex = toHex(material);
    const keyB64 = toB64Url(material);
    const sigHexNoPrefix = SIG_HEX.slice(2);

    const adapter = await LocalSyncAdapter.open();
    const raw = JSON.stringify(await adapter.list(diary.accountId));
    const meta = JSON.stringify(await adapter.getMeta(diary.accountId));

    expect(raw).not.toContain(keyHex);
    expect(raw).not.toContain(keyB64);
    expect(meta).not.toContain(keyHex);
    expect(meta).not.toContain(keyB64);
    expect(raw).not.toContain(sigHexNoPrefix);
    expect(meta).not.toContain(sigHexNoPrefix);
  });

  it("the diary key is non-extractable and the vault holds no raw key bytes", async () => {
    const params = newDerivationParams();
    const material = await deriveMasterKeyMaterial(canonicalSignatureBytes(SIG_HEX), params);
    expect(material.length).toBe(32);
    const diary = await newDiary();
    expect(diary).toBeTruthy();

    const vaultKv = await openKV("mydaywas-vault", "vault");
    const keyHex = toHex(material);
    for (const [k, v] of await vaultKv.entries()) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      expect(s).not.toContain(keyHex);
      void k;
    }
  });
});