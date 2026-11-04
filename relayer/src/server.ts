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
 *                            an already-published dayId is rejected 409).
 *                            H1 (OBS-760): operator-authenticated via the
 *                            shared-secret header x-relayer-auth (constant-time
 *                            compare, 401 otherwise), requires
 *                            content-type: application/json (415 otherwise) and
 *                            is per-IP rate shaped like /v1/signals.
 *   GET  /healthz           readiness for the production LB/uptime monitor
 *                            (OBS-264 + OBS-313 D2): DB reachable, custody
 *                            configured + keyIds present, submitter mode
 *                            (dry-run/real), build revision + uptime. Static
 *                            + config data only — no payload data, no
 *                            secrets; TLS-exempt so LB probes over plain
 *                            local HTTP succeed.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { parseSubmission, RejectedSubmission, type SignalSubmission } from "./types.ts";
import { SignalStore, type SignalStoreCore } from "./store.ts";
import { Alerts, log, type Alert } from "./log.ts";
import { AlreadyPublished, NotYetPublishable, PublicationPipeline } from "./pipeline.ts";
import { DryRunSubmitter, type ChainSubmitter } from "./chain.ts";
import { MemoryPublicationLedger, type PublicationLedger } from "./ledger.ts";
import { DurableSignalStore, SqlitePublicationLedger } from "./durable.ts";
import type { KeyCustody } from "./keycustody.ts";
import { ReconciliationMonitor } from "./monitor.ts";
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
   * M1 (OBS-760): trusted client-IP header the edge sets (e.g. Fly-Client-IP).
   * When unset, rate shaping falls back to the TRUSTED LAST hop of
   * `x-forwarded-for` (never the attacker-controlled leftmost value), then the
   * socket address.
   */
  clientIpHeader?: string;
  /**
   * H1 (OBS-760): operator authentication on POST /v1/publish. When set, the
   * request MUST carry `headerName` (default `x-relayer-auth`) equal to `secret`;
   * the comparison is constant-time and a missing/invalid value is 401. The
   * secret is supplied by the environment only (never committed). Undefined
   * (staging) leaves /v1/publish unauthenticated — production (the durable
   * profile) refuses to start without it (see the CLI guard).
   */
  publishAuth?: { secret: string; headerName?: string };
  /**
   * OBS-87 TLS-only edge: when true, reject any request whose
   * x-forwarded-proto is not https (TLS terminates at the LB in front of
   * this process). Staging default false.
   */
  requireTls?: boolean;
  /**
   * OBS-313 D2: readiness data for GET /healthz. No secrets, no payload data.
   * `dbProbe` is a cheap liveness query against the durable backend.
   */
  health?: {
    buildRevision?: string;
    dbBackend?: string;
    dbProbe?: () => boolean;
    startedAtMs?: number;
  };
  /**
   * OBS-235 condition 1 / OBS-313 D8: when set, every published artifact runs
   * through the reconciliation monitor (verifyReconciliation + internal diff +
   * on-chain `BatchRecorded` diff via `recorded`) wired to the alert sink.
   */
  reconciliation?: {
    recorded?: (dayId: number) => Promise<{ dayId: number; deltas: [number, number, number] } | null>;
  };
}

/** H1 (OBS-760): default request header carrying the /v1/publish operator secret. */
export const PUBLISH_AUTH_HEADER = "x-relayer-auth";

/**
 * H1 (OBS-760): constant-time shared-secret comparison. Both inputs are
 * SHA-256 hashed first so the compare is over fixed-length digests and cannot
 * leak length via timing.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * M1 (OBS-760): resolve the client IP used for rate shaping from TRUSTED
 * sources only. Order: the platform-set client-IP header, then the LAST hop of
 * `x-forwarded-for` (appended by our own proxy — the leftmost value is
 * attacker-controlled), then the socket address.
 */
