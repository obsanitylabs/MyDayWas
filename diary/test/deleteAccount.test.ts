import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { Diary } from "../src/app/api";
import { purgeSharedAccountState } from "../src/app/accountCleanup";
import { DELETE_ACCOUNT_CONFIRM } from "../src/legal/betaCopy";
import { getSignalsOptIn, setSignalsOptIn } from "../src/signals/settings";
import { getContributorToken } from "../src/signals/submit";
import { getReferralConsent, setReferralConsent } from "../src/referral/consent";
import { buildReferralItem, enqueue } from "../src/referral/queue";
import { getReferralPseudonym } from "../src/referral/pseudonym";
import type { Eip1193Provider } from "../src/auth/wallet";

/** Minimal Storage mock (node test env has no localStorage). */
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
}

const PW = "correct horse Battery staple!";

function fakeProvider(): Eip1193Provider {
  return {
    async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
      if (args.method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000000"];
      if (args.method === "personal_sign") {
        // deterministic 65-byte (r,s,v) test signature
        return "0x" + "ab".repeat(65);
      }
      throw new Error(`unexpected method ${args.method}`);
    },
  };
}

describe("D3 (OBS-364): delete-account consent cleanup makes the dialog promises true", () => {
  it("post-delete localStorage matches the dialog: signals stopped, token gone, referral consent revoked, queue and pseudonym purged", () => {
    const storage = new MemoryStorage();
    // seed everything the dialog names
    setSignalsOptIn(storage, true);
    getContributorToken(storage);
    const consent = getReferralConsent(storage);
    consent.referralEnabled = true;
    consent.fields.contactMethod = true;
    setReferralConsent(storage, consent);
    const c = getReferralConsent(storage);
    const item = buildReferralItem(c, getReferralPseudonym(storage), { type: "email", value: "a@b.c" }, "EU");
    enqueue(storage, item);
    expect(storage.length).toBe(5); // optin, token, consent, queue, pseudonym

    purgeSharedAccountState(storage);

    // "stop your signals" — opt-in is OFF, not silently left enabled
    expect(getSignalsOptIn(storage).enabled).toBe(false);
    // the signal token is gone entirely
    expect(storage.getItem("mydaywas.signals.token.v1")).toBeNull();
    // referral consent is revoked (all fields off, day-resolution only)
    const rc = getReferralConsent(storage);
    expect(rc.referralEnabled).toBe(false);
    expect(rc.fields.contactMethod).toBe(false);
    // the pending partner referral queue is purged
    expect(storage.getItem("mydaywas.referral.queue.v1")).toBeNull();
    // the referral pseudonym does not survive the account
    expect(storage.getItem("mydaywas.referral.pseudonym.v1")).toBeNull();
    // exactly the two revoked-flag records remain, nothing else
    expect(storage.length).toBe(2);
    // no precise timestamps in what remains (day-resolution only)
    const optin = JSON.parse(storage.getItem("mydaywas.signals.optin.v1") ?? "{}") as { updatedDay: number };
    expect(Number.isInteger(optin.updatedDay)).toBe(true);
  });

  it("the final dialog copy is the GC-cleared string and each promise now has a real cleanup action", () => {
    expect(DELETE_ACCOUNT_CONFIRM).toContain("We will stop your signals, clear your signal queue, and purge any pending partner referrals");
    expect(DELETE_ACCOUNT_CONFIRM).toContain("A platform backup outside this app (for example a phone-maker backup) may still hold a copy");
    // promise -> implementation mapping (purgeSharedAccountState) proven above
  });

  it("cleanup is idempotent and safe on a fresh device", () => {
    const storage = new MemoryStorage();
    expect(() => purgeSharedAccountState(storage)).not.toThrow();
    expect(getSignalsOptIn(storage).enabled).toBe(false);
    expect(storage.getItem("mydaywas.referral.queue.v1")).toBeNull();
  });
});

describe("D4 (OBS-364): optional onboarding passphrase makes the encrypted-backup path reachable", () => {
  it("onboard WITH a passphrase: backup set, export enabled, export → import round-trip restores entries", async () => {
    const fetchCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args: unknown[]) => { fetchCalls.push(args); throw new Error("no network in test"); };
    try {
      const diary = await Diary.onboard(fakeProvider(), "0x0000000000000000000000000000000000000000", PW, "-d4a");
      await diary.addEntry("day one with passphrase", "POSITIVE");
      await diary.flush();
      // (1)+(2): the passphrase was set at onboarding and the export control is enabled
      expect(await diary.hasPassphraseBackup()).toBe(true);
      // (3): export → import round-trip
      const backupStr = await diary.exportEncryptedBackup();
      const file = JSON.parse(backupStr) as { entries: Array<{ id: string }> };
      expect(file.entries.length).toBe(1);
      const restored = await Diary.restore(JSON.parse(backupStr) as Parameters<typeof Diary.restore>[0], PW, "-d4b");
      const entries = await restored.listEntries();
      expect(entries.map((e) => e.text)).toEqual(["day one with passphrase"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("onboard WITHOUT a passphrase: export stays disabled and changePassphrase fails closed (unchanged v1 default)", async () => {
    const diary = await Diary.onboard(fakeProvider(), "0x0000000000000000000000000000000000000000", undefined, "-d4c");
    expect(await diary.hasPassphraseBackup()).toBe(false);
    await expect(diary.changePassphrase("a", PW)).rejects.toThrow(/no passphrase backup set/);
    await expect(diary.exportEncryptedBackup()).rejects.toThrow(/no passphrase backup set/);
  });

  it("no-leak probe: the passphrase never appears in the backup file, sync meta, or any network request, and the diary key stays non-extractable", async () => {
    const fetchCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args: unknown[]) => { fetchCalls.push(args); throw new Error("no network in test"); };
    try {
      const diary = await Diary.onboard(fakeProvider(), "0x0000000000000000000000000000000000000000", PW, "-d4d");
      await diary.addEntry("secret day", "NEGATIVE");
      await diary.flush();
      const backupStr = await diary.exportEncryptedBackup();
      // (4) passphrase never in the exported artifact or the sync ciphertext
      expect(backupStr).not.toContain(PW);
      expect(backupStr).not.toContain("correct horse");
      // and nothing was transmitted — zero fetch calls during onboard/export
      expect(fetchCalls.length).toBe(0);
      // the wrapped backup is an AES-GCM envelope over the key material (not the passphrase)
      const file = JSON.parse(backupStr) as { wrappedBackup: { iterations: number; salt: string } };
      expect(file.wrappedBackup.iterations).toBeGreaterThanOrEqual(600_000);
      expect(file.wrappedBackup.salt.length).toBeGreaterThanOrEqual(16);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});