/**
 * Partner-referral pseudonym (M4, OBS-83).
 *
 * Legal constraint: the referral uses a SEPARATE pseudonym — never the wallet
 * address, never the diary account id, never the signal contributor token.
 * Revocation regenerates it so past queue items cannot be linked forward.
 */

const PSEUDONYM_KEY = "mydaywas.referral.pseudonym.v1";

export function getReferralPseudonym(storage: Storage): string {
  let p = storage.getItem(PSEUDONYM_KEY);
  if (!p) {
    p = "ref_" + crypto.randomUUID().replace(/-/g, "");
    storage.setItem(PSEUDONYM_KEY, p);
  }
  return p;
}

/** Regenerate (fresh unlinkable pseudonym) — used on revoke. */
export function rotateReferralPseudonym(storage: Storage): string {
  const p = "ref_" + crypto.randomUUID().replace(/-/g, "");
  storage.setItem(PSEUDONYM_KEY, p);
  return p;
}