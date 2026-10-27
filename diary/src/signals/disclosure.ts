/**
 * Plain-language signal disclosure (M4, OBS-83; legal rev 2 draft 0.2 §4.1.5-).
 * Shown verbatim in the UI before opt-in and on every state change. No dark
 * patterns: the toggle is default-off, neutral-styled, and equally easy to
 * leave off as to turn on.
 */

export const SIGNAL_DISCLOSURE = [
  "What is shared if you turn this on: one thing — how your day felt (positive, negative, or neutral) and which UTC day it was. Nothing else.",
  "What is NOT shared: your diary text, your entry, your wallet address, any device identifier, your referral pseudonym, your precise time, or your location.",
  "Your signal is pooled with at least 99 other people before anyone sees it, and it is published at least 24 hours later, so it cannot be matched back to you or to a specific entry.",
  "Turning this off stops all future sharing immediately. Anything already published is anonymous and cannot be withdrawn, because it is only a group count.",
  "This is separate from your diary (which stays encrypted on your device) and separate from any partner referral.",
].join("\n\n");