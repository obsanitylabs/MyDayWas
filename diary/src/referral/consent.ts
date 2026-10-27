/**
 * Partner-referral field-level consent (M4, OBS-83; legal rev 2 draft 0.2).
 *
 * Constraints:
 *  - consent is FIELD-LEVEL, not all-or-nothing;
 *  - special-category (health/mood) fields need their own EXPLICIT tick,
 *    separate from the general "share with partner" tick;
 *  - the referral pseudonym is separate from the wallet (pseudonym.ts);
 *  - revocation clears the queue and rotates the pseudonym;
 *  - timestamps in consent records are day-resolution only.
 */

import { utcDay } from "../app/api";

export const REFERRAL_FIELDS = ["moodSummary", "topicTag"] as const;
export type ReferralField = (typeof REFERRAL_FIELDS)[number];

export const SPECIAL_CATEGORY_FIELD = "healthMoodNote" as const;

export type ReferralSpecialField = typeof SPECIAL_CATEGORY_FIELD;

export interface ReferralConsent {
  v: 1;
  /** Share-with-partner master tick (field-level ticks still required). */
  referralEnabled: boolean;
  fields: Record<ReferralField, boolean>;
  /** Field-level tick for the special-category health/mood note. */
  specialCategory: Record<ReferralSpecialField, boolean>;
  /** Separate explicit special-category acknowledgement tick. */
  specialCategoryTick: boolean;
  grantedDay: number;
}

const CONSENT_KEY = "mydaywas.referral.consent.v1";

export function getReferralConsent(storage: Storage): ReferralConsent | null {
  const raw = storage.getItem(CONSENT_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as ReferralConsent;
    if (c.v !== 1) return null;
    return c;
  } catch {
    return null;
  }
}

export function setReferralConsent(
  storage: Storage,
  consent: ReferralConsent,
  nowMs: number = Date.now(),
): void {
  // The special-category field can only be consented when its own explicit
  // acknowledgement tick is set — structurally enforced, not UI-convention.
  if (consent.specialCategory[SPECIAL_CATEGORY_FIELD] && !consent.specialCategoryTick) {
    throw new Error("special-category field requires its own explicit tick");
  }
  const next: ReferralConsent = {
    ...consent,
    // ticking the acknowledgement without the field is ambiguous; keep the
    // field tick aligned with the acknowledgement.
    specialCategory: {
      [SPECIAL_CATEGORY_FIELD]: consent.specialCategoryTick && consent.specialCategory[SPECIAL_CATEGORY_FIELD],
    },
    grantedDay: utcDay(nowMs),
  };
  storage.setItem(CONSENT_KEY, JSON.stringify(next));
}

/** Revocation: consent off, queue cleared (queue.ts), pseudonym rotated. */
export function revokeReferral(storage: Storage, nowMs: number = Date.now()): ReferralConsent {
  const revoked: ReferralConsent = {
    v: 1,
    referralEnabled: false,
    fields: { moodSummary: false, topicTag: false },
    specialCategory: { [SPECIAL_CATEGORY_FIELD]: false },
    specialCategoryTick: false,
    grantedDay: utcDay(nowMs),
  };
  storage.setItem(CONSENT_KEY, JSON.stringify(revoked));
  return revoked;
}