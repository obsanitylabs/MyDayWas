import { describe, expect, it } from "vitest";
import { LocalDevCustody } from "../src/keycustody.ts";
import { DryRunSubmitter, encodeRecordBatch } from "../src/chain.ts";
import { K_THRESHOLD, PublicationPipeline, canonical, publishableAt } from "../src/pipeline.ts";
import { SignalStore, MAX_NEW_ACCOUNTS_PER_UTC_DAY } from "../src/store.ts";
import { MS_PER_DAY, parseSubmission, RejectedSubmission, SENTIMENTS, type Sentiment } from "../src/types.ts";

const DAY0 = 20_000; // arbitrary UTC-day index
const ingestMs = DAY0 * MS_PER_DAY + 12 * 3_600_000; // noon UTC on DAY0
const publishMs = publishableAt(DAY0) + 1; // just after D+1 00:00 UTC (T+24h passed)

function token(n: number): string {
  return `tok_${n.toString().padStart(13, "0")}`;
}

function newStore(): { store: SignalStore; custody: LocalDevCustody } {
  const custody = new LocalDevCustody();
  const store = new SignalStore((t, d, s) => custody.cellToken(t, d, s));
  return { store, custody };
}

async function addContributors(
  store: SignalStore,
  dayId: number,
  sentiment: Sentiment,
  n: number,
  offset = 0,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await store.record({ v: 1, sentiment, dayId, contributorToken: token(offset + i) }, ingestMs);
  }
}

describe("payload minimization (R9)", () => {
  it("accepts exactly the coarsened tuple (sentiment, dayId) + contributor token", () => {
    const p = parseSubmission(
      { v: 1, sentiment: "POSITIVE", dayId: DAY0, contributorToken: token(1) },
      ingestMs,
    );
    expect(p.unexpected).toEqual([]);
    expect(p.submission).toEqual({ v: 1, sentiment: "POSITIVE", dayId: DAY0, contributorToken: token(1) });
  });

  const forbidden: Array<[string, unknown]> = [
    ["wallet", "0xabc"],
    ["text", "I felt sad today"],
    ["entryId", "0d844c24-..."],
    ["referralPseudonym", "ref_123"],
    ["preciseTime", ingestMs],
    ["lat", 35.68],
  ];
  for (const [field, value] of forbidden) {
    it(`flags forbidden field "${field}" so the server rejects-and-alerts`, () => {
      const p = parseSubmission(
        { v: 1, sentiment: "POSITIVE", dayId: DAY0, contributorToken: token(1), [field]: value },
        ingestMs,
      );
      expect(p.unexpected).toContain(field);
    });
  }

  it("rejects bad sentiment / version / token shape", () => {
    expect(() =>
      parseSubmission({ v: 1, sentiment: "HAPPY", dayId: DAY0, contributorToken: token(1) }, ingestMs),
    ).toThrow(RejectedSubmission);
    expect(() =>
      parseSubmission({ v: 2, sentiment: "POSITIVE", dayId: DAY0, contributorToken: token(1) }, ingestMs),
    ).toThrow(RejectedSubmission);
    expect(() =>
      parseSubmission({ v: 1, sentiment: "POSITIVE", dayId: DAY0, contributorToken: "short" }, ingestMs),
    ).toThrow(RejectedSubmission);
  });

  it("enforces the ingest window: no future days, nothing older than 7 days", () => {
    expect(() =>
      parseSubmission({ v: 1, sentiment: "POSITIVE", dayId: DAY0 + 1, contributorToken: token(1) }, ingestMs),
    ).toThrow(/dayId_out_of_window/);
    expect(() =>
      parseSubmission({ v: 1, sentiment: "POSITIVE", dayId: DAY0 - 8, contributorToken: token(1) }, ingestMs),
    ).toThrow(/dayId_out_of_window/);
    expect(() =>
      parseSubmission({ v: 1, sentiment: "POSITIVE", dayId: DAY0 - 7, contributorToken: token(1) }, ingestMs),
    ).not.toThrow();
  });
});

