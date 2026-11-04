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
  /**
   * M3/OBS-775: interval for the server-side periodic read-only sweep. This is
   * consumed by `createSignalServer` (the monitor itself never schedules a
   * timer so tests can drive `sweep()` directly). `0` disables the timer.
   * Defaults to 60 seconds.
   */
  sweepIntervalMs?: number;
  /**
   * M3/OBS-775: cap on the retained-publish registry. The registry is bounded
   * oldest-first so a long-lived process cannot grow it without limit. Defaults
   * to 256 entries (a day is ~1 KiB, so the worst case is ~256 KiB).
   */
  maxRetained?: number;
}

/** M3/OBS-775: one publish retained until a successful on-chain read clears it. */
interface RetainedPublication {
  dayId: number;
  /** Present for a publish that returned successfully; absent for BroadcastUncertainError. */
  artifact?: ReconciliationArtifact;
  /** First time this day was observed still-null (drives the inclusion horizon). */
  firstNullAt: number;
  /** True once the distinct publication_missing alert was raised for this day. */
  missingRaised: boolean;
}

const DEFAULT_MAX_RETAINED = 256;
const PUBLICATION_MISSING_DETAIL =
  "submitted day has no on-chain counts after the reconciliation horizon (dropped or reverted publish)";

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
  /**
   * M3/OBS-775: the bounded retained-publish registry. It replaces the two
   * unbounded maps used by the first M3 cut (firstNullAt + missingRaised) and
   * additionally carries the artifact needed by the periodic sweep. A later
   * successful read deletes the entry; the oldest entry is evicted when the
   * configured cap is exceeded.
   */
  private readonly retained = new Map<number, RetainedPublication>();
  // OBS-363 D5: plain fields assigned in the constructor body — parameter
  // properties are rejected by Node's strip-only TypeScript mode and crash
  // the documented `node src/server.ts` launch path.
  constructor(custody: KeyCustody, alerts: Alerts, opts: ReconciliationMonitorOpts = {}) {
    this.custody = custody;
    this.alerts = alerts;
    this.opts = opts;
  }

  /** M3/OBS-775: number of retained publishes awaiting a successful read (test/ops visibility). */
  get retainedCount(): number {
    return this.retained.size;
  }

  /**
   * M3/OBS-775: retain a publish whose broadcast outcome is unknown. The dayId
   * is enough for the sweep's read-only `recorded(dayId)` reconciliation read;
   * no artifact exists to verify because the pipeline throws before signing.
   * No-op when no on-chain reader is configured (dry-run has no on-chain half).
   */
  trackUncertain(dayId: number, nowMs: number = Date.now()): void {
    if (!this.opts.recorded) return;
    this.retain(dayId, undefined, nowMs);
  }

  /**
   * M3/OBS-775: retain a publish that returned successfully so the periodic
   * sweep re-checks it after the inclusion horizon. A read that lands (matching
   * or mismatching) clears the entry; a day with no on-chain batch is not
   * retained because there is nothing to wait for.
   */
  track(artifact: ReconciliationArtifact, nowMs: number = Date.now()): void {
    if (!this.opts.recorded) return;
    const rb = artifact.chain.recordBatch;
    if (rb === null || !rb.hasPublishedCells) return;
    this.retain(artifact.generatedForDay, artifact, nowMs);
  }

  /**
   * M3/OBS-775: periodic, READ-ONLY sweep over retained publishes. For every
   * day still absent past the inclusion horizon it raises the distinct
   * `publication_missing` alert exactly once; a read that lands clears the
   * retained record. Never signs, never submits a tx, never spends. A reader
   * failure leaves the entry in place for the next interval and never throws.
   * Returns the number of retained entries examined (test/ops visibility).
   */
  async sweep(nowMs: number = Date.now()): Promise<number> {
    if (!this.opts.recorded) return 0;
    const horizon = this.opts.missingAfterMs ?? DEFAULT_MISSING_AFTER_MS;
    let examined = 0;
    // Iterate a snapshot so a concurrent release cannot disturb the walk.
    for (const entry of [...this.retained.values()]) {
      examined++;
      try {
        const onChain = await this.opts.recorded(entry.dayId);
        if (onChain !== null) {
          // A read landed: the publish is not missing. Preserve the existing
          // "later successful read clears tracking" behaviour. When the retained
          // artifact carried a recordBatch, a non-null read that disagrees is a
          // genuine data-integrity mismatch (same alert as the request path).
          const rb = entry.artifact?.chain.recordBatch;
          if (
            rb !== undefined && rb !== null &&
            (onChain.dayId !== rb.dayId ||
              onChain.deltas[0] !== rb.deltas[0] ||
              onChain.deltas[1] !== rb.deltas[1] ||
              onChain.deltas[2] !== rb.deltas[2])
          ) {
            this.alerts.raise(
              "reconciliation_mismatch",
              "on-chain BatchRecorded counts differ from the signed reconciliation recordBatch",
              nowMs,
            );
          }
          this.release(entry.dayId);
          continue;
        }
        if (nowMs - entry.firstNullAt >= horizon && !entry.missingRaised) {
          entry.missingRaised = true;
          this.alerts.raise("publication_missing", PUBLICATION_MISSING_DETAIL, nowMs);
        }
      } catch {
        // Fail-safe: the sweep runs on a timer, never in a request path. A
        // reader failure is not evidence of a dropped publish, so keep the
        // entry and retry on the next interval. No alert storm.
        log("monitor", "publication sweep read failed; will retry next interval", entry.dayId);
      }
    }
    return examined;
  }

  private retain(dayId: number, artifact: ReconciliationArtifact | undefined, nowMs: number): void {
    const existing = this.retained.get(dayId);
    if (existing) {
      if (artifact !== undefined) existing.artifact = artifact;
      return;
    }
    const entry: RetainedPublication = { dayId, firstNullAt: nowMs, missingRaised: false };
    if (artifact !== undefined) entry.artifact = artifact;
    this.retained.set(dayId, entry);
    this.evictOldest();
  }

  private release(dayId: number): void {
    this.retained.delete(dayId);
  }

  private evictOldest(): void {
    const max = Math.max(1, this.opts.maxRetained ?? DEFAULT_MAX_RETAINED);
    while (this.retained.size > max) {
      const oldest = this.retained.keys().next().value;
      if (oldest === undefined) break;
      this.retained.delete(oldest);
    }
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
        const prior = this.retained.get(day);
        const firstNull = prior?.firstNullAt ?? nowMs;
        this.retain(day, artifact, firstNull);
        const tracked = this.retained.get(day)!;
        const horizon = this.opts.missingAfterMs ?? DEFAULT_MISSING_AFTER_MS;
        if (nowMs - tracked.firstNullAt >= horizon) {
          if (!tracked.missingRaised) {
            tracked.missingRaised = true;
            this.alerts.raise("publication_missing", PUBLICATION_MISSING_DETAIL, nowMs);
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
        // A read landed but disagrees: this is a genuine on-chain mismatch, NOT
        // a missing publication. Release the retained entry so the periodic
        // sweep cannot later raise a false publication_missing for this day.
        this.release(artifact.generatedForDay);
        fail("on-chain BatchRecorded counts differ from the signed reconciliation recordBatch");
      } else {
        // A read landed for the day: clear any pending/missing tracking.
        this.release(artifact.generatedForDay);
      }
    }
    return ok ? { status: "ok" } : { status: "mismatch" };
  }
}