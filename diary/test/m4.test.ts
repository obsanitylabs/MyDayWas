import { describe, expect, it, beforeEach } from "vitest";
import { getSignalsOptIn, revokeSignals, setSignalsOptIn } from "../src/signals/settings";
import { buildSignalPayload, getContributorToken, rotateContributorToken } from "../src/signals/submit";
import { SIGNAL_DISCLOSURE, SIGNALS_TITLE, SIGNALS_TITLE_HINT } from "../src/signals/disclosure";
import { isFollowUpEnabled, markPrompted, onDeviceFollowUp, setFollowUpEnabled, shouldPromptFor, skipPrompt } from "../src/followup/prompt";
import { getReferralPseudonym, rotateReferralPseudonym } from "../src/referral/pseudonym";
import {
  REFERRAL_FIELDS,
  REGIONS,
  SPECIAL_CATEGORY_FIELDS,
  emptyReferralConsent,
  getReferralConsent,
  revokeReferral,
  setReferralConsent,
  type ReferralConsent,
  type ReferralSpecialField,
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

  // Legal rev 3 (CPO review 2026-10-27): no linkage-impossibility overclaim;
  // anonymity is claimed only for the published aggregate; the purpose-specific
  // contributor token is disclosed; "before it is published", not "before
  // anyone sees it".
  it("disclosure does not overclaim anonymity and discloses the signal token", () => {
    expect(SIGNAL_DISCLOSURE).not.toMatch(/cannot be matched back/i);
    expect(SIGNAL_DISCLOSURE).not.toMatch(/before anyone sees it/i);
    expect(SIGNAL_DISCLOSURE).toMatch(/designed to make .*hard/i);
    expect(SIGNAL_DISCLOSURE).toMatch(/we do not claim it is impossible/i);
    expect(SIGNAL_DISCLOSURE).toMatch(/before it is published/i);
    expect(SIGNAL_DISCLOSURE).toMatch(/purpose-specific signal token/i);
    expect(SIGNAL_DISCLOSURE).toMatch(/100 different people/);
    expect(SIGNAL_DISCLOSURE).toMatch(/24 hours/);
  });

  // Spec rev 3 (ux-consent-spec-m4, OBS-84): user-facing name is
  // "Aggregated signals"; "anonymous" applies only to published groups.
  it("UI title/hint use the spec's Aggregated signals naming", () => {
    expect(SIGNALS_TITLE).toBe("Aggregated signals");
    expect(SIGNALS_TITLE_HINT).toMatch(/Off by default/i);
    expect(SIGNALS_TITLE_HINT).toMatch(/100 different people/i);
    expect(SIGNALS_TITLE_HINT).toMatch(/pseudonymous, not anonymous/i);
  });
});

describe("follow-up prompt (default OFF, one per entry, skippable, opt-in)", () => {
  let s: Storage;
  beforeEach(() => { s = new MemStorage(); });

  it("defaults to OFF — no prompt until the Settings opt-in (spec §5.1)", () => {
    expect(isFollowUpEnabled(s)).toBe(false);
    expect(shouldPromptFor(s, "e1")).toBe(false);
  });

  it("opt-in enables prompts; one prompt per entry; skip counts as prompted", () => {
    setFollowUpEnabled(s, true);
    expect(isFollowUpEnabled(s)).toBe(true);
    expect(shouldPromptFor(s, "e1")).toBe(true);
    markPrompted(s, "e1");
    expect(shouldPromptFor(s, "e1")).toBe(false);
    skipPrompt(s, "e2");
    expect(shouldPromptFor(s, "e2")).toBe(false);
    expect(shouldPromptFor(s, "e3")).toBe(true);
  });

  it("toggling off stops all prompts without deleting the seen history", () => {
    setFollowUpEnabled(s, true);
    markPrompted(s, "e1");
    setFollowUpEnabled(s, false);
    expect(shouldPromptFor(s, "e4")).toBe(false);
    setFollowUpEnabled(s, true);
    expect(shouldPromptFor(s, "e1")).toBe(false); // no resurrect / no re-prompt
    expect(shouldPromptFor(s, "e5")).toBe(true);
  });

  it("inference is on-device only and derives from the sentiment tag", () => {
    const q = onDeviceFollowUp({ sentiment: "POSITIVE" });
    expect(q.question).toContain("?");
    expect(Object.keys(q)).toEqual(["question", "placeholder"]);
  });
});

