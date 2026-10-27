/**
 * Partner-referral outbound queue (M4, OBS-83 — STUB, no live integration).
 *
 * Legal constraint: queued referral items are purged within 30 days of
 * processing or failed delivery. Queue items contain ONLY consented field
 * values under the separate referral pseudonym — never diary plaintext,
 * never entry ids, never the wallet. Handoff (actual partner delivery) is
 * out of scope for v1; the queue + purge + revocation path is the stub.
 */

import { utcDay } from "../app/api";
import { REFERRAL_FIELDS, SPECIAL_CATEGORY_FIELD, type ReferralConsent } from "./consent";

const QUEUE_KEY = "mydaywas.referral.queue.v1";

/** Max age of a queue item: 30 days (legal rev 2 draft 0.2). */
export const PURGE_AFTER_DAYS = 30;

export interface ReferralQueueItem {
  v: 1;
  /** The separate referral pseudonym (never the wallet). */
  pseudonym: string;
  /** ONLY consented field values; content-bearing fields are never stored. */
  data: Record<string, string>;
  /** UTC day the item was enqueued — day resolution only. */
  enqueuedDay: number;
}

function load(storage: Storage): ReferralQueueItem[] {
  try {
    const items = JSON.parse(storage.getItem(QUEUE_KEY) ?? "[]") as ReferralQueueItem[];
    return items.filter((i) => i?.v === 1);
  } catch {
    return [];
  }
}

function save(storage: Storage, items: ReferralQueueItem[]): void {
  storage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/**
 * Build a queue item from a diary entry using ONLY the fields consented in
 * `consent`. Throws if the entry content would leak a non-consented field.
 */
export function buildReferralItem(
  consent: ReferralConsent,
  pseudonym: string,
  entry: { sentiment: string; topic?: string },
  nowMs: number = Date.now(),
): ReferralQueueItem {
  const data: Record<string, string> = {};
  if (consent.referralEnabled && consent.fields.moodSummary) data.moodSummary = entry.sentiment;
  if (consent.referralEnabled && consent.fields.topicTag && entry.topic !== undefined) {
    data.topicTag = entry.topic;
  }
  if (consent.referralEnabled && consent.specialCategory[SPECIAL_CATEGORY_FIELD]) {
    data[SPECIAL_CATEGORY_FIELD] = "shared-with-consent";
  }
  // Never store diary text: assert the invariant.
  if (Object.keys(data).some((k) => !( [...REFERRAL_FIELDS, SPECIAL_CATEGORY_FIELD] as string[]).includes(k))) {
    throw new Error("referral item violated field whitelist");
  }
  return { v: 1, pseudonym, data, enqueuedDay: utcDay(nowMs) };
}

export function enqueue(storage: Storage, item: ReferralQueueItem): void {
  const items = load(storage);
  items.push(item);
  save(storage, items);
}

/** Purge items older than 30 days (processing/failed-delivery retention cap). */
export function purge(storage: Storage, nowMs: number = Date.now()): number {
  const cutoffDay = utcDay(nowMs) - PURGE_AFTER_DAYS;
  const items = load(storage);
  const kept = items.filter((i) => i.enqueuedDay >= cutoffDay);
  save(storage, kept);
  return items.length - kept.length;
}

/** Clear everything (revocation path). */
export function clearQueue(storage: Storage): number {
  const n = load(storage).length;
  storage.removeItem(QUEUE_KEY);
  return n;
}