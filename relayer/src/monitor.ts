/**
 * Reconciliation monitor (OBS-313 D8 — CISO OBS-235 binding condition 1).
 *
 * The CISO approval states explicitly that production traffic without this
 * live check voids the "detection exists" premise of the L2 deferral. The
 * monitor runs after every publish and:
 *
 *  1. **verifyReconciliation**: re-derives the unsigned artifact (canonical
 *     JSON) and checks the custody signature — a tampered or mis-signed
 *     artifact is detected.
 *  2. **Artifact-internal diff**: the per-sentiment published deltas the
 *     artifact's cells claim must match the `recordBatch` it carried to chain.
 *  3. **On-chain `BatchRecorded` diff**: when a `recorded(dayId)` reader is
 *     configured (real-submitter mode), the authoritative `getCounts(uint32)`
 *     on-chain state must match the signed recordBatch. A recorded day with
 *     no on-chain counts — or a mismatch — is a data-integrity incident.
 *
 *     OBS-363 R-5 (auditor OBS-237 `audit-rebaseline-record` §4): `eth_sendRawTransaction`
 *     returns PRE-INCLUSION, so reading `getCounts` at `latest` immediately
 *     after broadcast observes pre-inclusion state and produced a guaranteed
 *     `reconciliation_mismatch` false alarm on nearly every real publish. The
 *     diff now tolerates inclusion latency two ways:
 *       - **poll with backoff**: re-read `getCounts` until it turns non-null
 *         or the polling budget is exhausted (R-5 primary remedy);
 *       - **pending verdict**: if the day's counts are still unreadable-with-
 *         out-error when the budget runs out, the check resolves `pending` —
 *         a distinct verdict that NEVER raises `reconciliation_mismatch`
 *         (alert fatigue on the CISO detection path masks real incidents).
 *     A null read inside the budget means "not yet included"; a reader
 *     FAILURE is still reported (reader-down is not inclusion latency);
 *     a non-null read that disagrees with the signed recordBatch raises
 *     `reconciliation_mismatch` exactly as before.
 *
 *     Dry-run mode (no reader wired) is unaffected: signature + internal
 *     diff only, verdict `ok`/`mismatch`.
 *
 * Failures raise `reconciliation_mismatch` through the shared `Alerts`
 * instance, so the alert sink forwards `{reason, raisedDay, detail}` (never
 * payload data) to ops. The `pause()` brake path lives in
 * docs/PRODUCTION-CHECKLIST.md §6.
 */

import { canonical, type ReconciliationArtifact } from "./pipeline.ts";
import { Alerts, log } from "./log.ts";
import type { KeyCustody } from "./keycustody.ts";

/** Authoritative on-chain recorded state for one day (getCounts diff half). */
export interface RecordedDayCounts {
  dayId: number;
  deltas: [number, number, number];
}

export interface ReconciliationMonitorOpts {
  /** On-chain reader (real-submitter mode). Unset (dry-run) = signature + internal diff only. */
  recorded?: (dayId: number) => Promise<RecordedDayCounts | null>;
  /**
   * R-5: inclusion-latency budget for the on-chain diff. `getCounts` is polled
   * with exponential backoff until non-null, the attempt budget runs out, or
   * a read lands. Defaults: 8 attempts, 250ms initial delay, x2 backoff
   * capped at 4s — ~10.9s worst case, well past typical Sepolia inclusion.
   */
  poll?: {
    attempts?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
    maxDelayMs?: number;
  };
  /** Injectable sleep (tests pass a no-op so backoff never stalls the suite). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * H2.4/M3 (OBS-760): horizon after which a day whose on-chain counts are
   * STILL absent (budget exhausted, no reader failure) escalates from the
   * latency-tolerant `pending` verdict to a distinct `publication_missing`
   * alert. Measured from the first observation of the day as still-null, so a
   * transient inclusion delay never alarms but a permanently dropped/reverted
   * publish does. Defaults to 30 minutes.
   */
  missingAfterMs?: number;
}

/** R-5: the outcome of one reconciliation check — `pending` is never a mismatch. */
export type ReconciliationVerdict =
  | { status: "ok" }
  | { status: "mismatch" }
  | { status: "pending" }
  /** M3/H2.4: still-null on-chain counts past the horizon — a dropped/reverted publish. */
  | { status: "missing" };

const DEFAULT_POLL = { attempts: 8, initialDelayMs: 250, backoffFactor: 2, maxDelayMs: 4_000 } as const;
/** H2.4: default horizon before a still-null day escalates to `publication_missing`. */
const DEFAULT_MISSING_AFTER_MS = 30 * 60_000;

export class ReconciliationMonitor {
  private readonly custody: KeyCustody;
  private readonly alerts: Alerts;
  private readonly opts: ReconciliationMonitorOpts;
  /** H2.4/M3: first time each day was observed still-null (day resolution). */
  private readonly firstNullAt = new Map<number, number>();
  /** H2.4: days already escalated to publication_missing (raise once per day). */
  private readonly missingRaised = new Set<number>();
  // OBS-363 D5: plain fields assigned in the constructor body — parameter
  // properties are rejected by Node's strip-only TypeScript mode and crash
  // the documented `node src/server.ts` launch path.
  constructor(custody: KeyCustody, alerts: Alerts, opts: ReconciliationMonitorOpts = {}) {
    this.custody = custody;
    this.alerts = alerts;
    this.opts = opts;
  }