describe("referral stub consent (spec rev 3 §6.4 staging field set)", () => {
  let s: Storage;
  beforeEach(() => { s = new MemStorage(); });

  const fullOn: ReferralConsent = {
    ...emptyReferralConsent(),
    referralEnabled: true,
    fields: { contactMethod: true, region: true },
    specialCategory: { exercise: true, medication: true, healthMood: true, crisis: true },
    specialConfirmed: { exercise: true, medication: true, healthMood: true, crisis: true },
  };

  it("pseudonym is separate from wallet, and rotation changes it", () => {
    const p = getReferralPseudonym(s);
    expect(p).toMatch(/^ref_[0-9a-f]{32,}$/);
    expect(rotateReferralPseudonym(s)).not.toBe(p);
  });

  it("staging field set matches the spec: contactMethod+region and 4 special fields", () => {
    expect([...REFERRAL_FIELDS].sort()).toEqual(["contactMethod", "region"]);
    expect([...SPECIAL_CATEGORY_FIELDS].sort()).toEqual(["crisis", "exercise", "healthMood", "medication"]);
    expect([...REGIONS]).toContain("EU");
  });

  it("every field starts unticked and default consent is fully off", () => {
    const c = getReferralConsent(s);
    expect(c.referralEnabled).toBe(false);
    expect(Object.values(c.fields)).toEqual([false, false]);
    expect(Object.values(c.specialCategory)).toEqual([false, false, false, false]);
    expect(Object.values(c.specialConfirmed)).toEqual([false, false, false, false]);
  });

  it("each special-category field requires its OWN explicit confirmation", () => {
    const partial: ReferralSpecialField = "medication";
    expect(() =>
      setReferralConsent(s, {
        ...fullOn,
        specialConfirmed: { ...fullOn.specialConfirmed, [partial]: false },
      }, DAYMS),
    ).toThrowError(/own explicit confirmation/);
  });

  it("unchecking a special field withdraws its confirmation (re-tick needs a new confirm)", () => {
    setReferralConsent(s, fullOn, DAYMS);
    const c = getReferralConsent(s);
    const next: ReferralConsent = {
      ...c,
      specialCategory: { ...c.specialCategory, exercise: false },
      specialConfirmed: { ...c.specialConfirmed, exercise: false },
    };
    setReferralConsent(s, next, DAYMS);
    expect(getReferralConsent(s).specialCategory.exercise).toBe(false);
    expect(getReferralConsent(s).specialConfirmed.exercise).toBe(false);
  });

  it("queue items carry only consented fields under the referral pseudonym", () => {
    setReferralConsent(s, fullOn, DAYMS);
    const item = buildReferralItem(fullOn, getReferralPseudonym(s), { type: "email", value: "a@b.co" }, "EU", DAYMS);
    expect(item.pseudonym).toMatch(/^ref_/);
    expect(Object.keys(item.data).sort()).toEqual(
      ["contactType", "contactValue", "crisis", "exercise", "healthMood", "medication", "region"].sort(),
    );
    expect(item.data.region).toBe("EU");
    expect(item.data.contactValue).toBe("a@b.co");
    // no diary plaintext / entry ids in queue items
    expect(JSON.stringify(item)).not.toMatch(/text|entryId/i);

    // partial consent drops the un-consented fields entirely
    const partial = buildReferralItem(
      { ...fullOn, fields: { contactMethod: true, region: false }, specialCategory: { ...fullOn.specialCategory, crisis: false } },
      "ref_x",
      { type: "phone", value: "+1 555" },
      undefined,
      DAYMS,
    );
    expect(Object.keys(partial.data).sort()).toEqual(["contactType", "contactValue", "exercise", "healthMood", "medication"].sort());
  });

  it("no consented fields ⇒ item carries zero shared values", () => {
    const noneOn = emptyReferralConsent();
    const item = buildReferralItem(noneOn, getReferralPseudonym(s), { type: "email", value: "a@b.co" }, "EU", DAYMS);
    expect(Object.keys(item.data)).toHaveLength(0);
  });

  it("queue purges items older than 30 days", () => {
    setReferralConsent(s, fullOn, DAYMS);
    const old = buildReferralItem(fullOn, "ref_old", { type: "email", value: "a@b.co" }, undefined, (DAY - 31) * 86_400_000);
    const fresh = buildReferralItem(fullOn, "ref_new", { type: "email", value: "a@b.co" }, undefined, DAYMS);
    enqueue(s, old);
    enqueue(s, fresh);
    expect(PURGE_AFTER_DAYS).toBe(30);
    const purged = purge(s, DAYMS);
    expect(purged).toBe(1);
    const remaining = JSON.parse(s.getItem("mydaywas.referral.queue.v1")!) as unknown[];
    expect(remaining).toHaveLength(1);
  });

  it("revoke clears consent (all fields), day-resolution only", () => {
    setReferralConsent(s, fullOn, DAYMS);
    enqueue(s, buildReferralItem(fullOn, "ref_x", { type: "email", value: "a@b.co" }, undefined, DAYMS));
    revokeReferral(s, DAYMS + 3_600_000);
    const c = getReferralConsent(s);
    expect(c.referralEnabled).toBe(false);
    expect(c.fields.contactMethod).toBe(false);
    expect(Object.values(c.specialCategory)).toEqual([false, false, false, false]);
    expect(c.grantedDay).toBe(DAY);
    clearQueue(s);
    expect(s.getItem("mydaywas.referral.queue.v1")).toBeNull();
  });

  it("no precise timestamps anywhere in consent/queue records", () => {
    setReferralConsent(s, fullOn, DAYMS + 12 * 3_600_000);
    enqueue(s, buildReferralItem(fullOn, "ref_t", { type: "email", value: "a@b.co" }, undefined, DAYMS + 12 * 3_600_000));
    const blob = [
      s.getItem("mydaywas.referral.consent.v1"),
      s.getItem("mydaywas.referral.queue.v1"),
    ].join(" ");
    expect(blob).not.toContain(String(DAYMS + 12 * 3_600_000));
    expect(utcDay(DAYMS + 12 * 3_600_000)).toBe(DAY);
  });
});