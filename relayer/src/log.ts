/**
 * Relayer logging hygiene (R9).
 *
 * Rules enforced by type and convention:
 *  - Log lines may carry ONLY: static area/message strings, UTC day ids, and
 *    integer counts. No diary plaintext, no entry ids, no wallet/device/referral
 *    identifiers, no precise timestamps (day resolution only), no contributor
 *    tokens, no submission payloads.
 *  - Alerts are recorded as events with a reason code and are the hook for
 *    production anomaly monitoring. Production sink wiring (OBS-87): pass a
 *    `sink` to `Alerts` (or set RELAYER_ALERT_WEBHOOK on the server CLI); the
 *    sink receives `{reason, raisedDay, detail}` only — reason codes + day
 *    resolution, no payload data — which is safe to forward to SNS/PagerDuty.
 *  - Additional OBS-87 reasons: custody_usage_anomaly (blinding/signing op
 *    spike), sybil_early_warning (day-over-day new-account spike),
 *    rate_limited (per-IP rate shaping on /v1/signals).
 *  - OBS-235 condition 1 / OBS-313 D8: reconciliation_mismatch (reconciliation
 *    artifact signature failure or reconciliation-vs-`BatchRecorded` diff) —
 *    the detection path for the accepted L2 residual risk; must be live
 *    before production traffic.
 */

export type AlertReason =
  | "unexpected_submission_fields"
  | "malformed_submission"
  | "dayId_out_of_window"
  | "new_account_rate_limited"
  | "custody_usage_anomaly"
  | "sybil_early_warning"
  | "rate_limited"
  | "reconciliation_mismatch"
  /** M3/H2.4: a submitted day's on-chain counts are still absent after the horizon — a dropped/reverted publish, distinct from inclusion latency. */
  | "publication_missing";

export interface Alert {
  reason: AlertReason;
  /** UTC day on which the alert was raised — never a precise timestamp. */
  raisedDay: number;
  /** Static human explanation, no payload data. */
  detail: string;
}

/** M2 (OBS-760): default cap on the in-process alert ring buffer. */
export const DEFAULT_ALERT_CAPACITY = 1_000;

export class Alerts {
  // M2 (OBS-760): a bounded RING BUFFER, not an unbounded array. The H1
  // unauthenticated-flood path can raise an alert per request; an unbounded
  // `raised` array was an OOM vector. `list()` still returns oldest→newest.
  private readonly buffer: Alert[];
  private readonly capacity: number;
  private head = 0;
  private size = 0;
  private readonly sink: (a: Alert) => void;
  constructor(sink: (a: Alert) => void = () => {}, capacity = DEFAULT_ALERT_CAPACITY) {
    this.sink = sink;
    this.capacity = Math.max(1, capacity);
    this.buffer = new Array<Alert>(this.capacity);
  }

  raise(reason: AlertReason, detail: string, nowMs: number): void {
    const alert: Alert = {
      reason,
      raisedDay: Math.floor(nowMs / 86_400_000),
      detail,
    };
    if (this.size < this.capacity) {
      this.buffer[(this.head + this.size) % this.capacity] = alert;
      this.size++;
    } else {
      // Full: overwrite the oldest slot and advance the head (O(1)).
      this.buffer[this.head] = alert;
      this.head = (this.head + 1) % this.capacity;
    }
    this.sink(alert);
  }

  list(): readonly Alert[] {
    const out: Alert[] = [];
    for (let i = 0; i < this.size; i++) out.push(this.buffer[(this.head + i) % this.capacity]!);
    return out;
  }
}

/** Log a hygiene-safe line: static strings + day ids/counts only. */
export function log(area: string, message: string, dayId?: number, count?: number): void {
  const parts = [`[relayer:${area}]`, message];
  if (dayId !== undefined) parts.push(`day=${dayId}`);
  if (count !== undefined) parts.push(`n=${count}`);
  console.info(parts.join(" "));
}