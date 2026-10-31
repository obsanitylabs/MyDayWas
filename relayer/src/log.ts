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
 */

export type AlertReason =
  | "unexpected_submission_fields"
  | "malformed_submission"
  | "dayId_out_of_window"
  | "new_account_rate_limited"
  | "custody_usage_anomaly"
  | "sybil_early_warning"
  | "rate_limited";

export interface Alert {
  reason: AlertReason;
  /** UTC day on which the alert was raised — never a precise timestamp. */
  raisedDay: number;
  /** Static human explanation, no payload data. */
  detail: string;
}

export class Alerts {
  private readonly raised: Alert[] = [];
  private readonly sink: (a: Alert) => void;
  constructor(sink: (a: Alert) => void = () => {}) {
    this.sink = sink;
  }

  raise(reason: AlertReason, detail: string, nowMs: number): void {
    const alert: Alert = {
      reason,
      raisedDay: Math.floor(nowMs / 86_400_000),
      detail,
    };
    this.raised.push(alert);
    this.sink(alert);
  }

  list(): readonly Alert[] {
    return this.raised;
  }
}

/** Log a hygiene-safe line: static strings + day ids/counts only. */
export function log(area: string, message: string, dayId?: number, count?: number): void {
  const parts = [`[relayer:${area}]`, message];
  if (dayId !== undefined) parts.push(`day=${dayId}`);
  if (count !== undefined) parts.push(`n=${count}`);
  console.info(parts.join(" "));
}