describe("k-distinctness (distinctness definition + account-creation rate limit)", () => {
  it("counts distinct blinded tokens, not raw re-submissions", async () => {
    const { store } = newStore();
    await addContributors(store, DAY0, "POSITIVE", 5);
    for (let i = 0; i < 10; i++) {
      await store.record({ v: 1, sentiment: "POSITIVE", dayId: DAY0, contributorToken: token(0) }, ingestMs);
    }
    expect(store.distinctContributors(DAY0, "POSITIVE")).toBe(5);
  });

  it("blinded tokens are unlinkable across cells and days", async () => {
    const { custody } = newStore();
    const t = token(0);
    expect(
      new Set([
        await custody.cellToken(t, DAY0, "POSITIVE"),
        await custody.cellToken(t, DAY0, "NEGATIVE"),
        await custody.cellToken(t, DAY0 + 1, "POSITIVE"),
      ]).size,
    ).toBe(3);
  });

  it("rate limit caps new contributor tokens per UTC day; existing tokens still pass", async () => {
    const { store } = newStore();
    await addContributors(store, DAY0, "POSITIVE", MAX_NEW_ACCOUNTS_PER_UTC_DAY);
    await expect(
      store.record({ v: 1, sentiment: "POSITIVE", dayId: DAY0, contributorToken: token(9_999_999) }, ingestMs),
    ).rejects.toThrow(/new_account_rate_limited/);
    // an already-seen token is unaffected
    await store.record({ v: 1, sentiment: "POSITIVE", dayId: DAY0, contributorToken: token(0) }, ingestMs);
    // the cap resets next UTC day
    await store.record(
      { v: 1, sentiment: "POSITIVE", dayId: DAY0 + 1, contributorToken: token(9_999_999) },
      (DAY0 + 1) * MS_PER_DAY + 3_600_000,
    );
    expect(store.distinctContributors(DAY0 + 1, "POSITIVE")).toBe(1);
  });
});

describe("below-k suppression (CI-required)", () => {
  it("suppresses cells below k=100 before anything touches the chain", async () => {
    const { store, custody } = newStore();
    const pipeline = new PublicationPipeline(store, custody, new DryRunSubmitter());
    await addContributors(store, DAY0, "POSITIVE", K_THRESHOLD - 1);
    const batch = pipeline.buildBatch(DAY0, publishMs);
    expect(batch.hasPublishedCells).toBe(false);
    expect(batch.deltas).toEqual([0, 0, 0]);
    expect(batch.cells.every((c) => !c.published)).toBe(true);
  });

  it("publishes exactly the cells at/above k; delta = distinct contributors", async () => {
    const { store, custody } = newStore();
    const pipeline = new PublicationPipeline(store, custody, new DryRunSubmitter());
    await addContributors(store, DAY0, "POSITIVE", K_THRESHOLD);
    await addContributors(store, DAY0, "NEGATIVE", 250);
    await addContributors(store, DAY0, "NEUTRAL", 99);
    const batch = pipeline.buildBatch(DAY0, publishMs);
    expect(batch.deltas).toEqual([100, 250, 0]);
    expect(batch.publishedContributors).toBe(100); // min across published cells
    // a cell at exactly k publishes
    expect(batch.cells.find((c) => c.sentiment === "POSITIVE")?.published).toBe(true);
    // a cell at k-1 suppresses even next to published siblings
    expect(batch.cells.find((c) => c.sentiment === "NEUTRAL")?.published).toBe(false);
  });

  it("day fully below k: no recordBatch, but reconciliation still records submitted vs published", async () => {
    const { store, custody } = newStore();
    const pipeline = new PublicationPipeline(store, custody, new DryRunSubmitter());
    await addContributors(store, DAY0, "POSITIVE", 10);
    const artifact = await pipeline.publishDay(DAY0, publishMs);
    expect(artifact.chain.recordBatch?.hasPublishedCells ?? null).toBeFalsy();
    expect(artifact.cells[0]).toMatchObject({
      sentiment: "POSITIVE",
      submittedContributors: 10,
      published: false,
    });
  });

  it("published day: one signed reconciliation artifact, verifiable, tamper-evident", async () => {
    const { store, custody } = newStore();
    const pipeline = new PublicationPipeline(store, custody, new DryRunSubmitter());
    await addContributors(store, DAY0, "POSITIVE", 150);
    const artifact = await pipeline.publishDay(DAY0, publishMs);
    expect(artifact.schema).toBe("mydaywas.reconciliation.v1");
    expect(artifact.chain.recordBatch?.deltas).toEqual([150, 0, 0]);
    expect(await pipeline.verifyArtifact(artifact)).toBe(true);
    const forged = { ...artifact, cells: artifact.cells.map((c) => ({ ...c, published: true })) };
    expect(await pipeline.verifyArtifact(forged)).toBe(false);
  });
});

