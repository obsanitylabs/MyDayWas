/**
 * Follow-up prompt logic (M4, OBS-83).
 *
 * Constraints (CPO decision 2026-10-27, ux-consent-spec-m4 rev 3 §5.1):
 * follow-up is OFF BY DEFAULT — users opt in from Settings. Prompting after
 * every save without an explicit opt-in is repeated interaction pressure (a
 * dark pattern), so the initial switch state is off. When enabled: ONE
 * lightweight prompt per entry; skippable; disableable; inference runs
 * ON-DEVICE ONLY. We store "seen" entry ids locally so the same entry is never
 * prompted twice; entry ids are local device data and never enter any
 * submission or log line.
 */

const ENABLED_KEY = "mydaywas.followup.enabled.v1";
const SEEN_KEY = "mydaywas.followup.seen.v1";

/** Default OFF (opt-in from Settings) — spec rev 3 §5.1 / §5.2. */
export function isFollowUpEnabled(storage: Storage): boolean {
  return storage.getItem(ENABLED_KEY) === "true";
}

export function setFollowUpEnabled(storage: Storage, enabled: boolean): void {
  storage.setItem(ENABLED_KEY, enabled ? "true" : "false");
}

function seen(storage: Storage): Set<string> {
  try {
    return new Set(JSON.parse(storage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(storage: Storage, s: Set<string>): void {
  storage.setItem(SEEN_KEY, JSON.stringify([...s]));
}

/** Prompt at most once per entry, and only when the opt-in is ON. */
export function shouldPromptFor(storage: Storage, entryId: string): boolean {
  if (!isFollowUpEnabled(storage)) return false;
  return !seen(storage).has(entryId);
}

export function markPrompted(storage: Storage, entryId: string): void {
  const s = seen(storage);
  s.add(entryId);
  saveSeen(storage, s);
}

/** "Skip" == dismiss this one prompt without disabling the feature. */
export function skipPrompt(storage: Storage, entryId: string): void {
  markPrompted(storage, entryId);
}

export interface FollowUpQuestion {
  /** Static question text (no inference output enters any payload). */
  question: string;
  /** Optional free-text answer, stored ONLY as a normal diary entry if answered. */
  placeholder: string;
}

/**
 * On-device inference: derive the single follow-up question from the entry's
 * sentiment tag ONLY, in the browser. No network call, no model, no payload.
 */
export function onDeviceFollowUp(entry: { sentiment: string }): FollowUpQuestion {
  switch (entry.sentiment) {
    case "POSITIVE":
      return { question: "What was the best part of today?", placeholder: "One line is plenty." };
    case "NEGATIVE":
      return { question: "Is there anything that would make tomorrow feel lighter?", placeholder: "One line is plenty — or skip." };
    default:
      return { question: "What mattered most about today?", placeholder: "One line is plenty — or skip." };
  }
}