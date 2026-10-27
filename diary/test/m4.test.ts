import { describe, expect, it, beforeEach } from "vitest";
import { getSignalsOptIn, revokeSignals, setSignalsOptIn } from "../src/signals/settings";
import { buildSignalPayload, getContributorToken, rotateContributorToken } from "../src/signals/submit";
import { SIGNAL_DISCLOSURE } from "../src/signals/disclosure";
import { isFollowUpDisabled, markPrompted, onDeviceFollowUp, setFollowUpDisabled, shouldPromptFor, skipPrompt } from "../src/followup/prompt";
import { getReferralPseudonym, rotateReferralPseudonym } from "../src/referral/pseudonym";
import {
  REFERRAL_FIELDS,
  SPECIAL_CATEGORY_FIELD,
  getReferralConsent,
  revokeReferral,
  setReferralConsent,
  type ReferralConsent,
} from "../src/referral/consent";
import { PURGE_AFTER_DAYS, buildReferralItem, clearQueue, enqueue, purge } from "../src/referral/queue";
import { utcDay } from "../src/app/api";

const DAY = 20_000;
const DAYMS = DAY * 86_400_000;

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

describe("anonymous signals opt-in (default-off, revocable, separate)", () => {
  let s: Storage;
  beforeEach(() => { s = new MemStorage(); });

  it("defaults to OFF", () => {
    expect(getSignalsOptIn(s).enabled).toBe(false);
  });

  it("opt-in persists, is readable, and revocation turns it off", () => {
    setSignalsOptIn(s, true, DAYMS);
    expect(getSignalsOptIn(s).enabled).toBe(true);
    revokeSignals(s, DAYMS + 3_600_000);
    expect(getSignalsOptIn(s).enabled).toBe(false);
  });

  it("stores day-resolution only — no precise timestamps", () => {
    setSignalsOptIn(s, true, DAYMS + 12 * 3_600_000);
    const rec = JSON.parse(s.getItem("mydaywas.signals.optin.v1")!);
    expect(rec.updatedDay).toBe(DAY);
    expect(JSON.stringify(rec)).not.toContain(String(DAYMS + 12 * 3_600_000));
  });

  it("contributor token is device-generated, rotatable, and not a wallet address", () => {
    const t1 = getContributorToken(s);
    expect(t1).toMatch(/^sig_[0-9a-f]{32,}$/);
    const t2 = rotateContributorToken(s);
    expect(t2).not.toBe(t1);
    expect(getContributorToken(s)).toBe(t2);
  });

  it("payload carries ONLY (sentiment, dayId) + token", () => {
    const p = buildSignalPayload("NEGATIVE", getContributorToken(s), DAYMS);
    expect(Object.keys(p).sort()).toEqual(["contributorToken", "dayId", "sentiment", "v"]);
    expect(p.dayId).toBe(DAY);
    expect(p.sentiment).toBe("NEGATIVE");
    expect(JSON.stringify(p)).not.toContain("0x");
  });

  it("disclosure is plain language and states what is and is not shared", () => {
    expect(SIGNAL_DISCLOSURE).toMatch(/not shared/i);
    expect(SIGNAL_DISCLOSURE).toMatch(/at least/i);
  });
});

describe("follow-up prompt (one per entry, skippable, disableable)", () => {
  let s: Storage;
  beforeEach(() => { s = new MemStorage(); });

  it("prompts once per entry, skip counts as prompted", () => {
    expect(shouldPromptFor(s, "e1")).toBe(true);
    markPrompted(s, "e1");
    expect(shouldPromptFor(s, "e1")).toBe(false);
    skipPrompt(s, "e2");
    expect(shouldPromptFor(s, "e2")).toBe(false);
    expect(shouldPromptFor(s, "e3")).toBe(true);
  });

  it("disabled means never prompt, default is enabled", () => {
    expect(isFollowUpDisabled(s)).toBe(false);
    setFollowUpDisabled(s, true);
    expect(isFollowUpDisabled(s)).toBe(true);
    expect(shouldPromptFor(s, "e9")).toBe(false);
  });

  it("inference is on-device only and derives from the sentiment tag", () => {
    const q = onDeviceFollowUp({ sentiment: "POSITIVE" });
    expect(q.question).toContain("?");
    expect(Object.keys(q)).toEqual(["question", "placeholder"]);
  });
});