export function clientIp(req: IncomingMessage, platformHeader?: string): string {
  if (platformHeader) {
    const v = req.headers[platformHeader];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.trim() !== "") return s.trim();
  }
  const xff = req.headers["x-forwarded-for"];
  const chain = (Array.isArray(xff) ? xff.join(",") : xff ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (chain.length > 0) return chain[chain.length - 1]!;
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Per-IP token bucket (OBS-87 rate shaping on /v1/signals and /v1/publish).
 *
 * OBS-245 / audit F-1: the bucket map is bounded two ways so a long-lived
 * process cannot grow it without limit when production shaping is on
 * (the key is the attacker-controllable x-forwarded-for value):
 *   - TTL eviction: an entry idle >= idleTtlMs is dropped. A bucket refills
 *     to full within 60s, so with idleTtlMs >= 60_000 an evicted entry is
 *     semantically identical to a fresh one (tokens clamp at perMin).
 *     Sweeps are amortized (at most one per idleTtlMs window).
 *   - Cap eviction: if size would exceed maxBuckets, the least-recently-used
 *     entry is evicted in O(1) (M1/OBS-760: a Map keeps insertion order and
 *     every touch re-inserts at the tail, so the head key is the LRU entry;
 *     this replaces the old O(n) idlest-entry scan).
 */
export class RateShaper {
  private readonly buckets = new Map<string, { tokens: number; lastMs: number }>();
  private readonly perMin: number;
  private readonly maxBuckets: number;
  private readonly idleTtlMs: number;
  private nextSweepMs = 0;
  // OBS-363 D5: plain fields assigned in the constructor body — NO TypeScript
  // parameter properties anywhere in the entrypoint module graph. Node's
  // strip-only TypeScript support (default on node >= 23.6 / >= 22.18) rejects
  // parameter properties at boot, which crashed the production image
  // (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
  constructor(perMin: number, maxBuckets = 65_536, idleTtlMs = 120_000) {
    this.perMin = perMin;
    this.maxBuckets = maxBuckets;
    this.idleTtlMs = idleTtlMs;
  }
  /** Number of tracked buckets (exposed for tests/ops visibility). */
  get bucketCount(): number {
    return this.buckets.size;
  }
  /** Returns true iff one token was available and consumed. */
  allow(ip: string, nowMs: number): boolean {
    const refillPerMs = this.perMin / 60_000;
    if (nowMs >= this.nextSweepMs) {
      this.nextSweepMs = nowMs + this.idleTtlMs;
      for (const [key, b] of this.buckets) {
        if (nowMs - b.lastMs >= this.idleTtlMs) this.buckets.delete(key);
      }
    }
    let b = this.buckets.get(ip);
    if (!b) {
      if (this.buckets.size >= this.maxBuckets) {
        // M1: O(1) LRU eviction — the head of the Map is the least-recently-used
        // key (every touch re-inserts the key at the tail below).
        const lruKey = this.buckets.keys().next().value;
        if (lruKey !== undefined) this.buckets.delete(lruKey);
      }
      b = { tokens: this.perMin, lastMs: nowMs };
    } else {
      // Move the key to the most-recently-used position and refill it.
      this.buckets.delete(ip);
      b.tokens = Math.min(this.perMin, b.tokens + (nowMs - b.lastMs) * refillPerMs);
      b.lastMs = nowMs;
    }
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
  // OBS-235 condition 1 / OBS-313 D8: reconciliation monitor on the shared
  // alerts instance, so every mismatch reaches the alert sink ({reason,
  // raisedDay, detail} only).
  const reconciliation =
    cfg.reconciliation !== undefined ? new ReconciliationMonitor(custody, alerts, cfg.reconciliation) : undefined;
  const startedAtMs = cfg.health?.startedAtMs ?? Date.now();
  // OBS-87: rate shaping on /v1/signals (off unless ratePerMin is set).
  const shaper = cfg.ratePerMin !== undefined ? new RateShaper(cfg.ratePerMin) : undefined;
  // OBS-549: browser CORS allow-list. Read ONCE at construction, never per
  // request. Default empty = closed. Exact-origin match only: no wildcard and
  // no blind reflection of the request Origin.
  const allowedOrigins = (process.env.RELAYER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

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

  /**
   * OBS-363 D1: readJson sits INSIDE the reject-and-alert path. An oversized
   * body (size guard) and malformed JSON (JSON.parse SyntaxError) are
   * content-bearing rejections on the privacy control path: respond 413/400
   * respectively and raise `malformed_submission` — never a silent 500.
   */
  async function readJsonGuarded(
    req: IncomingMessage,
  ): Promise<{ ok: true; value: unknown } | { ok: false; code: number; error: string }> {
    try {
      return { ok: true, value: await readJson(req) };
    } catch (e) {
      if (e instanceof RejectedSubmission) {
        // Only the size guard throws this before parse: body over the limit.
        return { ok: false, code: 413, error: "payload_too_large" };
      }
      if (e instanceof SyntaxError) {
        return { ok: false, code: 400, error: "malformed_json" };
      }
      throw e;
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      // OBS-549: CORS response headers. Access-Control-Allow-Origin is
      // emitted ONLY when the request Origin exactly matches an allow-listed
      // origin (never a comma-list, never an empty value, never reflected).
      // Vary: Origin is always set, so a cache cannot serve one origin's
      // header to another. Every response on the two POST paths - including
      // the error branches - carries these headers, so the browser can read
      // the error body.
      const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
      const originAllowed = requestOrigin !== "" && allowedOrigins.includes(requestOrigin);
      const corsHeaders = (): Record<string, string> => ({
        vary: "Origin",
        ...(originAllowed ? { "access-control-allow-origin": requestOrigin } : {}),
      });
      const respond = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json", ...corsHeaders() });
        res.end(JSON.stringify(body));
      };
      // OBS-264 + OBS-313 D2: production readiness probe. Exempt from
      // requireTls (LB probes plain local HTTP without x-forwarded-proto)
      // and from rate shaping. Config + readiness data only — no payload
      // data, no secrets (keyIds are versioned public fingerprints).
      if (req.method === "GET" && req.url === "/healthz") {
        let dbReachable = true;
        if (cfg.health?.dbProbe) {
          try {
            dbReachable = cfg.health.dbProbe();
          } catch {
            dbReachable = false;
          }
        }
        return respond(200, {
          ok: true,
          service: "mydaywas-relayer",
          buildRevision: cfg.health?.buildRevision ?? "unversioned",
          uptimeSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
          submitter: (cfg.chain ?? new DryRunSubmitter()).name,
          custody: {
            provider: custody.provider,
            blinderKeyId: await custody.blinderKeyId(),
            signerKeyId: await custody.signerKeyId(),
          },
          db: {
            backend: cfg.health?.dbBackend ?? "memory",
            reachable: dbReachable,
          },
        });
      }
      // OBS-549: CORS preflight. The diary POSTs application/json, which is
      // not CORS-safelisted, so the browser sends OPTIONS before the POST.
      // TLS parity with the POST paths: a plain-HTTP preflight is rejected
      // with 426 tls_required rather than answered. 204 carries no body.
      if (req.method === "OPTIONS" && (req.url === "/v1/signals" || req.url === "/v1/publish")) {
        if (cfg.requireTls && req.headers["x-forwarded-proto"] !== "https") {
          return respond(426, { error: "tls_required" });
        }
        res.writeHead(204, {
          ...corsHeaders(),
          "access-control-allow-methods": "POST, OPTIONS",
          // H1: /v1/publish also accepts the operator auth header.
          "access-control-allow-headers":
            req.url === "/v1/publish" ? `content-type, ${PUBLISH_AUTH_HEADER}` : "content-type",
          "access-control-max-age": "600",
        });
        res.end();
        return;
      }
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
            // M1: trusted client IP; per-route bucket key.
            const ip = clientIp(req, cfg.clientIpHeader);
            if (!shaper.allow(`signals|${ip}`, Date.now())) {
              alerts.raise("rate_limited", "per-IP rate shaping on /v1/signals rejected a request", Date.now());
              return respond(429, { error: "rate_limited" });
            }
          }
          const read = await readJsonGuarded(req);
          if (!read.ok) {
            // D1: reject-and-alert on any content-bearing body problem.
            alerts.raise("malformed_submission", `body rejected: ${read.error}`, Date.now());
            return respond(read.code, { error: read.error });
          }
          let submission: SignalSubmission;
          try {
            const parsed = parseSubmission(read.value, Date.now());
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
        // POST /v1/publish { "dayId": N } — operator-authenticated (H1/OBS-760).
        // Rate shape first (protects the constant-time compare from brute force),
        // then require the shared secret, then require JSON content-type.
        if (shaper) {
          const ip = clientIp(req, cfg.clientIpHeader);
          if (!shaper.allow(`publish|${ip}`, Date.now())) {
            alerts.raise("rate_limited", "per-IP rate shaping on /v1/publish rejected a request", Date.now());
            return respond(429, { error: "rate_limited" });
          }
        }
        if (cfg.publishAuth) {
          const headerName = cfg.publishAuth.headerName ?? PUBLISH_AUTH_HEADER;
          const raw = req.headers[headerName];
          const provided = Array.isArray(raw) ? raw.join(",") : raw;
          if (typeof provided !== "string" || !secretMatches(provided, cfg.publishAuth.secret)) {
            // No alert (an unauthenticated flood must not fill the alert path);
            // a hygiene-safe line only.
            log("server", "publish request rejected: missing/invalid operator auth");
            return respond(401, { error: "unauthorized" });
          }
        }
        {
          const rawCt = req.headers["content-type"];
          const ct = Array.isArray(rawCt) ? rawCt.join(",") : rawCt ?? "";
          if (!/\bapplication\/json\b/i.test(ct)) {
            return respond(415, { error: "unsupported_media_type" });
          }
        }
        const read = await readJsonGuarded(req);
        if (!read.ok) {
          // D1: same reject-and-alert contract on the publish path.
          alerts.raise("malformed_submission", `body rejected: ${read.error}`, Date.now());
          return respond(read.code, { error: read.error });
        }
        const raw = read.value as Record<string, unknown>;
        const dayId = raw?.dayId;
        if (typeof dayId !== "number" || !Number.isInteger(dayId) || dayId < 0) {
          return respond(400, { error: "bad_dayId" });
        }
        try {
          const artifact = await pipeline.publishDay(dayId, Date.now());
          // OBS-235 condition 1 / OBS-313 D8: check every published artifact
          // (signature + internal diff + on-chain BatchRecorded diff when a
          // reader is configured). Mismatch alerts ops; the artifact itself
          // is still returned (the alert is the detection path).
          if (reconciliation) await reconciliation.check(artifact);
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

/**
 * OBS-300 (checklist §1): production-profile custody guard — fail closed.
 *
 * The durable profile (`RELAYER_DB_PATH` set) is the production profile; a
 * CISO precondition (OBS-234, checklist §1) is that production custody uses a
 * STABLE, KMS-backed blinder: an ephemeral `LocalDevCustody` blinder re-opens
 * the new-account counter on every restart and weakens the Sybil bound per
 * restart. The guard makes ephemeral material unreachable in the production
 * profile by construction — the process refuses to start rather than run it.
 *
 * `RELAYER_CUSTODY` modes:
 *  - `local-dev` (default): staging profile only; refused with `RELAYER_DB_PATH` set.
 *  - `kms`: production mode (OBS-313 D1). Requires `RELAYER_DB_PATH` +
 *    `RELAYER_KMS_PROVIDER` + `RELAYER_KMS_BLINDER_KEY_ARN` +
 *    `RELAYER_KMS_SIGNER_KEY_ARN` + `RELAYER_KMS_OPS_MODULE` (deploy-time
 *    adapter implementing `KmsKeyOperations` against the provider SDK; key
 *    material stays provider-side, injected via managed secret bindings).
 *    KeyIds are versioned `<provider>/<purpose>/v<n>#<fingerprint>` per
 *    checklist §1; the KMS custody implementation is
 *    `KmsCustody` (relayer/src/keycustody.ts).
 */
export function custodyProfileError(env: {
  dbPath?: string;
  custodyMode?: string;
  kmsProvider?: string;
  kmsBlinderKeyArn?: string;
  kmsSignerKeyArn?: string;
  kmsOpsModule?: string;
}): string | null {
  const mode = env.custodyMode ?? "local-dev";
  if (mode !== "local-dev" && mode !== "kms") {
    return `RELAYER_CUSTODY must be "local-dev" or "kms" (got "${mode}")`;
  }
  if (mode === "local-dev") {
    if (env.dbPath) {
      return "production profile (RELAYER_DB_PATH) must not run on ephemeral LocalDevCustody — a restart re-opens the new-account counter and weakens the Sybil bound (CISO precondition, OBS-234); set RELAYER_CUSTODY=kms with the KMS-backed custody wiring";
    }
    return null;
  }
  if (!env.dbPath) {
    return 'RELAYER_CUSTODY=kms requires the durable production profile (RELAYER_DB_PATH on a local volume)';
  }
  if (!env.kmsProvider || !env.kmsBlinderKeyArn || !env.kmsSignerKeyArn) {
    return "kms custody requires RELAYER_KMS_PROVIDER, RELAYER_KMS_BLINDER_KEY_ARN and RELAYER_KMS_SIGNER_KEY_ARN (two provider-side key objects, checklist §1)";
  }
  if (!env.kmsOpsModule) {
    return "kms custody requires RELAYER_KMS_OPS_MODULE (deploy-time adapter implementing KmsKeyOperations; never committed to the repo)";
  }
  return null;
}

/** CLI entrypoint (staging + production config switches). */
if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const { LocalDevCustody, CustodyUsageMonitor, KmsCustody } = await import("./keycustody.ts");
  const { AggregateSentimentSignalsSubmitter, DryRunSubmitter } = await import("./chain.ts");
  const { RpcCountsReader, RpcLegacySender, MAINNET_CHAIN_ID } = await import("./chainrpc.ts");
  // F3 (OBS-228): RELAYER_DB_PATH switches the relayer onto the durable
  // SQLite backend (restart- + multi-instance-safe ledger and store, shared
  // atomic new-account counter). Unset = process-local staging (DryRun-safe).
  const dbPath = process.env.RELAYER_DB_PATH;
  // OBS-300: fail closed before any custody/store construction.
  const profileError = custodyProfileError({
    dbPath,
    custodyMode: process.env.RELAYER_CUSTODY,
    kmsProvider: process.env.RELAYER_KMS_PROVIDER,
    kmsBlinderKeyArn: process.env.RELAYER_KMS_BLINDER_KEY_ARN,
    kmsSignerKeyArn: process.env.RELAYER_KMS_SIGNER_KEY_ARN,
    kmsOpsModule: process.env.RELAYER_KMS_OPS_MODULE,
  });
  if (profileError) {
    console.error(`[relayer:custody] refusing to start: ${profileError}`);
    process.exit(1);
  }
  // H1 (OBS-760): the durable production profile must authenticate /v1/publish.
  // The secret is supplied by the environment only (never committed); a
  // production process without it would expose the one-shot publish claim.
  if (dbPath && !process.env.RELAYER_PUBLISH_SECRET) {
    console.error("refusing to start: production profile (RELAYER_DB_PATH) requires RELAYER_PUBLISH_SECRET (operator auth on /v1/publish)");
    process.exit(1);
  }
  // ---- OBS-313 D1: custody provider (default = local dev) ------------------
  const custodyMode = process.env.RELAYER_CUSTODY ?? "local-dev";
  let innerCustody: import("./keycustody.ts").KeyCustody;
  if (custodyMode === "kms") {
    // Versioned keyIds (public identifiers; no material): fingerprint is a
    // SHA-256 prefix of the public ARN, so rotation is observable in
    // artifacts/logs while the key object stays provider-side.
    const provider = process.env.RELAYER_KMS_PROVIDER as string;
    const blinderArn = process.env.RELAYER_KMS_BLINDER_KEY_ARN as string;
    const signerArn = process.env.RELAYER_KMS_SIGNER_KEY_ARN as string;
    const keyIdOf = (purpose: "blinder" | "signer", arn: string) => {
      const version = Number(process.env[`RELAYER_KMS_${purpose.toUpperCase()}_VERSION`] ?? 1);
      const fp = createHash("sha256").update(arn).digest("hex").slice(0, 16);
      return `${provider}/${purpose}/v${version}#${fp}`;
    };
    const opsModule = await import(process.env.RELAYER_KMS_OPS_MODULE as string);
    const ops = (opsModule.default ?? opsModule) as import("./keycustody.ts").KmsKeyOperations;
    innerCustody = new KmsCustody(provider, {
      blinderKeyId: keyIdOf("blinder", blinderArn),
      signerKeyId: keyIdOf("signer", signerArn),
      ops,
    });
  } else {
    innerCustody = new LocalDevCustody();
  }
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
  const custody = new CustodyUsageMonitor(innerCustody, new Alerts(alertSink));

  // ---- OBS-313 D1: real-submitter path selectable by configuration ---------
  // DEFAULT = dry-run. The real cutover stays gated on the CISO re-verification
  // of the real-submitter path (OBS-166) + the OBS-237 written sign-off.
  // Mainnet (chain id 1) is refused unconditionally (OBS-86).
  const submitterMode = process.env.RELAYER_SUBMITTER ?? "dry-run";
  let chain: import("./chain.ts").ChainSubmitter = new DryRunSubmitter();
  let recorded:
    | ((dayId: number) => Promise<{ dayId: number; deltas: [number, number, number] } | null>)
    | undefined;
  if (submitterMode === "real") {
    const expectedChainId = Number(process.env.RELAYER_CHAIN_ID ?? "");
    if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
      console.error("real submitter requires RELAYER_CHAIN_ID (expected chain id; mainnet 1 is refused)");
      process.exit(2);
    }
    if (expectedChainId === MAINNET_CHAIN_ID) {
      console.error("refusing to start: RELAYER_CHAIN_ID=1 (mainnet) needs its own written sign-off (OBS-86)");
      process.exit(2);
    }
    const rpcUrl = process.env.RELAYER_CHAIN_RPC ?? "";
    const contractAddress = process.env.RELAYER_CHAIN_ADDRESS ?? "";
    if (!rpcUrl || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
      console.error("real submitter requires RELAYER_CHAIN_RPC and a valid RELAYER_CHAIN_ADDRESS");
      process.exit(2);
    }
    const sender = new RpcLegacySender({
      rpcUrl,
      expectedChainId,
      eoaAddress: process.env.RELAYER_EOA_ADDRESS ?? "",
      // Managed secret binding only; validated inside, never printed.
      keyHex: process.env.RELAYER_EOA_SECRET_KEY ?? "",
    });
    chain = new AggregateSentimentSignalsSubmitter(contractAddress, (to, data) => sender.send(to, data));
    // D8: on-chain BatchRecorded reader for the reconciliation monitor.
    const reader = new RpcCountsReader({ rpcUrl, address: contractAddress, expectedChainId });
    recorded = (dayId) => reader.recordedCounts(dayId);
  } else if (submitterMode !== "dry-run") {
    console.error(`unknown RELAYER_SUBMITTER: ${submitterMode} (expected "dry-run" or "real")`);
    process.exit(2);
  }

  const durableStore = dbPath
    ? new DurableSignalStore(dbPath, (t, d, s) => custody.cellToken(t, d, s))
    : undefined;
  const cfg: RelayerConfig = {
    ...(dbPath ? { ledger: new SqlitePublicationLedger(dbPath), store: durableStore } : {}),
    // OBS-87: production config switches (all optional; staging defaults off).
    ratePerMin: process.env.RELAYER_RATE_PER_MIN !== undefined
      ? Number(process.env.RELAYER_RATE_PER_MIN)
      : undefined,
    requireTls: process.env.RELAYER_REQUIRE_TLS === "1",
    // M1: trusted edge client-IP header (Fly sets Fly-Client-IP; lower-cased).
    clientIpHeader: process.env.RELAYER_CLIENT_IP_HEADER ?? "fly-client-ip",
    // H1: operator auth on /v1/publish — secret from the environment only.
    publishAuth: process.env.RELAYER_PUBLISH_SECRET
      ? { secret: process.env.RELAYER_PUBLISH_SECRET, headerName: process.env.RELAYER_PUBLISH_AUTH_HEADER }
      : undefined,
    alertSink,
    chain,
    // D2: readiness surface. Build revision is the public git sha, injected
    // by CI/deploy (no secrets).
    health: {
      buildRevision: process.env.RELAYER_BUILD_REVISION,
      dbBackend: dbPath ? "sqlite" : "memory",
      dbProbe: durableStore ? () => (durableStore.newAccountCounts(), true) : undefined,
    },
    // D8: reconciliation-vs-BatchRecorded diff wired to the alert sink
    // (on-chain reader exists only in real mode; dry-run checks signature +
    // internal consistency).
    ...(recorded ? { reconciliation: { recorded } } : {}),
  };
  const { server } = createSignalServer(custody, cfg);
  const port = Number(process.env.RELAYER_PORT ?? 8081);
  server.listen(port, () => {
    log(
      "server",
      dbPath
        ? `signal relayer listening (durable F3 ledger/store; custody=${custodyMode}; submitter=${submitterMode})`
        : `signal relayer listening (staging; custody=${custodyMode}; submitter=${submitterMode})`,
    );
  });
}