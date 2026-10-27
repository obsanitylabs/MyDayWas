/**
 * Follow-up prompt logic (M4, OBS-83).
 *
 * Constraints (CPO/OBS-82): ONE lightweight prompt per entry; skippable;
 * disableable; NO dark patterns; inference runs ON-DEVICE ONLY — the diary
 * plaintext never leaves the device. We store "seen" entry ids locally so the
 * same entry is never prompted twice; entry ids are local device data and are
 * never included in any submission or log line.
 */

const DISABLED_KEY = "mydaywas.followup.disabled.v1";
const SEEN_KEY = "mydaywas.followup.seen.v1";

export function isFollowUpDisabled(storage: Storage): boolean {
  // default: enabled (but prompt only appears after a save, one per entry,
  // and is instantly skippable/disableable)
  return storage.getItem(DISABLED_KEY) === "true";
}

export function setFollowUpDisabled(storage: Storage, disabled: boolean): void {
  storage.setItem(DISABLED_KEY, disabled ? "true" : "false");
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

/** Prompt at most once per entry, and never when disabled. */
export function shouldPromptFor(storage: Storage, entryId: string): boolean {
  if (isFollowUpDisabled(storage)) return false;
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