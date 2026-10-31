import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDevCustody } from "../src/keycustody.ts";
import { DryRunSubmitter } from "../src/chain.ts";
import { PublicationPipeline } from "../src/pipeline.ts";
import { SignalStore, MAX_NEW_ACCOUNTS_PER_UTC_DAY } from "../src/store.ts";
import { DurableSignalStore, SqlitePublicationLedger } from "../src/durable.ts";
import { AlreadyPublished } from "../src/pipeline.ts";
import { MS_PER_DAY, type Sentiment, type SignalSubmission } from "../src/types.ts";

const DAY0 = 21_000;
const ingestMs = DAY0 * MS_PER_DAY + 12 * 3_600_000;

function token(n: number): string {
  return `tok_${n.toString().padStart(13, "0")}`;
}

function sub(sentiment: Sentiment, dayId: number, t: string): SignalSubmission {
  return { v: 1, sentiment, dayId, contributorToken: t };
}

const dirs: string[] = [];
function newDir(): string {
  const d = mkdtempSync(join(tmpdir(), "mydaywas-f3-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function newDurable(dir = newDir()): { store: DurableSignalStore; custody: LocalDevCustody } {
  const custody = new LocalDevCustody();
  const store = new DurableSignalStore(join(dir, "relayer.db"), (t, d, s) => custody.cellToken(t, d, s));
  return { store, custody };
}

describe("F3 durable ledger", () => {
  it("survives restart: a day claimed before restart is not claimable after reopen", async () => {
    const dir = newDir();
    const ledger = new SqlitePublicationLedger(join(dir, "relayer.db"));
    expect(await ledger.tryClaim(DAY0)).toBe(true);
    expect(await ledger.tryClaim(DAY0)).toBe(false); // same process
    ledger.close();
    // simulated restart: fresh handle on the same file
    const reopened = new SqlitePublicationLedger(join(dir, "relayer.db"));
    expect(await reopened.tryClaim(DAY0)).toBe(false);
    expect(await reopened.tryClaim(DAY0 + 1)).toBe(true);
    reopened.close();
  });

  it("release makes a failed-submission day retryable, durably", async () => {
    const dir = newDir();
    const path = join(dir, "relayer.db");
    const ledger = new SqlitePublicationLedger(path);
    expect(await ledger.tryClaim(DAY0)).toBe(true);
    await ledger.release(DAY0);
    ledger.close();
    const reopened = new SqlitePublicationLedger(path);
    expect(await reopened.tryClaim(DAY0)).toBe(true); // claim re-usable after transport-level release
    reopened.close();
  });

  it("multi-instance: concurrent cross-process claims resolve to exactly one winner", async () => {
    const path = join(newDir(), "relayer.db");
    const a = new SqlitePublicationLedger(path);
    const b = new SqlitePublicationLedger(path);
    // fire both claims without awaiting in between
    const results = await Promise.all([a.tryClaim(DAY0), b.tryClaim(DAY0)]);
    expect(results.filter(Boolean).length).toBe(1);
    expect(await a.tryClaim(DAY0)).toBe(false);
    expect(await b.tryClaim(DAY0)).toBe(false);
    a.close();
    b.close();
  });
});

describe("F3 durable store", () => {
  it("survives restart: cells, counts and first-seen state persist", async () => {
    const dir = newDir();
    const path = join(dir, "relayer.db");
    const { store } = newDurable();
    // (write into the dir-based db explicitly)
    store.close();
    const custody = new LocalDevCustody();
    const s1 = new DurableSignalStore(path, (t, d, se) => custody.cellToken(t, d, se));
    await s1.record(sub("POSITIVE", DAY0, token(0)), ingestMs);
    for (let i = 0; i < 10; i++) {
      await s1.record(sub("POSITIVE", DAY0, token(1)), ingestMs); // re-submissions
    }
    expect(s1.distinctContributors(DAY0, "POSITIVE")).toBe(2);
    expect(s1.stats(DAY0, "POSITIVE")).toEqual({ contributors: 2, submissions: 11 });
    s1.close();
    // simulated restart with a NEW custody key: cells are blinded per-day, so
    // counts (durable) are preserved exactly; only fresh blinding changes tokens.
    const s2 = new DurableSignalStore(path, (t, d, se) => custody.cellToken(t, d, se));
    expect(s2.stats(DAY0, "POSITIVE")).toEqual({ contributors: 2, submissions: 11 });
    // the already-seen token(0) does not consume a new-account slot after restart
    await s2.record(sub("NEGATIVE", DAY0, token(0)), ingestMs);
    expect(s2.distinctContributors(DAY0, "NEGATIVE")).toBe(1);
    s2.close();
  });

  it("shared atomic new-account counter: concurrent writers across instances respect the cap exactly", async () => {
    const path = join(newDir(), "relayer.db");
    const custody = new LocalDevCustody();
    const stores = [0, 1, 2].map(() => new DurableSignalStore(path, (t, d, s) => custody.cellToken(t, d, s)));
    const total = MAX_NEW_ACCOUNTS_PER_UTC_DAY + 50;
    const perStore = Math.ceil(total / stores.length);
    // one submission per distinct token across all instances, concurrently;
    // over-cap submissions reject (rate limit) instead of settling
    const outcomes = await Promise.all(
      stores.flatMap((store, si) =>
        Array.from({ length: perStore }, (_, i) => {
          const n = si * perStore + i;
          return store
            .record(sub("POSITIVE", DAY0, `acct_${n.toString().padStart(20, "0")}`), ingestMs)
            .then(() => "fulfilled" as const)
            .catch((e: unknown) => {
              if (!(e instanceof Error) || !/new_account_rate_limited/.test(e.message)) throw e;
              return "rate_limited" as const;
            });
        }),
      ),
    );
    const accepted = outcomes.filter((o) => o === "fulfilled").length;
    // exactly MAX_NEW_ACCOUNTS_PER_UTC_DAY new accounts across ALL instances combined
    expect(accepted).toBe(MAX_NEW_ACCOUNTS_PER_UTC_DAY);
    expect(outcomes.filter((o) => o === "rate_limited").length).toBe(total - MAX_NEW_ACCOUNTS_PER_UTC_DAY);
    // all handles read the same shared committed state: exactly cap contributors
    for (const s of stores) expect(s.distinctContributors(DAY0, "POSITIVE")).toBe(MAX_NEW_ACCOUNTS_PER_UTC_DAY);
    stores.forEach((s) => s.close());
  });

  it("rate limit: over-cap tokens are rejected, existing tokens still pass, cap resets next day", async () => {
    const dir = newDir();
    const { store } = newDurable(dir);
    // use a fresh custody matching newDurable's (recreate cleanly)
    store.close();
    const custody = new LocalDevCustody();
    const s = new DurableSignalStore(join(dir, "relayer.db"), (t, d, se) => custody.cellToken(t, d, se));
    for (let i = 0; i < MAX_NEW_ACCOUNTS_PER_UTC_DAY; i++) {
      await s.record(sub("POSITIVE", DAY0, `acct_${i.toString().padStart(20, "0")}`), ingestMs);
    }
    await expect(s.record(sub("POSITIVE", DAY0, token(9_999_999)), ingestMs)).rejects.toThrow(/new_account_rate_limited/);
    // an already-seen token is unaffected
    await s.record(sub("POSITIVE", DAY0, `acct_${"0".padStart(20, "0")}`), ingestMs);
    // the cap resets next UTC day (and marker day-resolution is per first-seen day)
    await s.record(sub("POSITIVE", DAY0 + 1, token(9_999_999)), (DAY0 + 1) * MS_PER_DAY + 3_600_000);
    expect(s.distinctContributors(DAY0 + 1, "POSITIVE")).toBe(1);
    s.close();
  });

  it("no raw contributor tokens or free-text content on disk (blinded markers + counts only)", async () => {
    const dir = newDir();
    const { store } = newDurable(dir);
    await store.record(sub("POSITIVE", DAY0, "SECRETTOKEN12345678"), ingestMs);
    store.close();
    const raw = await import("node:fs").then((fs) => fs.readFileSync(join(dir, "relayer.db"), "utf8"));
    expect(raw).not.toContain("SECRETTOKEN12345678");
    expect(raw).not.toContain("POSITIVE|"); // blinded HMAC output only, no HMAC input strings
  });

  it("purges ingested cells older than RETENTION_DAYS", async () => {
    const { store } = newDurable();
    await store.record(sub("POSITIVE", DAY0 - 40, token(0)), ingestMs);
    await store.record(sub("NEUTRAL", DAY0, token(1)), ingestMs);
    const purged = store.purge(DAY0 * MS_PER_DAY);
    expect(purged).toEqual([{ dayId: DAY0 - 40, sentiment: "POSITIVE", purgedAtMs: DAY0 * MS_PER_DAY }]);
    expect(store.distinctContributors(DAY0 - 40, "POSITIVE")).toBe(0);
    expect(store.distinctContributors(DAY0, "NEUTRAL")).toBe(1);
    store.close();
  });
});

describe("F3 pipeline on the durable backend", () => {
  it("replay prevention holds across a simulated restart (F2 + F3 combined)", async () => {
    const dir = newDir();
    const path = join(dir, "relayer.db");
    const custody = new LocalDevCustody();
    const mk = () => ({
      store: new DurableSignalStore(path, (t, d, s) => custody.cellToken(t, d, s)),
      ledger: new SqlitePublicationLedger(path),
    });
    const first = mk();
    const pipeline1 = new PublicationPipeline(first.store, custody, new DryRunSubmitter(), { ledger: first.ledger });
    await pipeline1.publishDay(DAY0, (DAY0 + 1) * MS_PER_DAY + 1);
    first.store.close();
    first.ledger.close();
    // restart: a fresh process sees the published day and rejects the replay
    const second = mk();
    const pipeline2 = new PublicationPipeline(second.store, custody, new DryRunSubmitter(), { ledger: second.ledger });
    await expect(pipeline2.publishDay(DAY0, (DAY0 + 1) * MS_PER_DAY + 1)).rejects.toThrow(AlreadyPublished);
    second.store.close();
    second.ledger.close();
  });

  it("parity with the in-memory store surface", async () => {
    const dir = newDir();
    const { store } = newDurable(dir);
    const custody2 = new LocalDevCustody();
    const mem = new SignalStore((t, d, s) => custody2.cellToken(t, d, s));
    const rows: Array<[Sentiment, number, string]> = [
      ["POSITIVE", DAY0, token(0)],
      ["POSITIVE", DAY0, token(1)],
      ["POSITIVE", DAY0, token(0)], // duplicate submission
      ["NEGATIVE", DAY0, token(0)],
      ["NEUTRAL", DAY0 + 1, token(2)],
    ];
    for (const [sentiment, dayId, t] of rows) {
      const now = dayId * MS_PER_DAY + 3_600_000;
      await store.record(sub(sentiment, dayId, t), now);
      await mem.record(sub(sentiment, dayId, t), now);
    }
    for (const sentiment of ["POSITIVE", "NEGATIVE", "NEUTRAL"] as const) {
      expect(store.stats(DAY0, sentiment)).toEqual(mem.stats(DAY0, sentiment));
      expect(store.stats(DAY0 + 1, sentiment)).toEqual(mem.stats(DAY0 + 1, sentiment));
    }
    store.close();
  });
});