describe("server-enforced T+24h", () => {
  it("refuses to publish day D before D+1 00:00 UTC, even with k reached", async () => {
    const { store, custody } = newStore();
    const pipeline = new PublicationPipeline(store, custody, new DryRunSubmitter());
    await addContributors(store, DAY0, "POSITIVE", 500);
    expect(() => pipeline.buildBatch(DAY0, publishableAt(DAY0) - 1)).toThrowError(/not publishable/);
    expect(pipeline.buildBatch(DAY0, publishMs).dayId).toBe(DAY0);
  });

  it("configurable delay can tighten beyond 24h but never below it", async () => {
    const { store, custody } = newStore();
    await addContributors(store, DAY0, "POSITIVE", 500);
    const slower = new PublicationPipeline(store, custody, new DryRunSubmitter(), {
      delayMs: 48 * 3_600_000,
    });
    expect(() => slower.buildBatch(DAY0, publishMs)).toThrowError(/not publishable/);
    expect(slower.buildBatch(DAY0, publishableAt(DAY0) + 24 * 3_600_000).dayId).toBe(DAY0);
    // a config below 24h is floored at T+24h: never publishes before D+1 00:00 UTC
    const faster = new PublicationPipeline(store, custody, new DryRunSubmitter(), {
      delayMs: 3_600_000,
    });
    expect(() => faster.buildBatch(DAY0, publishableAt(DAY0) - 1)).toThrowError(/not publishable/);
    expect(faster.buildBatch(DAY0, publishableAt(DAY0) + 1).dayId).toBe(DAY0);
  });
});

describe("store retention", () => {
  it("purges ingested cells older than RETENTION_DAYS (integer counts only, no content)", async () => {
    const { store } = newStore();
    await addContributors(store, DAY0 - 40, "POSITIVE", 5);
    await addContributors(store, DAY0, "NEUTRAL", 5);
    const purged = store.purge(DAY0 * MS_PER_DAY);
    expect(purged).toEqual([{ dayId: DAY0 - 40, sentiment: "POSITIVE", purgedAtMs: DAY0 * MS_PER_DAY }]);
    expect(store.distinctContributors(DAY0 - 40, "POSITIVE")).toBe(0);
    expect(store.distinctContributors(DAY0, "NEUTRAL")).toBe(5);
  });
});

describe("recordBatch ABI encoding", () => {
  it("uses the selector pinned from the compiled contract and encodes words", () => {
    // keccak256("recordBatch(uint32,uint24[3],uint24)")[0:4] from solc-js
    // methodIdentifiers — see contracts/compile.mjs output.
    const data = encodeRecordBatch(DAY0, [100, 0, 0], 100);
    expect(data.slice(0, 10)).toBe("0x0f4d576c");
    expect(data.length).toBe(2 + 8 + 64 * 7); // "0x" + selector hex + 7 × 32-byte ABI words (2 hex chars/byte)
  });
});

describe("server (HTTP ingest + publish)", () => {
  it("202 on a valid tuple, 400 on unexpected fields, 409 before T+24h, alert raised", async () => {
    const { createSignalServer } = await import("../src/server.js");
    const custody = new LocalDevCustody();
    const { server, alerts } = createSignalServer(custody, {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const post = async (path: string, body: unknown): Promise<{ status: number; json: unknown }> => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    };
    // server enforces the ingest window against real wall-clock now():
    // use the current UTC day so the window check passes.
    const today = Math.floor(Date.now() / MS_PER_DAY);
    const valid = { v: 1, sentiment: "POSITIVE", dayId: today, contributorToken: token(1) };
    expect((await post("/v1/signals", valid)).status).toBe(202);
    const contentBearing = { ...valid, text: "I felt sad today" };
    expect((await post("/v1/signals", contentBearing)).status).toBe(400);
    expect(alerts.list().some((a) => a.reason === "unexpected_submission_fields")).toBe(true);
    // publish the CURRENT UTC day immediately: T+24h not passed -> 409
    const p = await post("/v1/publish", { dayId: today });
    expect(p.status).toBe(409);
    server.close();
  });
});

void SENTIMENTS;
void canonical;