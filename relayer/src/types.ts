/**
 * MyDayWas relayer — signal submission types and payload minimization (R9).
 *
 * The ONLY data a client may submit for anonymous signals is the coarsened tuple
 * `(sentiment, dayId)` plus a per-account contributor pseudonym for k-distinctness.
 * Anything else (diary content, entry ids, wallet addresses, device ids, referral
 * pseudonyms, precise timestamps, location) is REJECTED and RAISES AN ALERT.
 */

export const SENTIMENTS = ["POSITIVE", "NEGATIVE", "NEUTRAL"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const SIGNAL_SCHEMA_VERSION = 1;

/** Exactly what may arrive on the wire. No other field is ever accepted. */
export interface SignalSubmission {
  v: typeof SIGNAL_SCHEMA_VERSION;
  sentiment: Sentiment;
  /** UTC-day index (days since epoch). Never a precise timestamp. */
  dayId: number;
  /**
   * Per-account pseudonymous contributor token (device-generated random at
   * onboarding; NOT a wallet address, NOT the referral pseudonym).
   */
  contributorToken: string;
}

export const SIGNAL_FIELDS = ["v", "sentiment", "dayId", "contributorToken"] as const;

export const MS_PER_DAY = 86_400_000;

export function utcDay(ms: number = Date.now()): number {
  return Math.floor(ms / MS_PER_DAY);
}

/** How many days back a client may (re)submit a signal for. */
export const MAX_SUBMISSION_AGE_DAYS = 7;

export type RejectReason =
  | "malformed_json"
  | "unexpected_fields"
  | "bad_version"
  | "bad_sentiment"
  | "bad_dayId"
  | "dayId_out_of_window"
  | "bad_contributor_token"
  | "new_account_rate_limited";

export class RejectedSubmission extends Error {
  readonly reason: RejectReason;
  constructor(reason: RejectReason) {
    super(`submission rejected: ${reason}`);
    this.reason = reason;
  }
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Parse + validate a submission body. Reject-and-alert on any unexpected field:
 * payload minimization is enforced structurally, not by convention.
 */
export function parseSubmission(
  raw: unknown,
  nowMs: number,
): { submission: SignalSubmission; unexpected: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RejectedSubmission("malformed_json");
  }
  const keys = Object.keys(raw);
  const unexpected = keys.filter((k) => !(SIGNAL_FIELDS as readonly string[]).includes(k));
  // Payload minimization: unknown fields are content-bearing by default. Do NOT
  // inspect their values — log nothing about them and reject+alert upstream.
  const v = (raw as Record<string, unknown>).v;
  const sentiment = (raw as Record<string, unknown>).sentiment;
  const dayId = (raw as Record<string, unknown>).dayId;
  const contributorToken = (raw as Record<string, unknown>).contributorToken;
  if (v !== SIGNAL_SCHEMA_VERSION) throw new RejectedSubmission("bad_version");
  if (typeof sentiment !== "string" || !(SENTIMENTS as readonly string[]).includes(sentiment)) {
    throw new RejectedSubmission("bad_sentiment");
  }
  if (typeof dayId !== "number" || !Number.isInteger(dayId) || dayId < 0 || dayId > 0xffff_ffff) {
    throw new RejectedSubmission("bad_dayId");
  }
  if (typeof contributorToken !== "string" || !TOKEN_RE.test(contributorToken)) {
    throw new RejectedSubmission("bad_contributor_token");
  }
  const today = utcDay(nowMs);
  // Server-enforced ingest window: no future days, nothing older than a week.
  if (dayId > today || dayId < today - MAX_SUBMISSION_AGE_DAYS) {
    throw new RejectedSubmission("dayId_out_of_window");
  }
  return {
    submission: {
      v: SIGNAL_SCHEMA_VERSION,
      sentiment: sentiment as Sentiment,
      dayId,
      contributorToken,
    },
    unexpected,
  };
}