  private async sleep(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  /**
   * Check one freshly published artifact. Returns the verdict — `ok` when
   * every check passes, `mismatch` when a check failed (each failure raised
   * `reconciliation_mismatch`, day resolution only), `pending` (R-5) when the
   * signature + internal diff passed but the on-chain state was still
   * pre-inclusion when the polling budget ran out (no alert raised), or
   * `missing` (H2.4/M3) when the day has stayed absent past the configured
   * horizon (a `publication_missing` alert was raised).
   */
  async check(artifact: ReconciliationArtifact, nowMs: number = Date.now()): Promise<ReconciliationVerdict> {
    let ok = true;
    const fail = (detail: string) => {
      ok = false;
      this.alerts.raise("reconciliation_mismatch", detail, nowMs);
    };

    // 1. verifyReconciliation signature check over the canonical unsigned artifact.
    const { signature, ...unsigned } = artifact;
    if (signature === undefined) {
      fail("reconciliation artifact carries no signature");
    } else if (!(await this.custody.verifyReconciliation(canonical(unsigned), signature))) {
      fail("reconciliation artifact failed verifyReconciliation (signature does not match the signed payload)");
    }

    // 2. Artifact-internal diff: cells must agree with the recordBatch they shipped in.
    const rb = artifact.chain.recordBatch;
    if (rb !== null) {
      if (rb.cells.length !== 3) {
        fail(`recordBatch carried ${rb.cells.length} cells (expected 3)`);
      } else {
          for (let i = 0; i < 3; i++) {
            if ((rb.cells[i]?.publishedDelta ?? -1) !== rb.deltas[i]) {
            fail("artifact cell publishedDelta disagrees with the recordBatch delta for its sentiment slot");
            break;
          }
        }
        const published = rb.cells.filter((c) => c.published);
        if (rb.hasPublishedCells && published.length === 0) {
          fail("recordBatch claims published cells but none are marked published");
        } else if (rb.hasPublishedCells) {
          const minContributors = Math.min(...published.map((c) => c.publishedDelta));
          if (rb.publishedContributors !== minContributors) {
            fail("recordBatch publishedContributors disagrees with the published cell deltas");
          }
        }
      }
      if (rb.dayId !== artifact.generatedForDay) {
        fail("recordBatch dayId disagrees with the artifact's generatedForDay");
      }
    }

    // 3. On-chain BatchRecorded diff (real mode): the chain must hold exactly
    //    what the artifact signed. R-5: eth_sendRawTransaction returns
    //    pre-inclusion, so a single immediate read false-alarmed on nearly
    //    every real publish. Poll with backoff; a null read inside the
    //    budget is inclusion latency -> `pending`, never `reconciliation_mismatch`.
    if (rb !== null && rb.hasPublishedCells && this.opts.recorded) {
      const poll = { ...DEFAULT_POLL, ...this.opts.poll };
      let onChain: RecordedDayCounts | null = null;
      let readerFailed = false;
      for (let attempt = 0; attempt < Math.max(1, poll.attempts); attempt++) {
        if (attempt > 0) {
          const delay = Math.min(poll.initialDelayMs * Math.pow(poll.backoffFactor, attempt - 1), poll.maxDelayMs);
          await this.sleep(delay);
        }
        try {
          onChain = await this.opts.recorded(artifact.generatedForDay);
          readerFailed = false;
        } catch {
          readerFailed = true;
          onChain = null;
        }
        if (onChain !== null) break;
      }
      if (readerFailed) {
        // Reader-down is not inclusion latency — surface it, same as pre-R-5.
        fail("on-chain counts unreadable while checking a submitted day (reader failure)");
      } else if (onChain === null) {
        // Budget exhausted without a read: tx still unmined/reorged — PENDING,
        // never a mismatch (R-5). H2.4/M3: if the day stays absent past the
        // horizon, escalate to a distinct publication_missing alert (a dropped/
        // reverted publish is otherwise indistinguishable from latency).
        const day = artifact.generatedForDay;
        const firstNull = this.firstNullAt.get(day) ?? nowMs;
        this.firstNullAt.set(day, firstNull);
        const horizon = this.opts.missingAfterMs ?? DEFAULT_MISSING_AFTER_MS;
        if (nowMs - firstNull >= horizon) {
          if (!this.missingRaised.has(day)) {
            this.missingRaised.add(day);
            this.alerts.raise(
              "publication_missing",
              "submitted day has no on-chain counts after the reconciliation horizon (dropped or reverted publish)",
              nowMs,
            );
          }
          return ok ? { status: "missing" } : { status: "mismatch" };
        }
        log("monitor", "reconciliation pending: tx not yet included after the polling budget", day);
        return ok ? { status: "pending" } : { status: "mismatch" };
      } else if (
        onChain.dayId !== rb.dayId ||
        onChain.deltas[0] !== rb.deltas[0] ||
        onChain.deltas[1] !== rb.deltas[1] ||
        onChain.deltas[2] !== rb.deltas[2]
      ) {
        // Genuine on-chain disagreement with the signed recordBatch.
        fail("on-chain BatchRecorded counts differ from the signed reconciliation recordBatch");
      } else {
        // A read landed for the day: clear any pending/missing tracking.
        this.firstNullAt.delete(artifact.generatedForDay);
        this.missingRaised.delete(artifact.generatedForDay);
      }
    }
    return ok ? { status: "ok" } : { status: "mismatch" };
  }
}