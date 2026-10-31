/**
 * Signal store — per-(dayId, sentiment) cells with k-distinctness accounting.
 *
 * Distinctness definition (R9, binding for M4):
 *   A cell has `k` distinct contributors iff the number of unique
 *   HMAC-blinded `cellToken`s recorded for that cell is >= k, where
 *   `cellToken = HMAC(serverKey, dayId | sentiment | contributorToken)`.
 *   The blinding makes stored count-sets unlinkable across cells and days.
 *   The `contributorToken` is the app's device-generated per-account pseudonym —
 *   pseudonymous distinctness, not identity verification (M2 §3 residual risk,
 *   accepted by CPO; service-layer Sybil resistance = the new-account rate limit).
 *
 * Account-creation rate limit (R9):
 *   New (never-seen) contributor tokens are capped at MAX_NEW_ACCOUNTS_PER_UTC_DAY
 *   per UTC day. Above the cap, submissions carrying unseen tokens are rejected
 *   until the next UTC day. This bounds trivial one-device-many-account Sybil
 *   inflation of cell counts toward the k threshold.
 *
 * Retention: cells are purged after RETENTION_DAYS from ingest (no content ever
 * exists to retain — only blinded tokens and integer counts).
 */

import { MS_PER_DAY, type Sentiment, type SignalSubmission } from "./types.ts";
import { RejectedSubmission } from "./types.ts";

export const MAX_NEW_ACCOUNTS_PER_UTC_DAY = 1_000;
export const RETENTION_DAYS = 35;

export interface CellStats {
  /** Distinct (blinded) contributors recorded for this cell. */
  contributors: number;
  /** Total submissions accepted for this cell. */
  submissions: number;
}

export interface CellPurge {
  dayId: number;
  sentiment: Sentiment;
  purgedAtMs: number;
}

/**
 * Store surface consumed by the pipeline/server. Staging uses the in-memory
 * `SignalStore` (process-local by design); production/F3 uses a durable
 * backend (`durable.ts`) implementing the same surface so replay-prevention
 * state (first-seen markers, new-account counts, per-cell blinded tokens)
 * survives restarts and is shared atomically across relayer instances.
 */
export interface SignalStoreCore {
  /** Record one accepted submission into its cell, enforcing the new-account rate limit. */
  record(sub: SignalSubmission, nowMs: number): Promise<{ newContributor: boolean }>;
  distinctContributors(dayId: number, sentiment: Sentiment): number;
  stats(dayId: number, sentiment: Sentiment): CellStats;
  purge(nowMs?: number): CellPurge[];
}

export class SignalStore implements SignalStoreCore {
  /** cellKey = `${dayId}:${sentiment}` -> per-token submission count. */
  private readonly cells = new Map<string, Map<string, number>>();
  /** cellKey -> total submissions. */
  private readonly cellTotals = new Map<string, number>();
  /** contributorToken -> first dayId seen (for the new-account rate limit). */
  private readonly firstSeenDay = new Map<string, number>();
  /** dayId -> new accounts opened that day. */
  private readonly newAccountsPerDay = new Map<number, number>();

  private readonly blind: (t: string, d: number, s: string) => Promise<string>;

  constructor(blind: (t: string, d: number, s: string) => Promise<string>) {
    this.blind = blind;
  }

  /**
   * Record one accepted submission into its cell. Returns true if it added a new
   * distinct contributor to the cell. Enforces the account-creation rate limit.
   */
  async record(sub: SignalSubmission, nowMs: number): Promise<{ newContributor: boolean }> {
    const today = Math.floor(nowMs / MS_PER_DAY);
    const seen = this.firstSeenDay.get(sub.contributorToken);
    if (seen === undefined) {
      const opened = this.newAccountsPerDay.get(today) ?? 0;
      if (opened >= MAX_NEW_ACCOUNTS_PER_UTC_DAY) {
        throw new RejectedSubmission("new_account_rate_limited");
      }
      this.firstSeenDay.set(sub.contributorToken, today);
      this.newAccountsPerDay.set(today, opened + 1);
    }
    const token = await this.blind(sub.contributorToken, sub.dayId, sub.sentiment);
    const key = `${sub.dayId}:${sub.sentiment}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Map();
      this.cells.set(key, cell);
      this.cellTotals.set(key, 0);
    }
    const before = cell.size;
    cell.set(token, (cell.get(token) ?? 0) + 1);
    this.cellTotals.set(key, (this.cellTotals.get(key) ?? 0) + 1);
    return { newContributor: cell.size > before };
  }

  distinctContributors(dayId: number, sentiment: Sentiment): number {
    return this.cells.get(`${dayId}:${sentiment}`)?.size ?? 0;
  }

  stats(dayId: number, sentiment: Sentiment): CellStats {
    return {
      contributors: this.distinctContributors(dayId, sentiment),
      submissions: this.cellTotals.get(`${dayId}:${sentiment}`) ?? 0,
    };
  }

  /**
   * Purge ingested cells older than RETENTION_DAYS. Returns what was dropped,
   * at day resolution only (no precise timestamps in purge records either).
   */
  purge(nowMs: number = Date.now()): CellPurge[] {
    const cutoffDay = Math.floor(nowMs / MS_PER_DAY) - RETENTION_DAYS;
    const purged: CellPurge[] = [];
    for (const key of [...this.cells.keys()]) {
      const [dStr, sentiment] = key.split(":");
      const dayId = Number(dStr);
      if (dayId < cutoffDay) {
        this.cells.delete(key);
        this.cellTotals.delete(key);
        purged.push({ dayId, sentiment: sentiment as Sentiment, purgedAtMs: Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY });
      }
    }
    return purged;
  }
}