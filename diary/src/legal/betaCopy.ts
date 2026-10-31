/**
 * User-facing beta legal copy (M6, OBS-229 — GC beta-legal-clearance-1, 2026-10-31).
 *
 * Verbatim from the clearance document §2 ("User-facing copy set (beta)").
 * DO NOT paraphrase the anonymity, retention, or chain lines (clearance §2
 * preamble). This copy supersedes the draft 0.3 outline, which must NOT be
 * linked as public policy. Do not add an entity name, privacy email, or any
 * certification claim (HIPAA/GDPR/SOC 2) — none exist (clearance §3.5/§3.7/§3.8).
 */

export const BETA_ACK_KEY = "mydaywas.beta.ack.v1";

/** §2.1 First screen — beta notice (required, above the diary). */
export const BETA_NOTICE = `MyDayWas public beta

This is a public preview, not a finished service. It is not medical, psychiatric, crisis, legal, or financial advice, and it is not an emergency service. If you are in immediate danger, contact your local emergency number. We do not read or monitor your diary.

The operator of this beta is not yet a named legal entity. Until that is published here, these terms are the rules of the preview, not a contract with a named company. Contact for privacy requests during the beta: the in-app export and delete controls, plus the support address published with this beta. Do not send diary text to support.

You must be 18 or older. This beta is not directed at children.

Aggregated signals in this beta are not a production chain. The only chain this beta is allowed to use is the Ethereum Sepolia testnet (chain id 11155111). Testnet data is public test data. It can be reset by the network. It is not a mainnet record. The beta relayer may also run in dry-run, which means a signal is accepted for testing and is not written to a chain at all. We will say which of those two is happening on the signals screen. Nothing in this beta authorizes a mainnet deployment.`;

/** §2.1 checkbox label — not pre-ticked, blocking. */
export const BETA_ACK_LABEL = "I am 18 or older and I understand this is a beta on test infrastructure.";

/** §2.4 — paragraph added at the TOP of the signals card (keep the six existing disclosure paragraphs). */
export const SIGNALS_BETA_LINE =
  "Beta: this build does not publish to mainnet. If a relayer URL is set, publication is on the Ethereum Sepolia testnet (chain id 11155111), and only after the group and delay rules below. If no relayer URL is set, the signal is prepared and not sent. A status line must say which of those happened. Testnet counts are public test data and can be reset by the network. Turning this off stops future sharing. It does not edit a count already published.";

/** §2.2 Terms of use — beta (short form). */
export const BETA_TERMS = `MyDayWas Beta Terms of Use

Effective when the beta URL opens. Version: beta-1. Operator: unnamed until the notice on the first screen is updated. Governing law: not chosen. If you are a consumer in the EEA or UK, you keep the mandatory rights of your home country. These terms do not force you into foreign arbitration.

1. What this is. A private diary on your device, an optional on-device follow-up prompt, an optional contribution to aggregated signals, and a referral preview that does not deliver anything to a partner. No token, points, or payment.
2. What this is not. Not medical care, not a crisis line, not a bank, not a money transmitter, not an investment product. We do not promise a partner will ever respond, because no partner is live.
3. Your diary. Entries are encrypted on your device with AES-GCM-256 before they are stored. Your wallet is used to derive the key. We do not hold a copy of that key. We cannot read your entries. We cannot restore them if you lose the key, the device, and any passphrase backup you created.
4. What we do not put on a chain. We do not write your diary text, your wallet address, or a per-user record to a chain. The recovered prototype that did that is not this product.
5. Optional signals. Off unless you turn them on. A published count is a group statistic. It is anonymous only as a group, and only after at least 100 different contributors and a delay until the UTC day has closed (at least 24 hours). Your own contribution is pseudonymous, not anonymous. Turning signals off stops future sharing. It does not edit a count already published.
6. Testnet. Any chain write this beta makes is on Sepolia testnet, or it is not made at all (dry-run). Do not treat a testnet count as a permanent or production record. We still will not pretend we can delete a count after it is published.
7. Referral preview. Off by default. Nothing is delivered. See the privacy notice. No partner is authorized to receive data in this beta.
8. Your content. You keep ownership of your entries. You give us only the technical permission needed for a feature you turned on (for example, holding an encrypted sync blob). No permission to read, sell, or train on your diary text.
9. Acceptable use. Do not try to re-identify a published count. Do not use the beta to harm others or to evade sanctions.
10. Availability and liability. The beta is provided as available, and it will break. To the extent the law allows, we are not liable for lost entries caused by a lost key or a lost device. We do not disclaim liability for a privacy failure caused by our not doing what this notice says we do. Consumer rights that cannot be waived are not waived.
11. Changes. A new data use needs a new choice from you. Continued use is not consent to a new purpose.
12. End of beta. We may shut the beta down. Export your entries if you want a copy. We will not migrate testnet counts to mainnet under these terms.`;

