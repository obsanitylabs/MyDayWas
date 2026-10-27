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
 *                            signed reconciliation artifact)
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { parseSubmission, RejectedSubmission, type SignalSubmission } from "./types.ts";
import { SignalStore } from "./store.ts";
import { Alerts, log } from "./log.ts";
import { PublicationPipeline } from "./pipeline.ts";
import { DryRunSubmitter, type ChainSubmitter } from "./chain.ts";
import type { KeyCustody } from "./keycustody.ts";

export interface RelayerConfig {
  kThreshold?: number;
  delayMs?: number;
  chain?: ChainSubmitter;
}

export function createSignalServer(custody: KeyCustody, cfg: RelayerConfig = {}): {
  server: Server;
  store: SignalStore;
  pipeline: PublicationPipeline;
  alerts: Alerts;
} {
  const alerts = new Alerts();
  const store = new SignalStore((t, d, s) => custody.cellToken(t, d, s));
  const pipeline = new PublicationPipeline(store, custody, cfg.chain ?? new DryRunSubmitter(), {
    kThreshold: cfg.kThreshold,
    delayMs: cfg.delayMs,
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
          if (e && typeof e === "object" && "dayId" in e) {
            return respond(409, { error: "not_yet_publishable", dayId });
          }
          throw e;
        }
      } catch (e) {
        log("server", "request failed (no payload details)");
        return respond(500, { error: "internal" });
      }
    })();
  });
  return { server, store, pipeline, alerts };
}

/** CLI entrypoint (staging). */
if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const { LocalDevCustody } = await import("./keycustody.ts");
  const { server } = createSignalServer(new LocalDevCustody());
  const port = Number(process.env.RELAYER_PORT ?? 8081);
  server.listen(port, () => {
    log("server", "signal relayer listening (staging; chain submitter is dry-run pending Chief Auditor review)");
  });
}