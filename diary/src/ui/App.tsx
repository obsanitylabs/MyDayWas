import React, { useCallback, useEffect, useRef, useState } from "react";
import { Diary, utcDay, type DecryptedEntry, type Sentiment } from "../app/api";
import { connectAccounts, getInjectedProvider } from "../auth/wallet";
import { log } from "../log";
import { getSignalsOptIn, revokeSignals, setSignalsOptIn } from "../signals/settings";
import { SIGNAL_DISCLOSURE, SIGNALS_TITLE, SIGNALS_TITLE_HINT } from "../signals/disclosure";
import { buildSignalPayload, getContributorToken, httpTransport, rotateContributorToken } from "../signals/submit";
import { isFollowUpEnabled, markPrompted, onDeviceFollowUp, setFollowUpEnabled, shouldPromptFor, skipPrompt } from "../followup/prompt";
import { getReferralPseudonym, rotateReferralPseudonym } from "../referral/pseudonym";
import {
  REGIONS,
  SPECIAL_CATEGORY_FIELDS,
  getReferralConsent,
  revokeReferral,
  setReferralConsent,
  type ReferralConsent,
  type ReferralRegion,
  type ReferralSpecialField,
} from "../referral/consent";
import { buildReferralItem, clearQueue, enqueue, purge } from "../referral/queue";
import {
  BETA_ACK_KEY,
  BETA_ACK_LABEL,
  BETA_NOTICE,
  BETA_PRIVACY,
  BETA_TERMS,
  REFERRAL_LABELS,
  SIGNALS_BETA_LINE,
} from "../legal/betaCopy";

const SENTIMENTS: Sentiment[] = ["POSITIVE", "NEGATIVE", "NEUTRAL"];

