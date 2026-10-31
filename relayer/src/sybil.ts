/**
 * Sybil early-warning (OBS-87 binding checklist).
 *
 * Day-over-day anomaly detection on new-account creation counts (the same
 * per-UTC-day counter that backs the MAX_NEW_ACCOUNTS_PER_UTC_DAY rate limit).
 * Raises `sybil_early_warning` when today's running new-account count exceeds
 * `spikeFactor × max(prevTwoDays)` and the absolute floor — well before the
 * hard rate-limit cap trips — so account-farm Sybil pressure toward the
 * k-anonymity threshold is visible a day early.
 *
 * Input is integer counts per UTC day only (Map<number, number>); no tokens,
 * no payload data. Alerts carry reason codes + day resolution only.
 */

import type { Alerts } from "./log.ts";
import { MS_PER_DAY } from "./types.ts";

export interface SybilEarlyWarningOpts {
  /** Today's count must exceed spikeFactor × recent baseline to alert. */
  spikeFactor?: number;
  /** Absolute floor on the baseline (avoid alerting on tiny denominators). */
  floor?: number;
}

export class SybilEarlyWarning {
  private readonly counts: () => Map<number, number>;
  private readonly alerts: Alerts;
  private readonly spikeFactor: number;
  private readonly floor: number;
  /** Dedup: alert at most once per UTC day. */
  private lastAlertedDay = -1;

  constructor(counts: () => Map<number, number>, alerts: Alerts, opts: SybilEarlyWarningOpts = {}) {
    this.counts = counts;
    this.alerts = alerts;
    this.spikeFactor = opts.spikeFactor ?? 3;
    this.floor = opts.floor ?? 200;
  }

  /**
   * Check the day-over-day anomaly. Cheap (two map lookups); call per ingest.
   * Returns true when an early warning was raised for `nowMs`'s UTC day.
   */
  check(nowMs: number): boolean {
    const today = Math.floor(nowMs / MS_PER_DAY);
    const todayCount = this.counts().get(today) ?? 0;
    const baseline = Math.max(this.counts().get(today - 1) ?? 0, this.counts().get(today - 2) ?? 0);
    if (
      baseline >= this.floor &&
      todayCount > baseline * this.spikeFactor &&
      this.lastAlertedDay !== today
    ) {
      this.lastAlertedDay = today;
      this.alerts.raise(
        "sybil_early_warning",
        `new-account creation ${todayCount} exceeds ${this.spikeFactor}x the day-over-day baseline — early Sybil pressure toward the k-anonymity threshold`,
        nowMs,
      );
      return true;
    }
    return false;
  }
}