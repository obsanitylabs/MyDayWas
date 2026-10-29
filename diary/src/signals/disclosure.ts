/**
 * Plain-language signal disclosure (M4, OBS-83; legal rev 2 draft 0.2 §4.1.5-).
 * Shown verbatim in the UI before opt-in and on every state change. No dark
 * patterns: the toggle is default-off, neutral-styled, and equally easy to
 * leave off as to turn on.
 */

export const SIGNAL_DISCLOSURE = [
  "What is shared if you turn this on: one thing — how your day felt (positive, negative, or neutral) and which UTC day it was. Nothing else.",
  "What is NOT shared: your diary text, your entry, your wallet address, any device identifier, your referral pseudonym, your precise time, or your location.",
  "To count each person once per day, a random, purpose-specific signal token also leaves your device with your signal. It is not your wallet address, not a device identifier, and not your referral pseudonym. It is rotated when you turn signals off.",
  "Your signal joins a group of at least 100 different people before it is published, and it is published at least 24 hours later. This is designed to make matching a signal back to you or a specific entry hard — we do not claim it is impossible (for example, someone watching your own wallet or nearby chain activity could in theory still infer linkage).",
  "Turning this off stops all future sharing immediately and rotates your signal token. Anything already published is only a group count; it cannot be withdrawn.",
  "This is separate from your diary (which stays encrypted on your device) and separate from any partner referral.",
].join("\n\n");

/**
 * Legal rev 3 wording constraint: a single person's input is NOT "anonymous".
 * The published aggregate is called anonymous only because it requires at
 * least 100 distinct contributors AND a 24-hour delay before publication.
 */
export const SIGNALS_TITLE = "Aggregated signals";
export const SIGNALS_TITLE_HINT =
  "Contribute your sentiment and the UTC day to grouped public statistics. Off by default. Published counts are anonymous only in aggregate: they are released only after at least 100 different people and a 24-hour delay. Your own contribution is pseudonymous, not anonymous.";