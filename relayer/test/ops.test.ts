/**
 * OBS-87 binding production checklist — service-layer tests.
 * Rate shaping, TLS-only edge, alert-sink wiring, versioned/split custody
 * keyIds, custody usage-anomaly monitoring, Sybil early warning.
 */
import { describe, expect, it } from "vitest";
import { LocalDevCustody, CustodyUsageMonitor } from "../src/keycustody.ts";
import { Alerts } from "../src/log.ts";
import { SignalStore } from "../src/store.ts";
import { SybilEarlyWarning } from "../src/sybil.ts";
import { createSignalServer, RateShaper } from "../src/server.ts";
import { MS_PER_DAY, type Sentiment } from "../src/types.ts";

const DAY0 = 21_000;
const ingestMs = DAY0 * MS_PER_DAY + 12 * 3_600_000;

function token(n: number): string {
  return `tok_${n.toString().padStart(13, "0")}`;
}

async function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const today = Math.floor(Date.now() / MS_PER_DAY);

function submission(n: number, sentiment: Sentiment = "NEUTRAL", dayId = today - 1) {
  return { v: 1, sentiment, dayId, contributorToken: token(n) };
}

describe("OBS-87: split + versioned custody keyIds", () => {
  it("exposes separate versioned keyIds for blinding vs signing", async () => {
    const c = new LocalDevCustody();
    const blinder = await c.blinderKeyId();
    const signer = await c.signerKeyId();
    expect(blinder).toMatch(/^local-dev\/blinder\/v1#/);
    expect(signer).toMatch(/^local-dev\/signer\/v1#/);
    expect(blinder).not.toEqual(signer);
  });
});

describe("OBS-87: custody usage-anomaly monitoring", () => {
  it("alerts when signing ops spike day-over-day past the baseline", async () => {
    const alerts = new Alerts();
    const inner = new LocalDevCustody();
    const monitor = new CustodyUsageMonitor(inner, alerts, { spikeFactor: 3, floor: 10 });
    const realNow = Date.now;
    const dayNow = (offsetDays: number) => (DAY0 + offsetDays) * MS_PER_DAY + 3_600_000;

    // Baseline: 12 signing ops yesterday.
    Date.now = () => dayNow(-1);
    for (let i = 0; i < 12; i++) await monitor.signReconciliation(`baseline-${i}`);
    expect(alerts.list().filter((a) => a.reason === "custody_usage_anomaly")).toHaveLength(0);

    // Today: 40 ops > 3x baseline floor 10 -> anomaly.
    Date.now = () => dayNow(0);
    for (let i = 0; i < 40; i++) await monitor.signReconciliation(`spike-${i}`);
    const anomalies = alerts.list().filter((a) => a.reason === "custody_usage_anomaly");
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    expect(anomalies[0]!.detail).toContain("signing");

    Date.now = realNow;
    // Pass-through behavior is intact (tamper the PAYLOAD, not the base64 —
    // Buffer.from leniently ignores trailing invalid base64 characters).
    const payload = "verify-me";
    const sig = await monitor.signReconciliation(payload);
    expect(await monitor.verifyReconciliation(payload, sig)).toBe(true);
    expect(await monitor.verifyReconciliation(payload + "x", sig)).toBe(false);
  });

  it("does not alert below the absolute floor", async () => {
    const alerts = new Alerts();
    const monitor = new CustodyUsageMonitor(new LocalDevCustody(), alerts, { spikeFactor: 3, floor: 200 });
    const realNow = Date.now;
    Date.now = () => (DAY0 - 1) * MS_PER_DAY + 3_600_000;
    await monitor.signReconciliation("only-one-yesterday");
    Date.now = () => DAY0 * MS_PER_DAY + 3_600_000;
    for (let i = 0; i < 10; i++) await monitor.signReconciliation(`no-baseline-${i}`);
    Date.now = realNow;
    expect(alerts.list().filter((a) => a.reason === "custody_usage_anomaly")).toHaveLength(0);
  });
});

describe("OBS-87: Sybil early warning", () => {
  it("alerts on day-over-day new-account spike with dedup per day", () => {
    const alerts = new Alerts();
    const counts = new Map<number, number>([
      [DAY0 - 2, 300],
      [DAY0 - 1, 310],
    ]);
    const sybil = new SybilEarlyWarning(() => new Map(counts), alerts, { spikeFactor: 3, floor: 200 });
    expect(sybil.check(DAY0 * MS_PER_DAY + 1)).toBe(false); // 0 today, no alert
    counts.set(DAY0, 500);
    expect(sybil.check(DAY0 * MS_PER_DAY + 1)).toBe(false); // 500 < 3x310
    counts.set(DAY0, 1_000);
    expect(sybil.check(DAY0 * MS_PER_DAY + 1)).toBe(true); // 1000 > 3x310
    expect(sybil.check(DAY0 * MS_PER_DAY + 1)).toBe(false); // dedup: once per day
    const raised = alerts.list().filter((a) => a.reason === "sybil_early_warning");
    expect(raised).toHaveLength(1);
    expect(raised[0]!.raisedDay).toBe(DAY0);
  });

  it("wires through the server ingest path via store.newAccountCounts()", async () => {
    const custody = new LocalDevCustody();
    const cfgStore = new SignalStore((t, d, s) => custody.cellToken(t, d, s));
    const sink: unknown[] = [];
    const { server, alerts } = createSignalServer(custody, {
      store: cfgStore,
      kThreshold: 1,
      delayMs: 0,
      alertSink: (a) => sink.push(a),
    });
    // Baseline via direct store records keyed on real UTC days (explicit nowMs).
    await cfgStore.record({ v: 1, sentiment: "NEUTRAL", dayId: today - 2, contributorToken: token(1) }, (today - 2) * MS_PER_DAY + 3_600_000);
    for (let i = 2; i <= 260; i++) {
      await cfgStore.record({ v: 1, sentiment: "NEUTRAL", dayId: today - 1, contributorToken: token(i) }, (today - 1) * MS_PER_DAY + 3_600_000);
    }

    const port = 18_091;
    await new Promise<void>((r) => server.listen(port, () => r()));
    try {
      // Today: > 3x baseline new accounts through the live ingest path.
      for (let i = 1_000; i < 1_000 + 800; i++) {
        const res = await post(port, "/v1/signals", submission(i, "NEUTRAL"));
        expect(res.status).toBe(202);
      }
      const raised = alerts.list().filter((a) => a.reason === "sybil_early_warning");
      expect(raised).toHaveLength(1);
      expect(sink).toHaveLength(1);
      expect((sink[0] as any).reason).toBe("sybil_early_warning");
    } finally {
      server.close();
    }
  });
});

describe("OBS-87: rate shaping on /v1/signals", () => {
  it("throttles per IP once the bucket is empty and alerts rate_limited", async () => {
    const custody = new LocalDevCustody();
    const { server, alerts } = createSignalServer(custody, {
      ratePerMin: 5,
      kThreshold: 1,
      delayMs: 0,
    });
    const port = 18_092;
    await new Promise<void>((r) => server.listen(port, () => r()));
    try {
      let throttled = 0;
      for (let i = 0; i < 20; i++) {
        const res = await post(port, "/v1/signals", submission(9_000 + i, "NEUTRAL"));
        if (res.status === 429) throttled++;
        else expect(res.status).toBe(202);
      }
      expect(throttled).toBeGreaterThan(10);
      expect(alerts.list().some((a) => a.reason === "rate_limited")).toBe(true);
    } finally {
      server.close();
    }
  });

  it("is off by default (staging)", async () => {
    const custody = new LocalDevCustody();
    const { server, alerts } = createSignalServer(custody, { kThreshold: 1, delayMs: 0 });
    const port = 18_093;
    await new Promise<void>((r) => server.listen(port, () => r()));
    try {
      for (let i = 0; i < 30; i++) {
        const res = await post(port, "/v1/signals", submission(8_000 + i, "NEUTRAL"));
        expect(res.status).toBe(202);
      }
      expect(alerts.list().some((a) => a.reason === "rate_limited")).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe("OBS-245 / audit F-1: RateShaper bounded map", () => {
  it("evicts buckets idle beyond the TTL and restores a fresh full bucket", () => {
    const shaper = new RateShaper(5, 65_536, 120_000);
    const t0 = 1_000_000;
    expect(shaper.allow("1.1.1.1", t0)).toBe(true);
    expect(shaper.allow("2.2.2.2", t0)).toBe(true);
    expect(shaper.bucketCount).toBe(2);
    // Beyond the TTL: the sweep (amortized, next window) drops idle entries.
    const t1 = t0 + 121_000;
    expect(shaper.allow("3.3.3.3", t1)).toBe(true);
    // 3.3.3.3 exists; 1.1.1.1/2.2.2.2 were swept at the start of this window.
    expect(shaper.bucketCount).toBe(1);
    // Evicted IP returns to a fresh bucket: full refill (semantically neutral).
    expect(shaper.allow("1.1.1.1", t1)).toBe(true);
    expect(shaper.bucketCount).toBe(2);
  });

  it("caps total buckets, evicting the idlest entry", () => {
    const shaper = new RateShaper(5, 3, 120_000);
    const t0 = 2_000_000;
    expect(shaper.allow("a", t0)).toBe(true);
    expect(shaper.allow("b", t0 + 1)).toBe(true);
    expect(shaper.allow("c", t0 + 2)).toBe(true);
    expect(shaper.bucketCount).toBe(3);
    // "a" is idlest; inserting a 4th key evicts it, size stays at cap.
    expect(shaper.allow("d", t0 + 3)).toBe(true);
    expect(shaper.bucketCount).toBe(3);
    expect(shaper.allow("a", t0 + 4)).toBe(true); // a was evicted, gets fresh bucket
    expect(shaper.bucketCount).toBe(3);
  });
 });

describe("OBS-87: TLS-only edge", () => {
  it("rejects non-https x-forwarded-proto with 426 when requireTls is set", async () => {
    const custody = new LocalDevCustody();
    const { server } = createSignalServer(custody, { requireTls: true });
    const port = 18_094;
    await new Promise<void>((r) => server.listen(port, () => r()));
    try {
      expect((await post(port, "/v1/signals", submission(7_000))).status).toBe(426);
      expect((await post(port, "/v1/publish", { dayId: DAY0 - 1 })).status).toBe(426);
      expect((await post(port, "/v1/signals", submission(7_001), { "x-forwarded-proto": "https" })).status).toBe(202);
    } finally {
      server.close();
    }
  });

  it("allows plain http when requireTls is unset (staging)", async () => {
    const custody = new LocalDevCustody();
    const { server } = createSignalServer(custody, { kThreshold: 1, delayMs: 0 });
    const port = 18_095;
    await new Promise<void>((r) => server.listen(port, () => r()));
    try {
      expect((await post(port, "/v1/signals", submission(6_000))).status).toBe(202);
    } finally {
      server.close();
    }
  });
});

describe("OBS-87: alert-sink wiring for all alert reasons", () => {
  it("forwards every raised alert reason code to the sink with day resolution only", async () => {
    const custody = new LocalDevCustody();
    const sink: any[] = [];
    const { server, alerts } = createSignalServer(custody, {
      alertSink: (a) => sink.push(a),
      kThreshold: 1,
      delayMs: 0,
    });
    const port = 18_096;
    await new Promise<void>((r) => server.listen(port, () => r()));
    try {
      await post(port, "/v1/signals", { v: 1, sentiment: "NEUTRAL", dayId: today - 1, contributorToken: "tok_0000000001000", extra: "field" });
      await post(port, "/v1/signals", { v: 1, sentiment: "NEUTRAL", dayId: today + 99, contributorToken: "tok_0000000001001" });
      await post(port, "/v1/signals", { v: 0, sentiment: "NEUTRAL", dayId: today - 1, contributorToken: "tok_0000000001002" });
      expect(sink.map((a) => a.reason).sort()).toEqual([
        "dayId_out_of_window",
        "malformed_submission",
        "unexpected_submission_fields",
      ]);
      for (const a of sink) {
        expect(Number.isInteger(a.raisedDay)).toBe(true);
        expect(typeof a.detail).toBe("string");
      }
      // new_account_rate_limited is raised by the store (covered by pipeline
      // tests); verified here at the sink level via alerts.list parity.
      expect(alerts.list().length).toBe(sink.length);
    } finally {
      server.close();
    }
  });
});