function dayLabel(day: number): string {
  const d = new Date(day * 86_400_000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function App(): React.ReactElement {
  const [diary, setDiary] = useState<Diary | null>(null);
  const [entries, setEntries] = useState<DecryptedEntry[]>([]);
  const [text, setText] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>("NEUTRAL");
  const [status, setStatus] = useState("checking device vault…");
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const bootRef = useRef(false);

  // M4: anonymous signals, follow-up prompt, referral stub
  const storage = globalThis.localStorage;
  const [signalsOn, setSignalsOn] = useState(() => getSignalsOptIn(storage).enabled);
  const [signalStatus, setSignalStatus] = useState<string>("");
  const [followUp, setFollowUp] = useState<{ id: string; sentiment: Sentiment } | null>(null);
  // Follow-up is OFF BY DEFAULT (spec rev 3 §5.1, CPO decision 2026-10-27):
  // opt in from Settings; no prompt appears until then.
  const [followUpEnabled, setFollowUpEnabledState] = useState(() => isFollowUpEnabled(storage));
  const [followUpText, setFollowUpText] = useState("");
  const [refConsent, setRefConsentState] = useState<ReferralConsent>(() => getReferralConsent(storage));
  const [refStatus, setRefStatus] = useState<string>("");
  // M6 (OBS-229 clearance §2.1/§3.1): blocking, not pre-ticked 18+ beta gate.
  const [betaAck, setBetaAck] = useState(() => storage.getItem(BETA_ACK_KEY) === "1");
  const ackBeta = () => {
    storage.setItem(BETA_ACK_KEY, "1");
    setBetaAck(true);
  };

  const refresh = useCallback(async (d: Diary) => {
    setEntries(await d.listEntries());
    setHasBackup(await d.hasPassphraseBackup());
  }, []);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    void (async () => {
      try {
        const d = await Diary.unlock();
        if (d) {
          setDiary(d);
          await refresh(d);
          const n = await d.reconcile();
          await refresh(d);
          setStatus(n > 0 ? "unlocked and synced" : "unlocked");
        } else {
          setStatus("no diary on this device yet");
        }
      } catch (e) {
        setErr(String(e));
        setStatus("");
      }
    })();
  }, [refresh]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!diary) return;
    return diary.scheduleFlush();
  }, [diary]);

  const onboard = async () => {
    setErr(null);
    setBusy(true);
    try {
      const provider = getInjectedProvider();
      if (!provider) throw new Error("No EIP-1193 wallet detected in this browser.");
      const [address] = await connectAccounts(provider);
      const d = await Diary.onboard(provider, address);
      setDiary(d);
      await refresh(d);
      setStatus("onboarded");
      log("app", "onboard complete");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!diary || !text.trim()) return;
    setBusy(true);
    try {
      const saved = await diary.addEntry(text, sentiment);
      setText("");
      await refresh(diary);
      setStatus(online ? "saved locally; will sync" : "saved locally (offline)");
      // M4: one lightweight follow-up prompt per entry — ONLY after the
      // Settings opt-in (default off), skippable/disableable, on-device only.
      if (shouldPromptFor(storage, saved.id)) {
        markPrompted(storage, saved.id);
        setFollowUp({ id: saved.id, sentiment: saved.sentiment });
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- M4: anonymous signals ----
  const RELAYER_URL = import.meta.env.VITE_RELAYER_URL as string | undefined;
  const toggleSignals = async (on: boolean) => {
    setSignalsOptIn(storage, on);
    setSignalsOn(on);
    if (!on) {
      rotateContributorToken(storage);
      setSignalStatus("Off — sharing stopped and your signal pseudonym was rotated.");
    } else {
      setSignalStatus("");
    }
  };
  const shareSignal = async () => {
    if (!diary || !signalsOn) return;
    setBusy(true);
    try {
      // Signal source: derive from the LATEST SAVED ENTRY for today — the
      // signal must reflect what was actually saved, not the compose selector.
      const today = utcDay(Date.now());
      const todays = entries.filter((e) => e.day === today);
      if (todays.length === 0) {
        setSignalStatus(
          "No saved entry for today yet. The signal is derived from your saved entry's sentiment tag, so save today's entry first.",
        );
        return;
      }
      const savedSentiment = todays[todays.length - 1].sentiment;
      const payload = buildSignalPayload(savedSentiment, getContributorToken(storage));
      if (RELAYER_URL) {
        await httpTransport(RELAYER_URL).submit(payload);
        // Staging honesty: the relayer runs dry-run on staging; acceptance is
        // NOT publication. Never claim "sent/published" here.
        setSignalStatus(
          `Accepted by the relayer (staging dry-run; not published) — only "${payload.sentiment}" and today's UTC day.`,
        );
      } else {
        // Honest staging behavior: never pretend a send happened.
        setSignalStatus("Prepared, but not sent: no relayer URL is configured on this staging build.");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- M4: follow-up prompt ----
  const answerFollowUp = async () => {
    if (!diary || !followUp || !followUpText.trim()) return;
    setBusy(true);
    try {
      await diary.addEntry(followUpText, followUp.sentiment);
      setFollowUp(null);
      setFollowUpText("");
      await refresh(diary);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggleFollowUps = (on: boolean) => {
    setFollowUpEnabled(storage, on);
    setFollowUpEnabledState(on);
    if (!on) {
      // Toggling off hides all unanswered prompts; drafts are discarded.
      setFollowUp(null);
      setFollowUpText("");
    }
  };

  // ---- M4: referral stub (spec rev 3 §6.4 staging field set) ----
  // Every field starts UNTICKED. Each special-category health field needs its
  // OWN separate explicit confirmation (a confirmation dialog), structurally
  // enforced in consent.ts. Contact method is required before sending.
  const [contactType, setContactType] = useState<"email" | "phone">("email");
  const [contactValue, setContactValue] = useState("");
  const [region, setRegion] = useState<ReferralRegion>("EU");

  const updateRefConsent = (patch: Partial<ReferralConsent>) => {
    const next = { ...refConsent, ...patch } as ReferralConsent;
    try {
      setReferralConsent(storage, next);
      setRefConsentState(getReferralConsent(storage));
      setRefStatus("");
    } catch (e) {
      setErr(String(e));
    }
  };

  /** Ticking a special-category field opens its OWN confirmation. */
  const tickSpecial = (f: ReferralSpecialField, on: boolean) => {
    if (!on) {
      updateRefConsent({
        specialCategory: { ...refConsent.specialCategory, [f]: false },
        specialConfirmed: { ...refConsent.specialConfirmed, [f]: false },
      });
      return;
    }
    const label =
      f === "exercise" ? "Information about your exercise"
      : f === "medication" ? "Information about your medication"
      : f === "healthMood" ? "Mood framed as a health concern"
      : "That you are in crisis and need urgent help";
    const crisisSignpost =
      f === "crisis"
        ? `If you are in immediate danger, contact your local emergency number now. The staging placeholder partner is not an emergency service. We do not monitor your entries or your request.\n\n`
        : "";
    const ok = window.confirm(
      `${crisisSignpost}Confirm sensitive health sharing\n\n` +
        `I agree to send this health information to the staging placeholder partner for this request only. This is sensitive health data.\n\n` +
        `Field: ${f} — ${label}.`,
    );
    if (!ok) return; // cancel leaves the field unticked
    updateRefConsent({
      specialCategory: { ...refConsent.specialCategory, [f]: true },
      specialConfirmed: { ...refConsent.specialConfirmed, [f]: true },
    });
  };

  // ---- M4: referral stub — pre-send review ----
  // Legal rev 3 / spec rev 3 §6.5: the user must SEE exactly what will be
  // shared (partner, purpose, exact field values) before anything is queued,
  // and "Send request" is gated on the required contact method being ticked.
  const enqueueReferralItem = useCallback(() => {
    const c = getReferralConsent(storage);
    if (!c.referralEnabled) {
      setRefStatus("Enable the referral consent first.");
      return;
    }
    if (!c.fields.contactMethod) {
      setRefStatus("Add a contact method so the partner can reply — it is required before sending.");
      return;
    }
    if (!contactValue.trim()) {
      setRefStatus("Enter the contact detail (email or phone) before sending.");
      return;
    }
    const item = buildReferralItem(c, getReferralPseudonym(storage), { type: contactType, value: contactValue }, region);
    // OBS-229 clearance §2.4/§3.3: preview shows plain labels, not raw field keys.
    const preview = Object.entries(item.data)
      .map(([k, v]) => `  • ${REFERRAL_LABELS[k] ?? k}: ${v}`)
      .join("\n");
    const ok = window.confirm(
      `Queue this referral for a curated partner?\n\n` +
        `Partner purpose: reach out to you about mood-support resources (preview stub — no delivery yet; not a live partner).\n\n` +
        `Under your separate referral pseudonym, these EXACT values would be shared:\n\n${preview}\n\n` +
        `The queue purges within 30 days. Continue?`,
    );
    if (!ok) {
      setRefStatus("Not queued — you cancelled before anything was shared.");
      return;
    }
    enqueue(storage, item);
    purge(storage); // retention cap enforced at every queue operation too
    setRefStatus(
      "Queued (stub) — nothing is delivered; the queue purges within 30 days and is purged automatically on load.",
    );
  }, [contactType, contactValue, region, storage]);

  // Legal retention cap (≤30 days) is enforced AUTOMATICALLY on load and on
  // every queue operation — never only behind a user-triggered button.
  useEffect(() => {
    const n = purge(storage);
    if (n > 0) setRefStatus(`Purged ${n} expired referral queue item(s) automatically on load.`);
  }, [storage]);

  const del = async (id: string) => {
    if (!diary) return;
    await diary.deleteEntry(id);
    await refresh(diary);
  };

  const exportJson = async () => {
    if (!diary) return;
    download("mydaywas-export.json", await diary.exportJSON(), "application/json");
    log("export", "plaintext JSON export downloaded");
  };

  const exportBackup = async () => {
    if (!diary) return;
    try {
      download("mydaywas-backup.json", await diary.exportEncryptedBackup(), "application/json");
    } catch (e) {
      setErr(String(e));
    }
  };

  const changePw = async () => {
    if (!diary) return;
    try {
      await diary.changePassphrase(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setErr(null);
      setStatus("passphrase backup updated");
    } catch (e) {
      setErr(String(e));
    }
  };

  const syncNow = async () => {
    if (!diary) return;
    const n = await diary.reconcile();
    await refresh(diary);
    setStatus(n > 0 ? "synced" : "up to date");
  };

  const deleteAccount = async () => {
    if (!diary) return;
    if (!window.confirm("Delete ALL diary entries and this account's sync ciphertext? This cannot be undone. We will stop your signals, clear your signal queue, and purge any pending partner referrals. It does not change groups already published on-chain. A platform backup outside this app (for example a phone-maker backup) may still hold a copy; if you use one, turn off backup of this app in the platform settings after you delete.")) return;
    await diary.deleteAccount();
    setDiary(null);
    setEntries([]);
    setStatus("account deleted");
  };

  return (
    <div className="app">
      <header className="site">
        <h1>MyDayWas</h1>
        <span className="tag">private diary · v1 (M4 staging)</span>
      </header>

      <div className="card beta">
        <h2>MyDayWas public beta</h2>
        <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{BETA_NOTICE}</p>
        {!betaAck && (
          <div className="row">
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={false} onChange={(e) => { if (e.target.checked) ackBeta(); }} />
              {BETA_ACK_LABEL}
            </label>
          </div>
        )}
        {betaAck && <p className="hint">Accepted: {BETA_ACK_LABEL}</p>}
      </div>

      <details className="card beta-legal">
        <summary>Beta terms of use &amp; privacy notice</summary>
        <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{BETA_TERMS}</p>
        <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{BETA_PRIVACY}</p>
      </details>

      {!betaAck && (
        <div className="card">
          <p className="hint">The diary is unavailable until you confirm the beta notice above.</p>
        </div>
      )}

      {betaAck && (
      <div className="card">
        <p className="hint">
          Entries are encrypted on this device with AES-GCM-256 before they are stored or synced.
          Your wallet is used once at onboarding to derive the key; nothing about your diary or
          wallet is stored on-chain. Sync ciphertext is deleted within 72 hours.
        </p>
        <div className="row status">
          <span className={status.startsWith("unlocked") || status === "onboarded" || status === "synced" ? "ok" : undefined}>
            {status}
          </span>
          <span className="spacer" />
          <span>{online ? "online" : "offline — entries still work"}</span>
          {diary && <button onClick={syncNow}>Sync now</button>}
          {!diary && <button className="primary" onClick={onboard} disabled={busy}>Connect wallet &amp; create diary</button>}
        </div>
        {err && <p className="error">{err}</p>}
      </div>
      )}

      {diary && betaAck && (
        <>
          <div className="card">
            <h2>How was your day?</h2>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write here. Only you can read this — it is encrypted before it leaves the page."
            />
            <div className="row">
              <span className="sentiments">
                {SENTIMENTS.map((s) => (
                  <button key={s} aria-pressed={s === sentiment} onClick={() => setSentiment(s)}>
                    {s.toLowerCase()}
                  </button>
                ))}
              </span>
              <span className="spacer" />
              <button className="primary" onClick={add} disabled={busy || !text.trim()}>Save entry</button>
            </div>
          </div>

          {followUp && followUpEnabled && (
            <div className="card followup">
              <h2>One quick follow-up</h2>
              <p className="hint">{onDeviceFollowUp({ sentiment: followUp.sentiment }).question}</p>
              <textarea
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                placeholder={onDeviceFollowUp({ sentiment: followUp.sentiment }).placeholder}
              />
              <p className="hint">Optional. Only you can read this — it never leaves your device unless you save it as an entry. Inference is on-device only.</p>
              <div className="row">
                <button className="primary" onClick={answerFollowUp} disabled={busy || !followUpText.trim()}>
                  Save as entry
                </button>
                <button onClick={() => { skipPrompt(storage, followUp.id); setFollowUp(null); setFollowUpText(""); }}>
                  Skip
                </button>
                <span className="spacer" />
                <button onClick={() => toggleFollowUps(false)}>Turn off follow-ups</button>
              </div>
            </div>
          )}

          <div className="card settings">
            <h2>Settings · Privacy</h2>
            <p className="hint">
              Signals, follow-ups, and referrals are separate. There is no "agree to everything" control,
              and every optional sharing feature is off by default.
            </p>
            <div className="row">
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={followUpEnabled}
                  onChange={(e) => toggleFollowUps(e.target.checked)}
                />
                Follow-up questions (off by default — opt in here)
              </label>
            </div>
            <p className="hint">
              {followUpEnabled
                ? "One optional reflection prompt after you save an entry. Generated on this device; your answer is encrypted with the entry. You can skip any prompt."
                : "No follow-up prompts. Your saved entries are unchanged. Turn on to get one optional reflection prompt after you save an entry."}
            </p>
          </div>

          <div className="card signals">
            <h2>{SIGNALS_TITLE}</h2>
            <p className="hint">{SIGNALS_TITLE_HINT}</p>
            <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{SIGNALS_BETA_LINE}</p>
            <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{SIGNAL_DISCLOSURE}</p>
            <div className="row">
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={signalsOn}
                  onChange={(e) => void toggleSignals(e.target.checked)}
                />
                Share how my day felt (pseudonymous; published counts are anonymous in aggregate)
              </label>
              <span className="spacer" />
              <button onClick={shareSignal} disabled={busy || !signalsOn}>
                Send today's signal
              </button>
              {signalsOn && <button className="danger" onClick={() => void toggleSignals(false)}>Turn off</button>}
            </div>
            {signalStatus && <p className="hint">{signalStatus}</p>}
          </div>

          <div className="card referral">
            <h2>Partner referral (preview stub)</h2>
            <p className="hint">
              Staging placeholder — not a live partner; no request is delivered anywhere in this preview.
              A separate referral pseudonym is used — never your wallet. Every field starts unticked;
              consent is per field, and each sensitive health field needs its own explicit confirmation.
              Queued items are purged within 30 days, and revocation clears the queue and rotates the pseudonym.
            </p>
            <div className="row">
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={refConsent.referralEnabled}
                  onChange={(e) => updateRefConsent({ referralEnabled: e.target.checked })}
                />
                Let a partner reach me
              </label>
            </div>
            {refConsent.referralEnabled && (
              <>
                <div className="row">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={refConsent.fields.contactMethod}
                      onChange={(e) => updateRefConsent({ fields: { ...refConsent.fields, contactMethod: e.target.checked } })}
                    />
                    Contact method (required — how they can reply)
                  </label>
                  {refConsent.fields.contactMethod && (
                    <span className="sentiments" style={{ display: "flex", gap: 6 }}>
                      <select value={contactType} onChange={(e) => setContactType(e.target.value as "email" | "phone")}>
                        <option value="email">email</option>
                        <option value="phone">phone</option>
                      </select>
                      <input
                        placeholder={contactType === "email" ? "email address" : "phone number"}
                        value={contactValue}
                        onChange={(e) => setContactValue(e.target.value)}
                      />
                    </span>
                  )}
                </div>
                <div className="row">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={refConsent.fields.region}
                      onChange={(e) => updateRefConsent({ fields: { ...refConsent.fields, region: e.target.checked } })}
                    />
                    Region (broad only)
                  </label>
                  {refConsent.fields.region && (
                    <select value={region} onChange={(e) => setRegion(e.target.value as ReferralRegion)}>
                      {REGIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  )}
                </div>
                {SPECIAL_CATEGORY_FIELDS.map((f) => (
                  <div className="row" key={f}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={refConsent.specialCategory[f]}
                        onChange={(e) => tickSpecial(f, e.target.checked)}
                      />
                      {REFERRAL_LABELS[f]} (own confirmation)
                    </label>
                  </div>
                ))}
                {refConsent.specialCategory.crisis && (
                  <p className="hint">
                    If you are in immediate danger, contact your local emergency number now. The staging
                    placeholder partner is not an emergency service. We do not monitor your entries or your request.
                  </p>
                )}
                <p className="hint">
                  Referral pseudonym: <code>{getReferralPseudonym(storage).slice(0, 12)}…</code>{" "}
                  (separate from your wallet)
                </p>
              </>
            )}
            <div className="row">
              <button onClick={enqueueReferralItem} disabled={!refConsent.referralEnabled || !refConsent.fields.contactMethod || !contactValue.trim()}>
                Queue preview (not delivered)
              </button>
              <button onClick={() => { const n = purge(storage); setRefStatus(`Purged ${n} expired queue item(s).`); }}>
                Purge queue now
              </button>
              <span className="spacer" />
              <button
                className="danger"
                onClick={() => {
                  revokeReferral(storage);
                  clearQueue(storage);
                  rotateReferralPseudonym(storage);
                  setRefConsentState(getReferralConsent(storage));
                  setRefStatus("Referral consent revoked: queue cleared, pseudonym rotated.");
                }}
              >
                Revoke referral consent
              </button>
            </div>
            {refStatus && <p className="hint">{refStatus}</p>}
          </div>

          <div className="card">
            <h2>Your diary ({entries.length})</h2>
            {entries.length === 0 && <p className="hint">No entries yet.</p>}
            {Object.entries(
              entries.reduce<Record<number, DecryptedEntry[]>>((acc, e) => {
                (acc[e.day] ??= []).push(e);
                return acc;
              }, {}),
            )
              .sort((a, b) => Number(b[0]) - Number(a[0]))
              .map(([day, list]) => (
                <div className="daygroup" key={day}>
                  <div className="daylabel">{dayLabel(Number(day))}</div>
                  {list.map((e) => (
                    <div className="entry" key={e.id}>
                      <div className="meta">
                        <span className={"sent " + e.sentiment}>{e.sentiment.toLowerCase()}</span>
                        <span className="spacer" />
                        <button className="danger" onClick={() => del(e.id)}>Delete</button>
                      </div>
                      <p className="text">{e.text}</p>
                    </div>
                  ))}
                </div>
              ))}
          </div>

          <div className="card">
            <h2>Export &amp; recovery</h2>
            <div className="row">
              <button onClick={exportJson}>Export plaintext JSON</button>
              <button onClick={exportBackup} disabled={!hasBackup}>Export encrypted backup</button>
            </div>
            <p className="hint">
              {hasBackup
                ? "A passphrase-wrapped key backup exists on this account."
                : "No passphrase backup set on this device (it can only be set at onboarding in v1)."}
            </p>
            <p className="hint">
              Recovery trade-offs you should know: your diary key is derived from your wallet.
              If someone obtains <strong>both your wallet seed and your sync account access</strong>,
              they can re-derive your key and decrypt your diary. And if you lose{" "}
              <strong>your device, your passphrase backup, and your wallet</strong> at the same time,
              your diary cannot be recovered by anyone — keep at least one of the three safe.
            </p>
            <details className="backup">
              <summary>Change passphrase</summary>
              <div className="row">
                <input type="password" placeholder="current passphrase" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
                <input type="password" placeholder="new passphrase" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                <button onClick={changePw} disabled={!oldPw || !newPw}>Update</button>
              </div>
            </details>
            <div className="row">
              <span className="spacer" />
              <button className="danger" onClick={deleteAccount}>Delete account…</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}