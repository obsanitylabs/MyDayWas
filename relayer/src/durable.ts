/**
 * F3 (OBS-228) — durable publication-ledger + signal-store backend.
 *
 * Replaces the process-local staging ledger/store for production traffic:
 *  - restart-safe: all replay-prevention state is fsynced to SQLite before a
 *    claim/submission is acknowledged (synchronous=FULL, WAL),
 *  - multi-instance-safe: one shared database file; `BEGIN IMMEDIATE`
 *    write transactions serialize writers across processes (busy_timeout),
 *    and the ledger claim is a single `INSERT OR IGNORE` against a UNIQUE
 *    key, so exactly one concurrent claimant wins, process boundaries included,
 *  - shared/atomic new-account counter: the first-seen marker insert and the
 *    per-day counter increment happen in the same IMMEDIATE transaction as
 *    the cap check, so the MAX_NEW_ACCOUNTS_PER_UTC_DAY bound holds across
 *    concurrent writers, not just within one process.
 *
 * Privacy (unchanged from the in-memory store): the database only ever holds
 * blinded tokens and integer counts. The raw contributorToken is never
 * persisted; the first-seen marker is `HMAC(blinder, marker day | "SEEN" | token)`
 * with a reserved dayId (-1) that valid submissions can never carry, so
 * durable state stays unlinkable to cells/days and no pseudonym is on disk.
 */

import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
// vite-node cannot resolve the node:sqlite builtin (it tries a URL load), so
// bind it through the real Node require instead. Types come from @types/node.
const { DatabaseSync: DatabaseSyncImpl } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { MAX_NEW_ACCOUNTS_PER_UTC_DAY, RETENTION_DAYS, type CellPurge, type CellStats, type SignalStoreCore } from "./store.ts";
import type { PublicationLedger } from "./ledger.ts";
import { MS_PER_DAY, RejectedSubmission, type Sentiment, type SignalSubmission } from "./types.ts";

