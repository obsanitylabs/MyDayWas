/**
 * Partner-referral field-level consent (M4, OBS-83; legal rev 2 draft 0.2;
 * ux-consent-spec-m4 rev 3 §6.1/§6.4 — staging field set).
 *
 * Constraints:
 *  - consent is FIELD-LEVEL, not all-or-nothing; every field starts UNTICKED;
 *  - contact method is REQUIRED but still starts unticked;
 *  - each special-category field (exercise, medication, health-framed mood,
 *    crisis) needs its OWN separate explicit confirmation — no bundle tick;
 *  - the referral pseudonym is separate from the wallet (pseudonym.ts);
 *  - revocation clears the queue and rotates the pseudonym;
 *  - timestamps in consent records are day-resolution only.
 */

import { utcDay } from "../app/api";

/** Ordinary (non-special) fields. Contact method is required. */
export const REFERRAL_FIELDS = ["contactMethod", "region"] as const;
export type ReferralField = (typeof REFERRAL_FIELDS)[number];

/** Special-category (health) fields — each needs its own explicit confirm. */
export const SPECIAL_CATEGORY_FIELDS = ["exercise", "medication", "healthMood", "crisis"] as const;
export type ReferralSpecialField = (typeof SPECIAL_CATEGORY_FIELDS)[number];

export const REGIONS = ["EU", "NA", "APAC", "AF", "SA", "OTHER"] as const;
export type ReferralRegion = (typeof REGIONS)[number];

export interface ReferralConsent {
  v: 1;
  /** Share-with-partner master tick (field-level ticks still required). */
  referralEnabled: boolean;
  fields: Record<ReferralField, boolean>;
  /** Field-level ticks for the special-category health fields. */
  specialCategory: Record<ReferralSpecialField, boolean>;
  /** Per-field explicit confirmations — each special tick needs its own. */
  specialConfirmed: Record<ReferralSpecialField, boolean>;
  grantedDay: number;
}

const CONSENT_KEY = "mydaywas.referral.consent.v1";

export function emptyReferralConsent(): ReferralConsent {
  return {
    v: 1,
    referralEnabled: false,
    fields: { contactMethod: false, region: false },
    specialCategory: { exercise: false, medication: false, healthMood: false, crisis: false },
    specialConfirmed: { exercise: false, medication: false, healthMood: false, crisis: false },
    grantedDay: 0,
  };
}

export function getReferralConsent(storage: Storage): ReferralConsent {
  const raw = storage.getItem(CONSENT_KEY);
  if (!raw) return emptyReferralConsent();
  try {
    const c = JSON.parse(raw) as ReferralConsent;
    if (c.v !== 1) return emptyReferralConsent();
    return c;
  } catch {
    return emptyReferralConsent();
  }
}

export function setReferralConsent(
  storage: Storage,
  consent: ReferralConsent,
  nowMs: number = Date.now(),
): void {
  // Each special-category field can only be consented when its OWN explicit
  // confirmation is set — structurally enforced, not a UI convention.
  for (const f of SPECIAL_CATEGORY_FIELDS) {
    if (consent.specialCategory[f] && !consent.specialConfirmed[f]) {
      throw new Error(`special-category field ${f} requires its own explicit confirmation`);
    }
    // A confirmation without its field tick is ambiguous; keep them aligned.
    if (!consent.specialCategory[f]) consent.specialConfirmed[f] = false;
  }
  const next: ReferralConsent = { ...consent, grantedDay: utcDay(nowMs) };
  storage.setItem(CONSENT_KEY, JSON.stringify(next));
}

/** Revocation: consent off (all fields), queue cleared separately (queue.ts). */
export function revokeReferral(storage: Storage, nowMs: number = Date.now()): ReferralConsent {
  const revoked = emptyReferralConsent();
  revoked.grantedDay = utcDay(nowMs);
  storage.setItem(CONSENT_KEY, JSON.stringify(revoked));
  return revoked;
}