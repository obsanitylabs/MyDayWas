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
import { Alerts, log } from "./log.ts";
import { AlreadyPublished, NotYetPublishable, PublicationPipeline } from "./pipeline.ts";
import { DryRunSubmitter, type ChainSubmitter } from "./chain.ts";
import { MemoryPublicationLedger, type PublicationLedger } from "./ledger.ts";
import { DurableSignalStore, SqlitePublicationLedger } from "./durable.ts";
import type { KeyCustody } from "./keycustody.ts";

export interface RelayerConfig {
  kThreshold?: number;
  delayMs?: number;
  chain?: ChainSubmitter;
  /** Per-day publication ledger (F2); defaults to the process-local staging map. */
  ledger?: PublicationLedger;
  /** Signal store (F3); defaults to the process-local staging store. */
  store?: SignalStoreCore;
}

export function createSignalServer(custody: KeyCustody, cfg: RelayerConfig = {}): {
  server: Server;
  store: SignalStoreCore;
  pipeline: PublicationPipeline;
  alerts: Alerts;
  ledger: PublicationLedger;
} {
  const alerts = new Alerts();
  // One ledger per relayer instance (per-day + per-instance scoping, F2/F3 design).
  const ledger = cfg.ledger ?? new MemoryPublicationLedger();
  const store = cfg.store ?? new SignalStore((t, d, s) => custody.cellToken(t, d, s));
  const pipeline = new PublicationPipeline(store, custody, cfg.chain ?? new DryRunSubmitter(), {
    kThreshold: cfg.kThreshold,
    delayMs: cfg.delayMs,
    ledger,
  });

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
      try {
        if (req.url === "/v1/signals") {
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

/** CLI entrypoint (staging). */
if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const { LocalDevCustody } = await import("./keycustody.ts");
  const custody = new LocalDevCustody();
  // F3 (OBS-228): RELAYER_DB_PATH switches the relayer onto the durable
  // SQLite backend (restart- + multi-instance-safe ledger and store, shared
  // atomic new-account counter). Unset = process-local staging (DryRun-safe).
  const dbPath = process.env.RELAYER_DB_PATH;
  const cfg: RelayerConfig = dbPath
    ? {
        ledger: new SqlitePublicationLedger(dbPath),
        store: new DurableSignalStore(dbPath, (t, d, s) => custody.cellToken(t, d, s)),
      }
    : {};
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