/**
 * OBS-775 — M6 remediation round 2 regression tests.
 *
 * Item A (M3): the `publication_missing` escalation must be reachable in the
 * running service. These tests retain a publish (successful or
 * BroadcastUncertainError), drive the read-only sweep DIRECTLY (no second
 * request-driven check), and prove the distinct after-horizon alert fires once.
 *
 * Item B (H2 edge): a DEFINITE JSON-RPC rejection must return the reserved
 * nonce and release the ledger claim (day retryable); an UNCERTAIN failure must
 * keep both. The definite test is the discriminator; the uncertain test's
 * behavioural half is a guard (the pre-fix tree already treated every failure
 * as uncertain) and its classifier assertions are the discriminator.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { getPublicKey as secpGetPublicKey } from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { Alerts, type Alert } from "../src/log.ts";
import { LocalDevCustody } from "../src/keycustody.ts";
import { ReconciliationMonitor } from "../src/monitor.ts";
import { PublicationPipeline, publishableAt } from "../src/pipeline.ts";
import { SignalStore } from "../src/store.ts";
import { MemoryPublicationLedger } from "../src/ledger.ts";
import { BroadcastUncertainError, DryRunSubmitter, type ChainSubmitter, type RecordBatch } from "../src/chain.ts";
import { RpcLegacySender } from "../src/chainrpc.ts";
import { createSignalServer } from "../src/server.ts";
import { MS_PER_DAY } from "../src/types.ts";

const bytesToHex = (b: Uint8Array): string => "0x" + [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, "");
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(i * 2, 2), 16));
};

async function buildArtifact(dayId = 0): Promise<{ custody: LocalDevCustody; artifact: Awaited<ReturnType<PublicationPipeline["publishDay"]>> }> {
  const custody = new LocalDevCustody();
  const store = new SignalStore((t, d, s) => custody.cellToken(t, d, s));
  await store.record(
    { v: 1, sentiment: "POSITIVE", dayId, contributorToken: "tok_m3h2_item_a" },
    dayId * MS_PER_DAY + 12 * 3_600_000,
  );
  const pipeline = new PublicationPipeline(store, custody, new DryRunSubmitter(), { kThreshold: 1, delayMs: 0 });
  const artifact = await pipeline.publishDay(dayId, publishableAt(dayId) + 1);
  return { custody, artifact };
}

// ---- Item A: retained publishes reach publication_missing via the sweep -----

describe("OBS-775 M3: periodic read-only sweep reaches publication_missing", () => {
  it("escalates a successfully returned publish after the horizon without a second request check()", async () => {
    const { custody, artifact } = await buildArtifact();
    const sink: Alert[] = [];
    const alerts = new Alerts((a) => sink.push(a));
    const t0 = 1_700_000_000_000;
    const monitor = new ReconciliationMonitor(custody, alerts, {
      recorded: async () => null,
      missingAfterMs: 30 * 60_000,
      poll: { attempts: 1, initialDelayMs: 1 },
      sleep: async () => {},
    });

    // The request path's single check observes the day still-null -> pending.
    await expect(monitor.check(artifact, t0)).resolves.toEqual({ status: "pending" });
    expect(sink.filter((a) => a.reason === "publication_missing")).toHaveLength(0);
    expect(monitor.retainedCount).toBe(1);

    // Drive the sweep directly — there is NO second request-driven check().
    await expect(monitor.sweep(t0 + 30 * 60_000)).resolves.toBe(1);
    const missing = sink.filter((a) => a.reason === "publication_missing");
    expect(missing).toHaveLength(1);
    // Alert shape is unchanged: {reason, raisedDay, detail} only.
    expect(Object.keys(missing[0]!).sort()).toEqual(["detail", "raisedDay", "reason"]);

    // Deduped per day: the next sweep does not raise a second alert.
    await monitor.sweep(t0 + 60 * 60_000);
    expect(sink.filter((a) => a.reason === "publication_missing")).toHaveLength(1);
  });

  it("retains a publish ending in BroadcastUncertainError and reaches publication_missing", async () => {
    const custody = new LocalDevCustody();
    const sink: Alert[] = [];
    const dayId = 20_000;
    let onChain: { dayId: number; deltas: [number, number, number] } | null = null;
    const { server, store, reconciliation } = createSignalServer(custody, {
      chain: {
        name: "uncertain-test-submitter",
        async submitRecordBatch(_batch: RecordBatch): Promise<RecordBatch> {
          throw new BroadcastUncertainError("broadcast outcome unknown (test)");
        },
      },
      kThreshold: 1,
      delayMs: 0,
      alertSink: (a) => sink.push(a),
      reconciliation: {
        recorded: async (d) => (onChain !== null && onChain.dayId === d ? onChain : null),
        missingAfterMs: 1,
        poll: { attempts: 1, initialDelayMs: 1 },
        sleep: async () => {},
        // Tests drive the sweep directly; the timer itself is covered by the
        // server's interval wiring (sweepIntervalMs default > 0 in production).
        sweepIntervalMs: 0,
      },
    });
    await store.record(
      { v: 1, sentiment: "POSITIVE", dayId, contributorToken: "tok_m3h2_uncertain" },
      dayId * MS_PER_DAY + 12 * 3_600_000,
    );
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dayId }),
      });
      expect(res.status).toBe(500); // request outcome unchanged: broadcast unknown

      // The service retained the dayId even though publishDay threw before signing.
      expect(reconciliation).toBeDefined();
      expect(reconciliation!.retainedCount).toBe(1);

      await reconciliation!.sweep(Date.now() + 10_000);
      const missing = sink.filter((a) => a.reason === "publication_missing");
      expect(missing).toHaveLength(1);

      // A later successful read clears the retained record (existing behaviour).
      onChain = { dayId, deltas: [1, 0, 0] };
      await reconciliation!.sweep(Date.now() + 20_000);
      expect(reconciliation!.retainedCount).toBe(0);
      expect(sink.filter((a) => a.reason === "publication_missing")).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it("bounds the retained registry (oldest entries evicted)", async () => {
    const { custody } = await buildArtifact();
    const sink: Alert[] = [];
    const alerts = new Alerts((a) => sink.push(a));
    const t0 = 1_700_000_000_000;
    const monitor = new ReconciliationMonitor(custody, alerts, {
      // day 1 stays absent; days 2/3 land. If day 1 survived the cap it would
      // keep the registry non-empty after the sweep.
      recorded: async (dayId) => (dayId === 1 ? null : { dayId, deltas: [1, 0, 0] as [number, number, number] }),
      maxRetained: 2,
      poll: { attempts: 1, initialDelayMs: 1 },
      sleep: async () => {},
    });
    monitor.trackUncertain(1, t0);
    monitor.trackUncertain(2, t0);
    monitor.trackUncertain(3, t0);
    expect(monitor.retainedCount).toBe(2);
    await expect(monitor.sweep(t0)).resolves.toBe(2);
    expect(monitor.retainedCount).toBe(0);
  });
});

// ---- Item B: definite vs uncertain eth_sendRawTransaction failures ----------

describe("OBS-775 H2 edge: classify definite RPC rejections vs uncertain failures", () => {
  type RpcOutcome = { result?: unknown } | { error: { code: number | string; message: string } };
  function rpcFetch(handler: (method: string, params: unknown[]) => RpcOutcome): typeof fetch {
    return async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
      const outcome = handler(body.method, body.params);
      const json = "error" in outcome
        ? { jsonrpc: "2.0", id: body.id, error: outcome.error }
        : { jsonrpc: "2.0", id: body.id, result: outcome.result };
      return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
    };
  }

  function keyMaterial(): { keyHex: string; eoa: string } {
    const keyBytes = randomBytes(32);
    const pub65 = secpGetPublicKey(keyBytes, false);
    return {
      keyHex: bytesToHex(keyBytes),
      eoa: "0x" + Buffer.from(keccak_256(pub65.subarray(1))).slice(-20).toString("hex"),
    };
  }

  const to = "0xEdeAC98".padEnd(42, "0");
  const data = "0x0f4d576c" + "0".repeat(64 * 5);

  it("a definite JSON-RPC rejection returns the reserved nonce and releases the ledger claim", async () => {
    const { keyHex, eoa } = keyMaterial();
    const raws: string[] = [];
    let sendAttempts = 0;
    const sender = new RpcLegacySender({
      rpcUrl: "https://rpc.test",
      expectedChainId: 11155111,
      eoaAddress: eoa,
      keyHex,
      sleep: async () => {},
      fetchImpl: rpcFetch((method, params) => {
        if (method === "eth_chainId") return { result: "0xaa36a7" };
        if (method === "eth_gasPrice") return { result: "0x77359400" };
        if (method === "eth_getTransactionCount") return { result: "0x0" };
        if (method === "eth_sendRawTransaction") {
          sendAttempts++;
          raws.push(String(params[0]));
          if (sendAttempts === 1) return { error: { code: -32000, message: "nonce too low" } };
          return { result: bytesToHex(keccak_256(hexToBytes(String(params[0])))) };
        }
        if (method === "eth_getTransactionReceipt") return { result: { status: "0x1" } };
        throw new Error(`unexpected rpc ${method}`);
      }),
    });

    // Sender level: the rejection is plain (not BroadcastUncertainError) and the
    // next send reuses the SAME nonce -> byte-identical raw tx.
    const caught = await sender.send(to, data).catch((e) => e);
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(BroadcastUncertainError);
    expect((caught as Error).message).toMatch(/nonce too low/);
    await expect(sender.send(to, data)).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    expect(raws).toHaveLength(2);
    expect(raws[0]).toBe(raws[1]);

    // Pipeline level: the claim is released, so the day is retryable and commits.
    // Reset the fake provider's attempt counter so the pipeline's first send is
    // rejected definitively and its retry succeeds (the nonce value itself is
    // irrelevant to the claim assertion).
    sendAttempts = 0;
    const custody = new LocalDevCustody();
    const store = new SignalStore((t, d, s) => custody.cellToken(t, d, s));
    const dayId = 20_000;
    await store.record(
      { v: 1, sentiment: "POSITIVE", dayId, contributorToken: "tok_m3h2_definite" },
      dayId * MS_PER_DAY + 12 * 3_600_000,
    );
    const submitter: ChainSubmitter = {
      name: "rpc-definite-test-submitter",
      async submitRecordBatch(batch: RecordBatch): Promise<RecordBatch> {
        await sender.send(to, data);
        return batch;
      },
    };
    const ledger = new MemoryPublicationLedger();
    const pipeline = new PublicationPipeline(store, custody, submitter, { kThreshold: 1, delayMs: 0, ledger });
    const firstErr = await pipeline.publishDay(dayId, publishableAt(dayId) + 1).catch((e) => e);
    expect(firstErr).not.toBeInstanceOf(BroadcastUncertainError);
    expect((firstErr as Error).message).toMatch(/nonce too low/);
    // A retry is NOT AlreadyPublished and commits: the ledger claim was released.
    const artifact = await pipeline.publishDay(dayId, publishableAt(dayId) + 1);
    expect(artifact.generatedForDay).toBe(dayId);
    expect(artifact.chain.recordBatch).not.toBeNull();
  });

  it("an uncertain failure keeps the reserved nonce and the ledger claim", async () => {
    const { keyHex, eoa } = keyMaterial();
    const raws: string[] = [];
    let sendAttempts = 0;
    const sender = new RpcLegacySender({
      rpcUrl: "https://rpc.test",
      expectedChainId: 11155111,
      eoaAddress: eoa,
      keyHex,
      sleep: async () => {},
      fetchImpl: rpcFetch((method, params) => {
        if (method === "eth_chainId") return { result: "0xaa36a7" };
        if (method === "eth_gasPrice") return { result: "0x77359400" };
        if (method === "eth_getTransactionCount") return { result: "0x0" };
        if (method === "eth_sendRawTransaction") {
          sendAttempts++;
          raws.push(String(params[0]));
          if (sendAttempts === 1) return { error: { code: -32003, message: "transaction timeout" } };
          return { result: bytesToHex(keccak_256(hexToBytes(String(params[0])))) };
        }
        if (method === "eth_getTransactionReceipt") return { result: { status: "0x1" } };
        throw new Error(`unexpected rpc ${method}`);
      }),
    });

    // Classifier discrimination (dynamic import keeps the rest of the file
    // loadable on the pre-fix tree, where this export does not exist).
    const mod = (await import("../src/chainrpc.ts")) as unknown as {
      classifyBroadcastFailure?: (e: unknown) => "definite" | "uncertain";
      JsonRpcError?: new (method: string, error: { code?: unknown; message?: unknown }) => Error;
    };
    expect(typeof mod.classifyBroadcastFailure).toBe("function");
    expect(typeof mod.JsonRpcError).toBe("function");
    const Ctor = mod.JsonRpcError!;
    expect(mod.classifyBroadcastFailure!(new Ctor("eth_sendRawTransaction", { code: -32003, message: "transaction timeout" }))).toBe("uncertain");
    expect(mod.classifyBroadcastFailure!(new Ctor("eth_sendRawTransaction", { code: -32000, message: "nonce too low" }))).toBe("definite");
    expect(mod.classifyBroadcastFailure!(new Ctor("eth_sendRawTransaction", { code: -32602, message: "invalid params" }))).toBe("definite");
    expect(mod.classifyBroadcastFailure!(new Ctor("eth_sendRawTransaction", { code: -32000, message: "already known" }))).toBe("uncertain");

    // Sender level: uncertain keeps the reserved nonce -> the retry uses nonce 1.
    const firstErr = await sender.send(to, data).catch((e) => e);
    expect(firstErr).toBeInstanceOf(BroadcastUncertainError);
    await expect(sender.send(to, data)).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    expect(raws).toHaveLength(2);
    expect(raws[0]).not.toBe(raws[1]);

    // Pipeline level: the claim is kept, so the day is NOT retryable.
    const custody = new LocalDevCustody();
    const store = new SignalStore((t, d, s) => custody.cellToken(t, d, s));
    const dayId = 20_001;
    await store.record(
      { v: 1, sentiment: "NEGATIVE", dayId, contributorToken: "tok_m3h2_uncertain" },
      dayId * MS_PER_DAY + 12 * 3_600_000,
    );
    const submitter: ChainSubmitter = {
      name: "rpc-uncertain-test-submitter",
      async submitRecordBatch(_batch: RecordBatch): Promise<RecordBatch> {
        throw new BroadcastUncertainError("broadcast outcome unknown (test)");
      },
    };
    const ledger = new MemoryPublicationLedger();
    const pipeline = new PublicationPipeline(store, custody, submitter, { kThreshold: 1, delayMs: 0, ledger });
    await expect(pipeline.publishDay(dayId, publishableAt(dayId) + 1)).rejects.toBeInstanceOf(BroadcastUncertainError);
    await expect(pipeline.publishDay(dayId, publishableAt(dayId) + 1)).rejects.toThrow(/already published/);
  });
});
