/**
 * Anonymous-signal submission client (M4, OBS-83).
 *
 * PRIVACY INVARIANT — the ONLY data that may leave the device for signals is:
 *      `(sentiment, UTC dayId)` + a device-generated contributor token.
 * No diary text, entry id, wallet address, device id, referral pseudonym,
 * precise timestamp, or location ever enters a submission payload. The build
 * function is the single choke point and hard-asserts this by construction.
 */

import type { Sentiment } from "../app/api";
import { utcDay } from "../app/api";

export const SIGNAL_PAYLOAD_VERSION = 1;
export const SIGNAL_PAYLOAD_FIELDS = ["v", "sentiment", "dayId", "contributorToken"] as const;

export interface SignalPayload {
  v: typeof SIGNAL_PAYLOAD_VERSION;
  sentiment: Sentiment;
  /** UTC-day index — the ONLY time data in a submission. */
  dayId: number;
  /**
   * Device-generated per-account pseudonym for relayer-side k-distinctness.
   * NOT the wallet address, NOT the referral pseudonym.
   */
  contributorToken: string;
}

/** Transport seam so tests never touch the network. */
export interface SignalTransport {
  submit(payload: SignalPayload): Promise<void>;
}

/** dev/staging transport: POST to the relayer over TLS if configured. */
export function httpTransport(url: string): SignalTransport {
  return {
    async submit(payload: SignalPayload): Promise<void> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`relayer rejected submission (${res.status})`);
    },
  };
}

const TOKEN_KEY = "mydaywas.signals.token.v1";

/** Lazily created device pseudonym for k-distinctness (never the wallet). */
export function getContributorToken(storage: Storage): string {
  let tok = storage.getItem(TOKEN_KEY);
  if (!tok) {
    tok = "sig_" + crypto.randomUUID().replace(/-/g, "");
    storage.setItem(TOKEN_KEY, tok);
  }
  return tok;
}

/** Rotate the pseudonym (used on revocation to cut k-distinctness linkage). */
export function rotateContributorToken(storage: Storage): string {
  const tok = "sig_" + crypto.randomUUID().replace(/-/g, "");
  storage.setItem(TOKEN_KEY, tok);
  return tok;
}

/**
 * Build the coarsened submission payload — the single choke point.
 * `sentiment` comes from the user's own tag (or on-device inference);
 * `dayId` is today's UTC day. Anything else is not accepted by construction.
 */
export function buildSignalPayload(
  sentiment: Sentiment,
  contributorToken: string,
  nowMs: number = Date.now(),
): SignalPayload {
  const payload: SignalPayload = {
    v: SIGNAL_PAYLOAD_VERSION,
    sentiment,
    dayId: utcDay(nowMs),
    contributorToken,
  };
  // Invariant guard: if this ever carries anything beyond the coarsened
  // tuple + token, fail loudly in dev/test rather than ship it.
  const keys = Object.keys(payload).sort();
  const expected = [...SIGNAL_PAYLOAD_FIELDS].sort();
  if (keys.length !== expected.length || !keys.every((k, i) => k === expected[i])) {
    throw new Error("signal payload violated coarsening invariant");
  }
  return payload;
}