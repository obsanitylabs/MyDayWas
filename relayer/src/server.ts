/**
 * MyDayWas signal relayer HTTP server (staging).
 *
 * Transport security: submissions arrive over TLS. In production TLS terminates
 * at the load balancer / reverse proxy in front of this process; the config must
 * enforce https-only. This file never logs payload content (see src/log.ts).
 *
 * Endpoints:
 *   POST /v1/signals        ingest one coarsened submission (see types.ts)
 *   POST /v1/publish         publish one UTC day (server-enforced T+24h,
 *                            below-k suppression, one recordBatch per day,
 *                            signed reconciliation artifact; replay-guarded —
 *                            an already-published dayId is rejected 409)
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { parseSubmission, RejectedSubmission, type SignalSubmission } from "./types.ts";
import { SignalStore, type SignalStoreCore } from "./store.ts";
import { Alerts, log, type Alert } from "./log.ts";
import { AlreadyPublished, NotYetPublishable, PublicationPipeline } from "./pipeline.ts";
import { DryRunSubmitter, type ChainSubmitter } from "./chain.ts";
import { MemoryPublicationLedger, type PublicationLedger } from "./ledger.ts";
import { DurableSignalStore, SqlitePublicationLedger } from "./durable.ts";
import type { KeyCustody } from "./keycustody.ts";
import { SybilEarlyWarning } from "./sybil.ts";

export interface RelayerConfig {
  kThreshold?: number;
  delayMs?: number;
  chain?: ChainSubmitter;
  /** Per-day publication ledger (F2); defaults to the process-local staging map. */
  ledger?: PublicationLedger;
  /** Signal store (F3); defaults to the process-local staging store. */
  store?: SignalStoreCore;
  /**
   * OBS-87 alert sink: receives every raised alert ({reason, raisedDay, detail}
   * only — no payload data). Production forwards to SNS/PagerDuty; staging
   * default is no-op (alerts stay queryable via `alerts.list()`).
   */
  alertSink?: (a: Alert) => void;
  /**
   * OBS-87 rate shaping on POST /v1/signals: per-IP token bucket, requests
   * per minute. Undefined = shaping off (staging/tests); production config
   * sets it explicitly (runbook default: 60).
   */
  ratePerMin?: number;
  /**
   * OBS-87 TLS-only edge: when true, reject any request whose
   * x-forwarded-proto is not https (TLS terminates at the LB in front of
   * this process). Staging default false.
   */
  requireTls?: boolean;
}

/** Per-IP token bucket (OBS-87 rate shaping on /v1/signals). */
class RateShaper {
  private readonly buckets = new Map<string, { tokens: number; lastMs: number }>();
  private readonly perMin: number;
  constructor(perMin: number) {
    this.perMin = perMin;
  }
  /** Returns true iff one token was available and consumed. */
  allow(ip: string, nowMs: number): boolean {
    const refillPerMs = this.perMin / 60_000;
    const b = this.buckets.get(ip) ?? { tokens: this.perMin, lastMs: nowMs };
    b.tokens = Math.min(this.perMin, b.tokens + (nowMs - b.lastMs) * refillPerMs);
    b.lastMs = nowMs;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(ip, b);
    return ok;
  }
}

