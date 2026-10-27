import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { Diary } from "../src/app/api";
import { LocalSyncAdapter } from "../src/sync/localAdapter";
import { deriveMasterKeyMaterial, newDerivationParams, canonicalSignatureBytes } from "../src/crypto/derive";
import { SYNC_TTL_MS } from "../src/sync/adapter";

const PW = "correct horse Battery staple!";
let n = 0;

interface Device {
  material: Uint8Array;
  params: ReturnType<typeof newDerivationParams>;
}

async function newDevice(): Promise<Device> {
  const params = newDerivationParams();
  const material = await deriveMasterKeyMaterial(crypto.getRandomValues(new Uint8Array(65)), params);
  return { material, params };
}

async function newDiary(dev: Device, suffix: string, passphrase?: string): Promise<Diary> {
  return Diary.fromMaterial(dev.material, dev.params, passphrase, suffix);
}

describe("offline/online sync (M3 scope 4)", () => {
  it("addEntry never touches the sync adapter until a coalesced flush (R8: no per-save writes)", async () => {
    const s = `-t${++n}`;
    const dev = await newDevice();
    const diary = await newDiary(dev, s);
    const adapter = await LocalSyncAdapter.open();
    expect(await adapter.list(diary.accountId)).toEqual([]);
    await diary.addEntry("offline day one", "POSITIVE");
    await diary.addEntry("offline day two", "NEGATIVE");
    expect(await adapter.list(diary.accountId)).toEqual([]);
    const pushed = await diary.flush();
    expect(pushed).toBe(2);
    expect((await adapter.list(diary.accountId)).length).toBe(2);
  });

  it("reconnect reconciles without duplicates or loss (second device pulls via same account)", async () => {
    const s = `-t${++n}`;
    const dev = await newDevice();
    const d1 = await newDiary(dev, s);
    await d1.addEntry("day at the beach", "POSITIVE");
    await d1.addEntry("rough meeting day", "NEGATIVE");
    await d1.flush();

    const d2 = await newDiary(dev, s + "-dev2");
    expect(d2.accountId).toBe(d1.accountId);
    const changes = await d2.reconcile();
    expect(changes).toBe(2);
    const list = await d2.listEntries();
    const texts = list.map((e) => e.text).sort();
    expect(texts).toEqual(["day at the beach", "rough meeting day"]);
    const ids = list.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("local edits made offline are preserved and deduped on reconcile (LWW by rev, id-keyed)", async () => {
    const s = `-t${++n}`;
    const dev = await newDevice();
    const d1 = await newDiary(dev, s);
    await d1.addEntry("shared entry", "NEUTRAL");
    await d1.flush();
    const d2 = await newDiary(dev, s + "-dev2");
    await d2.reconcile();

    await d2.addEntry("second device offline entry", "POSITIVE");
    await d2.reconcile();
    const c1 = await d1.reconcile();
    expect(c1).toBe(1);
    const names = (await d1.listEntries()).map((e) => e.text).sort();
    expect(names).toEqual(["second device offline entry", "shared entry"]);
    const ids = (await d1.listEntries()).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("delete removes local + sync ciphertext by id", async () => {
    const s = `-t${++n}`;
    const dev = await newDevice();
    const diary = await newDiary(dev, s);
    const e = await diary.addEntry("delete me", "NEUTRAL");
    await diary.flush();
    const adapter = await LocalSyncAdapter.open();
    expect((await adapter.list(diary.accountId)).map((r) => r.id)).toContain(e.id);
    await diary.deleteEntry(e.id);
    expect((await adapter.list(diary.accountId)).map((r) => r.id)).not.toContain(e.id);
    expect((await diary.listEntries()).map((x) => x.id)).not.toContain(e.id);
  });

  it("sync records carry a 72h TTL and expired ciphertext is swept (GC rule)", async () => {
    const s = `-t${++n}`;
    const dev = await newDevice();
    const diary = await newDiary(dev, s, PW);
    await diary.addEntry("old entry", "NEUTRAL");
    await diary.flush();
    const adapter = await LocalSyncAdapter.open();
    const recs = await adapter.list(diary.accountId);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.expiresAt).toBeGreaterThan(Date.now());
      expect(r.expiresAt - Date.now()).toBeLessThanOrEqual(SYNC_TTL_MS + 1000);
    }
    const meta = await adapter.getMeta(diary.accountId);
    expect(meta?.wrappedBackup).toBeDefined();
    expect(meta?.backupExpiresAt ?? 0).toBeGreaterThan(Date.now());

    const aged = await LocalSyncAdapter.open(() => Date.now() + 73 * 3600 * 1000);
    expect(await aged.list(diary.accountId)).toEqual([]);
    const agedMeta = await aged.getMeta(diary.accountId);
    expect(agedMeta?.wrappedBackup).toBeUndefined();
  });

  it("deleteAccount removes local entries and all sync ciphertext for the account", async () => {
    const s = `-t${++n}`;
    const dev = await newDevice();
    const diary = await newDiary(dev, s, PW);
    await diary.addEntry("gone soon", "NEGATIVE");
    await diary.flush();
    const accountId = diary.accountId;
    await diary.deleteAccount();
    const adapter = await LocalSyncAdapter.open();
    expect(await adapter.getMeta(accountId)).toBeNull();
    expect(await adapter.list(accountId)).toEqual([]);
    expect(await Diary.unlock(s)).toBeNull();
  });

  it("deterministic wallet re-derivation (same signature bytes + stored params) yields the same account", async () => {
    const sig = canonicalSignatureBytes("0x" + "77".repeat(65));
    const params = newDerivationParams();
    const m1 = await deriveMasterKeyMaterial(sig, params);
    const m2 = await deriveMasterKeyMaterial(sig, params);
    const d1 = await Diary.fromMaterial(m1, params, undefined, `-t${++n}`);
    const d2 = await Diary.fromMaterial(m2, params, undefined, `-t${++n}`);
    expect(d1.accountId).toBe(d2.accountId);
  });
});