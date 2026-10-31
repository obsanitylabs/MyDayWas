# MyDayWas relayer — OBS-87 binding production checklist

Status: service-layer items **implemented** on `m4/signals-v1` (see
`relayer/src/keycustody.ts`, `relayer/src/sybil.ts`, `relayer/src/server.ts`,
`relayer/src/log.ts`, `relayer/src/monitor.ts`; tests in `relayer/test/ops.test.ts`,
`relayer/test/prod.test.ts`). The **[deploy]** items are landed as code/config/docs
by OBS-313 (`relayer/Dockerfile`, `.github/workflows/ci.yml`, `deploy/`,
`docs/PRODUCTION-DEPLOY-MODEL.md`, `docs/PRODUCTION-IAM.md`,
`docs/PRODUCTION-DOMAIN-DECISION.md`, `deploy/README.md`); actual provisioning
and traffic are **[gated]** on the OBS-237 external written sign-off.
Custody handover items are marked **[CISO]**.

## 1. Key custody — KMS/HSM with separate blinding vs signing keys

- [x] **Separate keys per purpose** (code): `CellBlinder` (HMAC blinding) and
  `ReconciliationSigner` (Ed25519 artifact signing) are now distinct
  interfaces (`relayer/src/keycustody.ts`); `LocalDevCustody` uses separate
  material for each. A production deployment implements both against KMS/HSM
  key objects — never one key for both purposes.
- [x] **Versioned keyIds** (code): `blinderKeyId()` / `signerKeyId()` return
  `<provider>/<purpose>/v<n>#<fingerprint>` (e.g. `local-dev/blinder/v1#…`).
  Artifacts carry the signer keyId (`signedBy` in the reconciliation
  artifact), so rotation is observable. **[deploy→landed]** production KMS
  keyIds follow the same scheme: `KmsCustody` + the OBS-300 guard enforce it
  (`relayer/src/keycustody.ts`, `relayer/src/server.ts`); the real key
  objects are provisioned [gated] per `docs/PRODUCTION-DEPLOY-MODEL.md`.
- [x] **Usage-anomaly monitoring** (code): `CustodyUsageMonitor` counts
  blinding/signing ops per UTC day and raises `custody_usage_anomaly` when
  today's count exceeds `spikeFactor ×` the recent day-over-day baseline.
  **[deploy→landed]** alert sink forwards it to ops (see §5) — sink wiring is
  live in code; the ops webhook URL itself is injected at deploy time
  (`RELAYER_ALERT_WEBHOOK`).
- [x] **Rotation runbook** **[deploy/CISO — runbook landed, execution gated]**:
  rotate blinder and signer keys on **distinct schedules** —
  **signer every 90 days**, **blinder every 180 days** (see §1a below).
- [x] **Stable blinder key** **[deploy→landed]**: production custody is
  `KmsCustody` over persistent provider-side key objects (CISO precondition
  from OBS-234): the blinder survives restarts, so the new-account counter
  is never re-opened by a reboot. The OBS-300 `custodyProfileError` guard
  fails the process closed if a durable-profile (`RELAYER_DB_PATH`) boot is
  configured with ephemeral `LocalDevCustody`.

### 1a. Rotation runbook (OBS-87 §1 / OBS-313 D9)

1. **Distinct schedules.** Signer: every **90 days**. Blinder: every **180
   days**. Never rotate both in one maintenance window (observability: a
   rotation event must attribute cleanly to one purpose).
2. **Blinder rotation — UTC day boundary rule.** Blinder rotation
   invalidates first-seen markers; rotate **only at a UTC day boundary**
   (`00:00:00Z`) and accept **one day of re-counted tokens**, capped by the
   shared atomic `MAX_NEW_ACCOUNTS_PER_UTC_DAY` (the durable counter
   transaction re-applies the cap per day, so a rotation cannot be used to
   push past the bound). Sequence: provision new key object → update
   `RELAYER_KMS_BLINDER_KEY_ARN` + bump `RELAYER_KMS_BLINDER_VERSION` →
   restart at the boundary → confirm `GET /healthz` shows the new
   `blinderKeyId` (`…/v<n+1>#…`).
3. **Signer rotation.** Any time (no counter interaction): provision →
   update `RELAYER_KMS_SIGNER_KEY_ARN` + bump
   `RELAYER_KMS_SIGNER_VERSION` → restart → publish-window verifies via the
   reconciliation monitor. **Retain old signer public keys indefinitely**
   (export via provider `GetPublicKey` before the old object is retired —
   the only key-export permission in the IAM policy,
   `docs/PRODUCTION-IAM.md` §1): previously published reconciliation
   artifacts must stay verifiable for the 35-day cell retention and for any
   later audit re-examination.
4. **Observability.** New versioned keyIds appear in subsequent artifacts
   (`signedBy`) and in `GET /healthz`. The reconciliation monitor
   (`reconciliation_mismatch`, §5) flags any artifact signed by a keyId that
   no longer verifies.