export function createSignalServer(custody: KeyCustody, cfg: RelayerConfig = {}): {
  server: Server;
  store: SignalStoreCore;
  pipeline: PublicationPipeline;
  alerts: Alerts;
  ledger: PublicationLedger;
} {
  const alerts = new Alerts(cfg.alertSink);
  // One ledger per relayer instance (per-day + per-instance scoping, F2/F3 design).
  const ledger = cfg.ledger ?? new MemoryPublicationLedger();
  const store = cfg.store ?? new SignalStore((t, d, s) => custody.cellToken(t, d, s));
  const pipeline = new PublicationPipeline(store, custody, cfg.chain ?? new DryRunSubmitter(), {
    kThreshold: cfg.kThreshold,
    delayMs: cfg.delayMs,
    ledger,
  });
  // OBS-87: Sybil early warning on day-over-day new-account counts.
  const sybil = new SybilEarlyWarning(() => store.newAccountCounts(), alerts);
  // OBS-87: rate shaping on /v1/signals (off unless ratePerMin is set).
  const shaper = cfg.ratePerMin !== undefined ? new RateShaper(cfg.ratePerMin) : undefined;

  async function readJson(req: IncomingMessage, limit = 8_192): Promise<unknown> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw new RejectedSubmission("malformed_json");
      chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  const server = createServer((req, res) => {
    void (async () => {
      const respond = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST" || ![ "/v1/signals", "/v1/publish" ].includes(req.url ?? "")) {
        return respond(404, { error: "not_found" });
      }
      // OBS-87: TLS-only edge in production (TLS terminates at the LB).
      if (cfg.requireTls && req.headers["x-forwarded-proto"] !== "https") {
        return respond(426, { error: "tls_required" });
      }
      try {
        if (req.url === "/v1/signals") {
          if (shaper) {
            const ip =
              req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ??
              req.socket.remoteAddress ??
              "unknown";
            if (!shaper.allow(ip, Date.now())) {
              alerts.raise("rate_limited", "per-IP rate shaping on /v1/signals rejected a request", Date.now());
              return respond(429, { error: "rate_limited" });
            }
          }
          const raw = await readJson(req);
          let submission: SignalSubmission;
          try {
            const parsed = parseSubmission(raw, Date.now());
            // Payload minimization: unexpected fields are content-bearing by
            // default — REJECT AND ALERT, never log the offending fields.
            if (parsed.unexpected.length > 0) {
              alerts.raise("unexpected_submission_fields", "submission carried fields outside the coarsened tuple; rejected without logging", Date.now());
              return respond(400, { error: "unexpected_fields" });
            }
            submission = parsed.submission;
          } catch (e) {
            if (e instanceof RejectedSubmission) {
              // reject-and-alert on anything content-bearing or malformed
              if (e.reason === "dayId_out_of_window") {
                alerts.raise("dayId_out_of_window", "submission outside ingest window rejected", Date.now());
              } else {
                alerts.raise("malformed_submission", `submission rejected: ${e.reason}`, Date.now());
              }
              return respond(400, { error: e.reason });
            }
            throw e;
          }
          try {
            await store.record(submission, Date.now());
          } catch (e) {
            if (e instanceof RejectedSubmission && e.reason === "new_account_rate_limited") {
              alerts.raise("new_account_rate_limited", "new-account rate limit reached; submission rejected", Date.now());
              return respond(429, { error: e.reason });
            }
            throw e;
          }
          // OBS-87: Sybil early warning on day-over-day new-account anomalies.
          sybil.check(Date.now());
          log("ingest", "signal accepted", submission.dayId);
          return respond(202, { ok: true });
        }
        // POST /v1/publish { "dayId": N }
        const raw = (await readJson(req)) as Record<string, unknown>;
        const dayId = raw?.dayId;
        if (typeof dayId !== "number" || !Number.isInteger(dayId) || dayId < 0) {
          return respond(400, { error: "bad_dayId" });
        }
        try {
          const artifact = await pipeline.publishDay(dayId, Date.now());
          return respond(200, artifact);
        } catch (e) {
          if (e instanceof NotYetPublishable) {
            return respond(409, { error: "not_yet_publishable", dayId });
          }
          if (e instanceof AlreadyPublished) {
            // F2: replay of an already-published day — rejected before any chain effect.
            log("server", "publish replay rejected", dayId);
            return respond(409, { error: "already_published", dayId });
          }
          throw e;
        }
      } catch (e) {
        log("server", "request failed (no payload details)");
        return respond(500, { error: "internal" });
      }
    })();
  });
  return { server, store, pipeline, alerts, ledger };
}

/** CLI entrypoint (staging + production config switches). */
if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const { LocalDevCustody, CustodyUsageMonitor } = await import("./keycustody.ts");
  const localCustody = new LocalDevCustody();
  // F3 (OBS-228): RELAYER_DB_PATH switches the relayer onto the durable
  // SQLite backend (restart- + multi-instance-safe ledger and store, shared
  // atomic new-account counter). Unset = process-local staging (DryRun-safe).
  const dbPath = process.env.RELAYER_DB_PATH;
  // OBS-87: alert-sink wiring. RELAYER_ALERT_WEBHOOK forwards alert reason
  // codes + day resolution (never payload data) to the ops webhook (e.g. an
  // SNS/PagerDuty ingress). Unset = alerts stay in-process only.
  const webhook = process.env.RELAYER_ALERT_WEBHOOK;
  const alertSink = webhook
    ? (a: Alert) => {
        void fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Alert reason codes + day resolution only — no payload data.
          body: JSON.stringify({ reason: a.reason, raisedDay: a.raisedDay, detail: a.detail }),
        }).catch(() => {
          /* alert delivery is best-effort; alerts remain queryable in-process */
        });
      }
    : undefined;
  // OBS-87: usage-anomaly monitoring on key usage (custody_usage_anomaly).
  // Shares the production alert sink so custody anomalies reach ops too.
  const custody = new CustodyUsageMonitor(localCustody, new Alerts(alertSink));
  const cfg: RelayerConfig = {
    ...(dbPath
      ? {
          ledger: new SqlitePublicationLedger(dbPath),
          store: new DurableSignalStore(dbPath, (t, d, s) => custody.cellToken(t, d, s)),
        }
      : {}),
    // OBS-87: production config switches (all optional; staging defaults off).
    ratePerMin: process.env.RELAYER_RATE_PER_MIN !== undefined
      ? Number(process.env.RELAYER_RATE_PER_MIN)
      : undefined,
    requireTls: process.env.RELAYER_REQUIRE_TLS === "1",
    alertSink,
  };
  const { server } = createSignalServer(custody, cfg);
  const port = Number(process.env.RELAYER_PORT ?? 8081);
  server.listen(port, () => {
    log(
      "server",
      dbPath
        ? "signal relayer listening (durable F3 ledger/store; chain submitter is dry-run pending Chief Auditor review)"
        : "signal relayer listening (staging; chain submitter is dry-run pending Chief Auditor review)",
    );
  });
}