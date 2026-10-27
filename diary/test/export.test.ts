import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { Diary, type BackupFile } from "../src/app/api";
import { deriveMasterKeyMaterial, newDerivationParams } from "../src/crypto/derive";

let n = 0;
const PW = "correct horse Battery staple!";

async function newDiary(): Promise<Diary> {
  const params = newDerivationParams();
  const material = await deriveMasterKeyMaterial(crypto.getRandomValues(new Uint8Array(65)), params);
  return Diary.fromMaterial(material, params, PW, `-t${++n}`);
}

describe("export / backup / restore (M3 scope 3)", () => {
  it("plaintext JSON export is complete and usable (all entries, decrypted)", async () => {
    const diary = await newDiary();
    await diary.addEntry("first day entry", "POSITIVE");
    await diary.addEntry("second day entry", "NEGATIVE");
    const json = JSON.parse(await diary.exportJSON());
    expect(json.kind).toBe("mydaywas.export.v1");
    const texts = json.entries.map((e: { text: string }) => e.text).sort();
    expect(texts).toEqual(["first day entry", "second day entry"]);
    expect(json.entries.every((e: { day: number }) => typeof e.day === "number")).toBe(true);
  });

  it("encrypted backup export contains no plaintext and restores fully on a fresh vault", async () => {
    const diary = await newDiary();
    await diary.addEntry("restorable day", "NEUTRAL");
    await diary.flush();
    const raw = await diary.exportEncryptedBackup();
    expect(raw).not.toContain("restorable day");
    const file = JSON.parse(raw) as BackupFile;
    expect(file.kind).toBe("mydaywas.backup.v1");
    const restored = await Diary.restore(file, PW, `-t${++n}`);
    expect(restored.accountId).toBe(diary.accountId);
    const texts = (await restored.listEntries()).map((e) => e.text);
    expect(texts).toContain("restorable day");
    const ids = (await restored.listEntries()).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("backup restore fails closed on a wrong passphrase", async () => {
    const diary = await newDiary();
    await diary.addEntry("locked day", "POSITIVE");
    const file = JSON.parse(await diary.exportEncryptedBackup()) as BackupFile;
    await expect(Diary.restore(file, "wrong passphrase entirely")).rejects.toThrow();
  });

  it("passphrase change re-wraps and the new passphrase unlocks the backup", async () => {
    const diary = await newDiary();
    const e = await diary.addEntry("wrapped day", "NEGATIVE");
    await diary.flush();
    await diary.changePassphrase(PW, "Another strong Passphrase 42!");
    const file = JSON.parse(await diary.exportEncryptedBackup()) as BackupFile;
    await expect(Diary.restore(file, PW)).rejects.toThrow();
    const restored = await Diary.restore(file, "Another strong Passphrase 42!");
    expect((await restored.listEntries()).map((x) => x.id)).toContain(e.id);
  });
});