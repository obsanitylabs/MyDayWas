import React from "react";
import {
  REGIONS,
  SPECIAL_CATEGORY_FIELDS,
  type ReferralConsent,
  type ReferralRegion,
  type ReferralSpecialField,
} from "../referral/consent";
import { REFERRAL_LABELS } from "../legal/betaCopy";

export interface HandViewProps {
  consent: ReferralConsent;
  contactType: "email" | "phone";
  contactValue: string;
  region: ReferralRegion;
  status: string;
  pseudonym: string;
  onConsentChange: (patch: Partial<ReferralConsent>) => void;
  onToggleSpecial: (field: ReferralSpecialField, on: boolean) => void;
  onContactTypeChange: (type: "email" | "phone") => void;
  onContactValueChange: (value: string) => void;
  onRegionChange: (region: ReferralRegion) => void;
  onQueue: () => void;
  onPurge: () => void;
  onRevoke: () => void;
}

/**
 * HAND view — the partner / services help page. This is the existing referral
 * preview stub lifted out of the single screen, unchanged in behaviour: nothing
 * is delivered in this staging build, consent is per field, and each sensitive
 * health field needs its own explicit confirmation.
 */
export function HandView(props: HandViewProps): React.ReactElement {
  const { consent, contactType, contactValue, region, status, pseudonym } = props;

  return (
    <section className="view hand-view" aria-label="Partner and services help">
      <h2 className="view-title">A hand, if you want one</h2>
      <p className="hint">
        This is the partner / services corner. In this build it is a preview stub — no request is
        delivered anywhere yet. If something urgent is happening, use your local services; this page
        is not monitored and is not an emergency channel.
      </p>

      <div className="card referral">
        <h3>Partner referral (preview stub)</h3>
        <p className="hint">
          A separate referral pseudonym is used — never your wallet. Every field starts unticked;
          consent is per field, and each sensitive health field needs its own explicit confirmation.
          Queued items are purged within 30 days, and revoking clears the queue and rotates the pseudonym.
        </p>
        <div className="row">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={consent.referralEnabled}
              onChange={(e) => props.onConsentChange({ referralEnabled: e.target.checked })}
            />
            Let a partner reach me
          </label>
        </div>
        {consent.referralEnabled && (
          <>
            <div className="row">
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={consent.fields.contactMethod}
                  onChange={(e) => props.onConsentChange({ fields: { ...consent.fields, contactMethod: e.target.checked } })}
                />
                Contact method (required — how they can reply)
              </label>
              {consent.fields.contactMethod && (
                <span className="sentiments" style={{ display: "flex", gap: 6 }}>
                  <select value={contactType} onChange={(e) => props.onContactTypeChange(e.target.value as "email" | "phone")}>
                    <option value="email">email</option>
                    <option value="phone">phone</option>
                  </select>
                  <input
                    placeholder={contactType === "email" ? "email address" : "phone number"}
                    value={contactValue}
                    onChange={(e) => props.onContactValueChange(e.target.value)}
                  />
                </span>
              )}
            </div>
            <div className="row">
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={consent.fields.region}
                  onChange={(e) => props.onConsentChange({ fields: { ...consent.fields, region: e.target.checked } })}
                />
                Region (broad only)
              </label>
              {consent.fields.region && (
                <select value={region} onChange={(e) => props.onRegionChange(e.target.value as ReferralRegion)}>
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
                    checked={consent.specialCategory[f]}
                    onChange={(e) => props.onToggleSpecial(f, e.target.checked)}
                  />
                  {REFERRAL_LABELS[f]} (own confirmation)
                </label>
              </div>
            ))}
            {consent.specialCategory.crisis && (
              <p className="hint">
                If you are in immediate danger, contact your local emergency number now. The staging
                placeholder partner is not an emergency service. We do not monitor your entries or your request.
              </p>
            )}
            <p className="hint">
              Referral pseudonym: <code>{pseudonym.slice(0, 12)}…</code> (separate from your wallet)
            </p>
          </>
        )}
        <div className="row">
          <button
            onClick={props.onQueue}
            disabled={!consent.referralEnabled || !consent.fields.contactMethod || !contactValue.trim()}
          >
            Queue preview (not delivered)
          </button>
          <button onClick={props.onPurge}>Purge queue now</button>
          <span className="spacer" />
          <button className="danger" onClick={props.onRevoke}>
            Revoke referral consent
          </button>
        </div>
        {status && <p className="hint">{status}</p>}
      </div>
    </section>
  );
}