describe("referral stub consent (field-level, special tick, purge, revoke)", () => {
  let s: Storage;
  beforeEach(() => { s = new MemStorage(); });

  const fullOn: ReferralConsent = {
    v: 1,
    referralEnabled: true,
    fields: { moodSummary: true, topicTag: true },
    specialCategory: { [SPECIAL_CATEGORY_FIELD]: true },
    specialCategoryTick: true,
    grantedDay: 0,
  };

  it("pseudonym is separate from wallet, and rotation changes it", () => {
    const p = getReferralPseudonym(s);
    expect(p).toMatch(/^ref_[0-9a-f]{32,}$/);
    expect(rotateReferralPseudonym(s)).not.toBe(p);
  });

  it("special-category field requires its own explicit tick", () => {
    expect(() =>
      setReferralConsent(s, { ...fullOn, specialCategoryTick: false }, DAYMS),
    ).toThrowError(/explicit tick/);
  });

  it("field-level consent: fields can be toggled independently", () => {
    setReferralConsent(s, { ...fullOn, fields: { moodSummary: true, topicTag: false } }, DAYMS);
    const c = getReferralConsent(s);
    expect(c?.fields.moodSummary).toBe(true);
    expect(c?.fields.topicTag).toBe(false);
  });

  it("queue items carry only consented fields under the referral pseudonym", () => {
    setReferralConsent(s, fullOn, DAYMS);
    const item = buildReferralItem(fullOn, getReferralPseudonym(s), { sentiment: "POSITIVE", topic: "work" }, DAYMS);
    expect(item.pseudonym).toMatch(/^ref_/);
    expect(Object.keys(item.data).sort()).toEqual([SPECIAL_CATEGORY_FIELD, ...REFERRAL_FIELDS].sort());
    // no diary plaintext / entry ids in queue items
    expect(JSON.stringify(item)).not.toMatch(/text|entryId/i);

    // partial consent drops the un-consented fields entirely
    const partial = buildReferralItem(
      { ...fullOn, fields: { moodSummary: false, topicTag: true }, specialCategory: { [SPECIAL_CATEGORY_FIELD]: false }, specialCategoryTick: false },
      "ref_x",
      { sentiment: "NEUTRAL", topic: "work" },
      DAYMS,
    );
    expect(Object.keys(partial.data)).toEqual(["topicTag"]);
  });

  it("queue purges items older than 30 days", () => {
    setReferralConsent(s, fullOn, DAYMS);
    const old = buildReferralItem(fullOn, "ref_old", { sentiment: "POSITIVE" }, (DAY - 31) * 86_400_000);
    const fresh = buildReferralItem(fullOn, "ref_new", { sentiment: "POSITIVE" }, DAYMS);
    enqueue(s, old);
    enqueue(s, fresh);
    expect(PURGE_AFTER_DAYS).toBe(30);
    const purged = purge(s, DAYMS);
    expect(purged).toBe(1);
    const remaining = JSON.parse(s.getItem("mydaywas.referral.queue.v1")!) as unknown[];
    expect(remaining).toHaveLength(1);
  });

  it("revoke clears the queue and consent, day-resolution only", () => {
    setReferralConsent(s, fullOn, DAYMS);
    enqueue(s, buildReferralItem(fullOn, "ref_x", { sentiment: "POSITIVE" }, DAYMS));
    revokeReferral(s, DAYMS + 3_600_000);
    const c = getReferralConsent(s);
    expect(c?.referralEnabled).toBe(false);
    expect(c?.fields.moodSummary).toBe(false);
    expect(c?.specialCategory[SPECIAL_CATEGORY_FIELD]).toBe(false);
    expect(c?.grantedDay).toBe(DAY);
    clearQueue(s);
    expect(s.getItem("mydaywas.referral.queue.v1")).toBeNull();
  });

  it("no precise timestamps anywhere in consent/queue records", () => {
    setReferralConsent(s, fullOn, DAYMS + 12 * 3_600_000);
    enqueue(s, buildReferralItem(fullOn, "ref_t", { sentiment: "POSITIVE" }, DAYMS + 12 * 3_600_000));
    const blob = [
      s.getItem("mydaywas.referral.consent.v1"),
      s.getItem("mydaywas.referral.queue.v1"),
    ].join(" ");
    expect(blob).not.toContain(String(DAYMS + 12 * 3_600_000));
    expect(utcDay(DAYMS + 12 * 3_600_000)).toBe(DAY);
  });
});