/** §2.3 Privacy notice — beta (short form). */
export const BETA_PRIVACY = `MyDayWas Beta Privacy Notice

Same version and date as the terms. This notice wins if a marketing page conflicts with it.

Summary

- Diary text stays on your device, encrypted with a key we do not hold. We do not read it.
- We do not put your entries, your wallet, or a per-user record on a chain.
- Aggregated signals are optional and off by default. A published count is a group number. Your account is not anonymous.
- The referral preview does not send your data to a partner in this beta.
- You can export and delete on this device. Delete destroys local entries and the local key. It does not edit a count already published, and it may not reach a phone-maker backup outside this app.
- This beta runs signals on Sepolia testnet or in dry-run. Testnet publication is public test data.

Who is responsible. No legal entity has been named yet. Until one is named in this notice, do not treat this beta as having an EU or UK establishment, a DPO, or an Article 27 representative. If we later target the EEA or UK as a market, we will name the controller and any representative before that launch. That launch is outside this clearance.

What we process

- Diary text and follow-up answers: your device; readable only by you, with your key; we do not process it if it never leaves the device; kept until you delete it.
- Encrypted sync copy, if you use sync: your device and the sync store; we cannot decrypt it; to provide optional sync; deleted from that store and its backups within 72 hours of in-app delete, sync-off-and-delete, or object expiry.
- Wallet address used to derive the key: your device; a signature if we verify login; us only for the login check; to open the diary; account life; not copied into signal or referral logs.
- Signal contribution before publication: relayer, if a relayer URL is set; us, to aggregate; consent, off by default; held only to build the day's group; not published as a per-user record.
- Published signal count: Sepolia testnet, and only if the day's cell has at least 100 distinct contributors and the UTC day has closed; public; consent; the count is the only thing we call anonymous, and only as a group; testnet data can be reset by the network; we still cannot edit a count after publication.
- Referral preview: your device queue only; readable by you, not a partner; consent per field, only if you queue it; purged within 30 days; nothing is delivered in this beta.
- Support mail: support inbox; us; to answer you; do not include diary text; kept only as long as needed to answer, and we state that window when the inbox exists.

What a signal contains if you opt in. One sentiment (positive, negative, or neutral), the UTC day, and a random signal token that is not your wallet, not a device id, and not your referral code. Not your words. Not your location. Not the time of day. The token rotates when you turn signals off.

What "anonymous" means here. Only a published group count, after at least 100 different contributors and a delay of at least 24 hours (the UTC day must have closed). Your contribution before that is pseudonymous. Someone who can already see your wallet and nearby chain activity might still guess at a link. We do not claim that is impossible.

What we do not do. We do not sell personal data. We do not use diary text for ads, credit, insurance, employment, or model training. We do not run cloud inference on your entries. Follow-up prompts run on your device.

Sensitive data. If you later send a referral that includes exercise, medication, health-framed mood, or crisis state, that is sensitive health data. Each of those needs its own confirmation. In this beta the referral is not delivered, so no partner receives it.

Delete and export. Export downloads a readable file to your device. Treat it as sensitive. Delete removes entries on this device and destroys the local key. We delete any encrypted sync copy and its backups within 72 hours. We purge a queued referral within 30 days, and immediately if you revoke. We cannot restore a diary after this delete. We cannot edit a published count. A platform backup outside this app may still hold a copy; if you use one, turn off backup of this app in the platform settings after you delete.

Requests we still hold. For a wallet-only account, prove control with a wallet signature. We will not ask for a government ID for that check. Target response: 30 days. Rights you can ask us to honor, to the extent they apply: access, correction, deletion, export, objection, restriction, and withdrawal of consent. You may complain to a supervisory authority. US state rights to know, delete, and correct are honored for data we actually hold. We do not sell or share personal data for cross-context advertising.

Law enforcement. We can be compelled to produce what we hold. We do not hold diary plaintext. We will not build a backdoor.

Children. Not for anyone under 18. If we learn an account is a child's, we will disable it and delete what we hold.`;

/** §2.4 — plain labels replacing raw referral field keys in the UI. */
export const REFERRAL_LABELS: Record<string, string> = {
  contactType: "Contact method (required — how a partner could reply; not delivered in this beta)",
  contactValue: "Contact detail",
  region: "Region (broad only — not a signal, not published)",
  exercise: "Exercise — sensitive health information",
  medication: "Medication — sensitive health information",
  healthMood: "Mood framed as a health concern — sensitive health information",
  crisis: "Crisis — sensitive health information",
};