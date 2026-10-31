/**
 * Delete-account shared-state cleanup (D3, OBS-364).
 *
 * The beta delete-account confirmation (legal/betaCopy.ts, GC-cleared at
 * d99caa8) promises: "We will stop your signals, clear your signal queue,
 * and purge any pending partner referrals." QA Phase A (OBS-302) found the
 * old App.deleteAccount only removed the diary, leaving the signals opt-in
 * (enabled:true), the signal contributor token, the referral consent, the
 * referral pseudonym and the referral queue in localStorage — a misleading
 * privacy-consent disclosure. This module performs the promised cleanup
 * (option (a) in OBS-364: make the promise true; no new legal copy needed).
 */

import { revokeSignals } from "../signals/settings";
import { clearContributorToken } from "../signals/submit";
import { revokeReferral } from "../referral/consent";
import { clearQueue } from "../referral/queue";
import { clearReferralPseudonym } from "../referral/pseudonym";

/**
 * Purge every cross-feature consent/pseudonym/queue record the delete dialog
 * names: stop signals (opt-in off), remove the signal contributor token,
 * revoke the referral consent (all fields off), clear the referral queue,
 * and remove the referral pseudonym. Idempotent; safe to call on a fresh
 * device. Called by App.deleteAccount after diary.deleteAccount().
 */
export function purgeSharedAccountState(storage: Storage): void {
  // "stop your signals" — the sanctioned revocation path (enabled:false).
  revokeSignals(storage);
  // the signal pseudonym/token must not survive the account either.
  clearContributorToken(storage);
  // "purge any pending partner referrals" — consent off, queue removed,
  // and the separate referral pseudonym deleted so nothing links forward.
  revokeReferral(storage);
  clearQueue(storage);
  clearReferralPseudonym(storage);
}