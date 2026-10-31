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
 * Failures raise `reconciliation_mismatch` through the shared `Alerts`
 * instance, so the alert sink forwards `{reason, raisedDay, detail}` (never
 * payload data) to ops. The `pause()` brake path lives in
 * docs/PRODUCTION-CHECKLIST.md §6.
 */

import { canonical, type ReconciliationArtifact } from "./pipeline.ts";
import { Alerts } from "./log.ts";
import type { KeyCustody } from "./keycustody.ts";

/** Authoritative on-chain recorded state for one day (getCounts diff half). */
export interface RecordedDayCounts {
  dayId: number;
  deltas: [number, number, number];
}

export interface ReconciliationMonitorOpts {
  /** On-chain reader (real-submitter mode). Unset (dry-run) = signature + internal diff only. */
  recorded?: (dayId: number) => Promise<RecordedDayCounts | null>;
}

export class ReconciliationMonitor {
  constructor(
    private readonly custody: KeyCustody,
    private readonly alerts: Alerts,
    private readonly opts: ReconciliationMonitorOpts = {},
  ) {}

  /**
   * Check one freshly published artifact. Returns true when every check
   * passes; raises `reconciliation_mismatch` (per failed check, day
   * resolution only) and returns false otherwise.
   */
  async check(artifact: ReconciliationArtifact, nowMs: number = Date.now()): Promise<boolean> {
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
    // what the artifact signed. A null reader result for a submitted day means
    // the chain recorded nothing — integrity incident.
    if (rb !== null && rb.hasPublishedCells && this.opts.recorded) {
      let onChain: RecordedDayCounts | null = null;
      try {
        onChain = await this.opts.recorded(artifact.generatedForDay);
      } catch {
        fail("on-chain counts unreadable while checking a submitted day (reader failure)");
      }
      if (onChain === null) {
        fail("no on-chain counts recorded for a day the signed artifact claims was submitted");
      } else if (
        onChain.dayId !== rb.dayId ||
        onChain.deltas[0] !== rb.deltas[0] ||
        onChain.deltas[1] !== rb.deltas[1] ||
        onChain.deltas[2] !== rb.deltas[2]
      ) {
        fail("on-chain BatchRecorded counts differ from the signed reconciliation recordBatch");
      }
    }
    return ok;
  }
}