/** Reserved dayId for first-seen markers; real submissions carry dayId >= 0. */
const SEEN_MARKER_DAY = -1;
/** Reserved sentiment for first-seen markers; real ones are POSITIVE/NEGATIVE/NEUTRAL. */
const SEEN_MARKER_SENTIMENT = "SEEN";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS published_day (
  dayId INTEGER PRIMARY KEY,
  claimedAtMs INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS seen_token (
  marker TEXT PRIMARY KEY,
  firstSeenDay INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS new_accounts (
  dayId INTEGER PRIMARY KEY,
  opened INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cell_token (
  dayId INTEGER NOT NULL,
  sentiment TEXT NOT NULL,
  blindedToken TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (dayId, sentiment, blindedToken)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS cell_total (
  dayId INTEGER NOT NULL,
  sentiment TEXT NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (dayId, sentiment)
) WITHOUT ROWID;
`;

function openDb(path: string): DatabaseSync {
  const db = new DatabaseSyncImpl(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

/** Durable per-day publication ledger (F2 claim/release protocol, F3 backend). */
export class SqlitePublicationLedger implements PublicationLedger {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = openDb(path);
  }

  /** Atomic cross-process claim: exactly one INSERT succeeds on a UNIQUE dayId. */
  async tryClaim(dayId: number): Promise<boolean> {
    const res = this.db.prepare(
      "INSERT OR IGNORE INTO published_day (dayId, claimedAtMs) VALUES (?, ?)",
    ).run(dayId, Date.now());
    return res.changes === 1;
  }

  async release(dayId: number): Promise<void> {
    this.db.prepare("DELETE FROM published_day WHERE dayId = ?").run(dayId);
  }

  /** Durable claim state (ops/monitoring: day resolution only, no content). */
  claimedDays(): number[] {
    return this.db.prepare("SELECT dayId FROM published_day ORDER BY dayId").all().map((r) => (r as { dayId: number }).dayId);
  }

  close(): void {
    this.db.close();
  }
}

/** Durable signal store: same surface as the in-memory SignalStore, on SQLite. */
export class DurableSignalStore implements SignalStoreCore {
  private readonly db: DatabaseSync;
  private readonly blind: (t: string, d: number, s: string) => Promise<string>;

  constructor(path: string, blind: (t: string, d: number, s: string) => Promise<string>) {
    this.db = openDb(path);
    this.blind = blind;
  }

  /**
   * Record one accepted submission. The cap check, first-seen insert and
   * counter increment run inside one BEGIN IMMEDIATE transaction, so the
   * per-day new-account cap is shared and atomic across all relayer
   * instances writing this database. Rejected submissions roll back fully.
   */
  async record(sub: SignalSubmission, nowMs: number): Promise<{ newContributor: boolean }> {
    const today = Math.floor(nowMs / MS_PER_DAY);
    const token = await this.blind(sub.contributorToken, sub.dayId, sub.sentiment);
    const marker = await this.blind(sub.contributorToken, SEEN_MARKER_DAY, SEEN_MARKER_SENTIMENT);
    const before = this.distinctContributors(sub.dayId, sub.sentiment);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const seen = this.db
        .prepare("SELECT firstSeenDay FROM seen_token WHERE marker = ?")
        .get(marker) as { firstSeenDay: number } | undefined;
      if (seen === undefined) {
        const opened = (this.db.prepare("SELECT opened FROM new_accounts WHERE dayId = ?").get(today) as { opened: number } | undefined)?.opened ?? 0;
        if (opened >= MAX_NEW_ACCOUNTS_PER_UTC_DAY) throw new RejectedSubmission("new_account_rate_limited");
        this.db.prepare("INSERT INTO seen_token (marker, firstSeenDay) VALUES (?, ?)").run(marker, today);
        this.db
          .prepare("INSERT INTO new_accounts (dayId, opened) VALUES (?, 1) ON CONFLICT(dayId) DO UPDATE SET opened = opened + 1")
          .run(today);
      }
      this.db
        .prepare("INSERT INTO cell_token (dayId, sentiment, blindedToken, count) VALUES (?, ?, ?, 1) ON CONFLICT(dayId, sentiment, blindedToken) DO UPDATE SET count = count + 1")
        .run(sub.dayId, sub.sentiment, token);
      this.db
        .prepare("INSERT INTO cell_total (dayId, sentiment, total) VALUES (?, ?, 1) ON CONFLICT(dayId, sentiment) DO UPDATE SET total = total + 1")
        .run(sub.dayId, sub.sentiment);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { newContributor: this.distinctContributors(sub.dayId, sub.sentiment) > before };
  }

  distinctContributors(dayId: number, sentiment: Sentiment): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM cell_token WHERE dayId = ? AND sentiment = ?")
      .get(dayId, sentiment) as { c: number };
    return row.c;
  }

  stats(dayId: number, sentiment: Sentiment): CellStats {
    const total = (this.db
      .prepare("SELECT total FROM cell_total WHERE dayId = ? AND sentiment = ?")
      .get(dayId, sentiment) as { total: number } | undefined)?.total ?? 0;
    return {
      contributors: this.distinctContributors(dayId, sentiment),
      submissions: total,
    };
  }

  /** Purge ingested cells older than RETENTION_DAYS (day resolution only). */
  purge(nowMs: number = Date.now()): CellPurge[] {
    const cutoffDay = Math.floor(nowMs / MS_PER_DAY) - RETENTION_DAYS;
    const purgedDays = this.db
      .prepare("SELECT DISTINCT dayId, sentiment FROM cell_token WHERE dayId < ?")
      .all(cutoffDay) as Array<{ dayId: number; sentiment: Sentiment }>;
    if (purgedDays.length > 0) {
      const db = this.db;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM cell_token WHERE dayId < ?").run(cutoffDay);
        db.prepare("DELETE FROM cell_total WHERE dayId < ?").run(cutoffDay);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    return purgedDays.map((r) => ({
      dayId: r.dayId,
      sentiment: r.sentiment,
      purgedAtMs: Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY,
    }));
  }

  close(): void {
    this.db.close();
  }
}