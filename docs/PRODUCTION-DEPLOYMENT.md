# MyDayWas v1 — production deployment decision record + runbook (OBS-264)

**Stage:** 7/9 of the OBS-257 delivery checklist. **Owner:** CTO, with SRE.
**Status:** decisions recorded 2026-10-31. **All provisioning/deployment steps
below are [gated] and MUST NOT execute before the OBS-237 external written
sign-off lands** (see Gates). No mainnet deployment without its own written
approval.

## 1. Decisions (recorded)

### 1.1 Relayer deployment model: **container/VM** (CFO option 2)

Chosen over serverless (option 1) and managed automation (option 3):

- **Durable SQLite store requires a persistent local volume.** The CISO F3
  re-verification (OBS-234) pinned `RELAYER_DB_PATH` to a single-writer,
  local-disk WAL topology. Serverless functions have ephemeral filesystems —
  incompatible without a redesign the audit did not review.
- **Stable KMS-backed blinder across restarts** is a CISO precondition
  (`docs/PRODUCTION-CHECKLIST.md` §1); a long-lived container holds warm KMS
  sessions and the day-over-day custody-usage/Sybil baselines
  (`CustodyUsageMonitor`, `SybilEarlyWarning`) in ways per-request cold starts
  would not.
- **Fixed cost** ~$15–40/mo (CFO range) fits the approved envelope
  ($2,000/mo planned, $2,500/mo cap — OBS-167) with margin; managed relayer
  (Gelato/Chainlink) forfeits control of the submitter + signed reconciliation
  artifact path that OBS-237 is auditing.

Target shape: 1 small container instance (Fly.io / ECS Fargate / Railway class)
with a persistent volume, behind a TLS-terminating LB honoring
`x-forwarded-proto` (`RELAYER_REQUIRE_TLS=1` enforced in-process).

### 1.2 Custody: **Cloud KMS** (not dedicated HSM) for the beta

Per CFO analysis (OBS-167 §4): Cloud KMS (~$2–10/mo keys + per-op) meets the
CISO checklist; dedicated HSM (~$2,100–2,300/mo) only if a mainnet decision
demands it. Two key objects per `docs/PRODUCTION-CHECKLIST.md` §1:
`<provider>/blinder/vN#…` and `<provider>/signer/vN#…`, least-privilege IAM
(`sign`/`mac-generate` on exactly those two objects).

### 1.3 Chain: **staging stays Sepolia; production chain choice is L2-by-default,
subject to its own written approval.** No mainnet deployment is authorized by
this document. `AggregateSentimentSignals` production deploy waits for OBS-237
sign-off + the explicit written mainnet approval required by the constraints.

### 1.4 Domain: **`app.mydaywas.com`** (app, carry-over OBS-77 — the landing-page
CTA already points there) + **`relayer.mydaywas.com`** (relayer, behind the
TLS LB). Static app hosting stays Netlify (already in production use —
OBS-125/163) with the custom domain attached once DNS resolves.

### 1.5 LM Studio key (M6 D2, from OBS-227): **done** — the key is stored as a
Paperclip managed secret (`lmstudio116-api-key`, env delivery, secret-store
ref fe66…c328); no plaintext copy is required in any repo/config path. Rotation
continues per the secret-store versioning.

## 2. Production environment (template only — no secrets in repo)

See `relayer/.env.production.example`. Values are injected at provision time
from the Paperclip secret store / provider secret manager, never committed.

| Var | Prod value shape | Source |
| --- | --- | --- |
| `RELAYER_PORT` | 8081 (behind LB) | config |
| `RELAYER_REQUIRE_TLS` | `1` | checklist §3 |
| `RELAYER_RATE_PER_MIN` | `60` | checklist §4 runbook default |
| `RELAYER_ALERT_WEBHOOK` | ops SNS/PagerDuty ingress URL | secret store |
| `RELAYER_DB_PATH` | local persistent volume path | checklist §2 |
| `VITE_RELAYER_URL` (app build) | `https://relayer.mydaywas.com` | §1.4 |

## 3. Runbook (deployment)

1. **Pre-flight gates:** OBS-237 written sign-off recorded; OBS-228 M6
   complete; CISO control sign-off (stage 6) complete. Abort if any missing.
2. **Provision** hosting within the envelope; attach KMS key objects (§1.2);
   inject env from the secret store.
3. **Deploy relayer**; `GET /healthz` returns `{"ok":true,"service":
   "mydaywas-relayer"}` 200 over TLS via the LB; internal probe on plain HTTP
   also 200 (healthz is TLS-exempt by design).
4. **Deploy contract** to the approved production chain via
   `contracts/deploy.mjs` (Sepolia-gated key path today; production chain per
   §1.3 written approval). Record address + tx + block in
   `docs/CONTRACT-ADDRESSES.md`.
5. **Verify on-chain address matches repo source:** recompile with
   `contracts/compile.mjs` (solc 0.8.24, optimizer 200, cancun) and diff the
   runtime bytecode at the deployed address against the compiled artifact —
   the same procedure used for the 2026-10-31 staging redeploy (first-divergence
   check). Selector `recordBatch` == `0x0f4d576c`.
6. **Wire the app:** set `VITE_RELAYER_URL=https://relayer.mydaywas.com` in
   the diary production build; attach `app.mydaywas.com` to Netlify; confirm
   the landing CTA resolves. App URL must return 200 over TLS.
7. **Monitoring:** LB uptime probe on `GET /healthz`; alert sink
   (`RELAYER_ALERT_WEBHOOK`) wired for all alert reasons (checklist §5);
   reconciliation-vs-`BatchRecorded` monitor live **before traffic** (CISO
   OBS-235 condition).

## 4. Rollback path

- **App:** Netlify instant rollback to the previous immutable deploy of the
  static bundle; DNS/LB unchanged.
- **Relayer:** redeploy previous container image; the durable SQLite store
  (dayId → counts only) survives on the persistent volume.
- **Contract:** `AggregateSentimentSignals` is non-upgradeable — rollback is
  the `pause()` brake (`docs/PRODUCTION-CHECKLIST.md` §6): `onlyOwner` call,
  verify `paused == true`, rotate affected custody keys, preserve alert log +
  store + reconciliation artifacts for the Chief Auditor, resume only after
  CISO + Chief Auditor sign-off.
- **Rehearsal [gated]:** run the pause/unpause drill on Sepolia staging
  against `0xEdeAC98…5f35C` before production cutover; record tx hashes +
  timings as the rehearsal artifact on OBS-264.

## 5. Vendor quotes — outstanding (capture before provisioning)

Per OBS-167 these are list-price estimates, not quotes. Outstanding quotes to
capture within the envelope: RPC paid tier (Alchemy/Infura/QuickNode), Cloud
KMS (AWS/GCP), monitoring/observability (Sentry/uptime), inference (if
external fallback used). Quotes are a procurement action and require the CFO.

## 6. Gates (hard)

- **No production traffic before the OBS-237 external written sign-off.**
- No mainnet deployment without its own written approval.
- Chain submitter stays dry-run until the Chief Auditor review of the
  real-submitter cutover.
- No secrets in issues, comments, documents, or code — managed secret
  bindings only.