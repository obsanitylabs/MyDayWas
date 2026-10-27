/**
 * Anonymous-signals settings (M4, OBS-83).
 *
 * Legal/GC constraints (v1-legal-package §4.1.5-4.1.9, rev 2 draft 0.2):
 *  - opt-in is DEFAULT OFF, separate from diary storage consent and from the
 *    partner-referral consent, and REVOCABLE at any time;
 *  - the setting stores no precise timestamps — day resolution only;
 *  - revocation stops future submissions; already-published aggregates are
 *    k-anonymous and cannot be un-published (disclosed in the UI copy).
 */

import { utcDay } from "../app/api";

const OPTIN_KEY = "mydaywas.signals.optin.v1";

export interface SignalsOptIn {
  v: 1;
  enabled: boolean;
  /** UTC day of the last change — never a precise timestamp. */
  updatedDay: number;
}

export function getSignalsOptIn(storage: Storage): SignalsOptIn {
  const raw = storage.getItem(OPTIN_KEY);
  if (!raw) return { v: 1, enabled: false, updatedDay: 0 };
  try {
    const parsed = JSON.parse(raw) as SignalsOptIn;
    if (parsed.v !== 1 || typeof parsed.enabled !== "boolean") {
      return { v: 1, enabled: false, updatedDay: 0 };
    }
    return parsed;
  } catch {
    return { v: 1, enabled: false, updatedDay: 0 };
  }
}

export function setSignalsOptIn(storage: Storage, enabled: boolean, nowMs: number = Date.now()): void {
  const next: SignalsOptIn = { v: 1, enabled, updatedDay: utcDay(nowMs) };
  storage.setItem(OPTIN_KEY, JSON.stringify(next));
}

/** Revocation: turns the signal opt-in OFF (same as setSignalsOptIn(false)). */
export function revokeSignals(storage: Storage, nowMs: number = Date.now()): void {
  setSignalsOptIn(storage, false, nowMs);
}

/** Default storage: the browser localStorage (never used before opt-in). */
export function defaultStorage(): Storage {
  return globalThis.localStorage;
}