5. **Old key objects:** disable (not delete) after one full retention cycle
   (35 days) of clean telemetry; deletion only on CISO sign-off.

## 2. IAM — least privilege  [deploy]

- Relayer service identity: KMS `sign`/`mac-generate` on exactly the two key
  objects above; nothing else. No `decrypt`, no admin, no key-create.
- SQLite durable store (`RELAYER_DB_PATH`): local volume only (WAL is
  local-disk; multi-instance shares a host/local volume or single-writer
  topology — CISO precondition from OBS-234). No network filesystems.
- Webhook/secret env vars are injected, never written to disk or logs.

## 3. Edge — TLS-only, no body logging

- [x] `RELAYER_REQUIRE_TLS=1` (code, prod): every request must arrive with
  `x-forwarded-proto: https` (TLS terminates at the LB) or it is rejected
  `426 tls_required`. Staging default: off.
- [x] No body logging (code, enforced since M4): log lines carry static
  strings, UTC day ids, and integer counts only (`relayer/src/log.ts`).
  `readJson` caps bodies at 8 KiB; oversized bodies are rejected +
  alerted, never logged.

## 4. Rate shaping on `/v1/signals`

- [x] `RELAYER_RATE_PER_MIN=<n>` (code, prod): per-IP token bucket, runbook
  default 60 req/min; over-limit requests get `429 rate_limited` and raise the
  `rate_limited` alert reason. Staging default: off.

## 5. Alert-sink wiring — all AlertReason codes

- [x] `RELAYER_ALERT_WEBHOOK=<url>` (code, prod): every raised alert —
  `unexpected_submission_fields`, `malformed_submission`,
  `dayId_out_of_window`, `new_account_rate_limited`,
  `custody_usage_anomaly`, `sybil_early_warning`, `rate_limited` — is
  forwarded as `{reason, raisedDay, detail}` (reason code + day resolution
  only; never payload data) to the ops webhook (SNS/PagerDuty ingress).
  In-process alerts remain queryable via `alerts.list()` regardless.
- [x] **Sybil early warning** (code): `SybilEarlyWarning` compares today's
  new-account count to the day-over-day baseline (`spikeFactor ×` recent
  baseline, absolute floor) — an early signal of account farming toward the
  k-anonymity threshold, raised before the hard
  `MAX_NEW_ACCOUNTS_PER_UTC_DAY` cap trips. Deduped once per UTC day.
- **[deploy→landed]** monitor hook (CISO OBS-235 condition 1): the
  `ReconciliationMonitor` (`relayer/src/monitor.ts`) runs on **every
  publish** inside the server: (a) `verifyReconciliation` signature check,
  (b) artifact-internal cells-vs-`recordBatch` diff, (c) on-chain
  `BatchRecorded` diff via the `getCounts(uint32)` reader
  (`relayer/src/chainrpc.ts`, real-submitter mode). Failures raise
  `reconciliation_mismatch` through the shared alert sink
  (`{reason, raisedDay, detail}` only) — covered by tests in
  `relayer/test/prod.test.ts`. The CISO approval **requires this to be live
  before production traffic** — it is the detection path for the accepted L2
  residual risk. Code+config+test landed; the live wiring (real webhook +
  real chain) activates at provisioning [gated on OBS-237].

## 6. Incident runbook — contract `pause()` brake

On confirmed relayer/contract compromise or data-integrity incident:

1. **Brake first:** call `AggregateSentimentSignals.pause()` (`onlyOwner`)
   — `recordBatch` reverts while paused; view functions stay readable.
   Verify `paused == true` on-chain.
2. **Rotate:** rotate the affected custody key(s) per §1; if the relayer EOA
   or contract owner key is implicated, follow the CISO custody handover.
   (Rotation runbook in §1; new keyIds appear in subsequent artifacts.)
3. **Preserve:** export the alert log (`alerts.list()`), the durable store
   (`dayId → counts` only — no content exists to preserve), and the affected
   reconciliation artifacts for the Chief Auditor.
4. **Notify:** page ops via the alert sink; escalate security impact to CISO
   immediately; contract/chain impact to the Chief Auditor.
5. **Resume:** `unpause()` only after CISO + Chief Auditor sign-off on the
   root cause and remediation.

## 7. Contract owner key + relayer EOA custody handover  [CISO]

Ownership of the `AggregateSentimentSignals` owner key (deployer of
`0x012b…4efa7`, Sepolia) and management of the relayer EOA (`onlyRelayer`)
transfer to CISO custody per the M6 hardening mandate. Track in the CISO
custody-handover task (child of OBS-228). The `pause()` brake in §6 is
`onlyOwner` — after handover, CISO executes it on request from the incident
commander.

## Constraints

- No production traffic before: F3 ✅ (OBS-234 APPROVE) + OBS-88 disposition
  ✅ (OBS-235 APPROVE) + external audit sign-off (OBS-86 path, pending).
- Chain submitter stays dry-run until the Chief Auditor review of the
  real-submitter cutover.
- No secrets in issues, comments, or code.