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
- **Fixed cost** ($3.86/mo quoted for the relayer host, inside the
  board-approved lean envelope — $9.44/mo planned, $25.00/mo cap; approvals
  `063d6679` + `a04b7903`, OBS-357 `lean-envelope` rev 1) with margin; managed relayer
  (Gelato/Chainlink) forfeits control of the submitter + signed reconciliation
  artifact path that OBS-237 is auditing.

Target shape: 1 small container instance (Fly.io / ECS Fargate / Railway class)
with a persistent volume, behind a TLS-terminating LB honoring
`x-forwarded-proto` (`RELAYER_REQUIRE_TLS=1` enforced in-process).

### 1.2 Custody: **Cloud KMS** (not dedicated HSM) for the beta

Cloud KMS (quoted **$4.01/mo** for the two customer-managed keys —
board-approved lean envelope, approvals `063d6679` + `a04b7903`) meets the
CISO checklist; dedicated HSM (~$2,100–2,300/mo) is a **named exclusion** of
the envelope and needs a fresh board decision. Two key objects per `docs/PRODUCTION-CHECKLIST.md` §1:
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
| `RELAYER_ALLOWED_ORIGINS` | `https://app.mydaywas.com` (exact app origin; comma-separated list; unset/empty = closed) | config (`relayer/fly.toml` `[env]`) |
| `RELAYER_CLIENT_IP_HEADER` | `fly-client-ip` (platform-set header read for the rate-shaping client IP; falls back to the trusted last hop of `x-forwarded-for`, then the socket address) | config (`relayer/fly.toml` `[env]`) |
| `RELAYER_ALERT_WEBHOOK` | ops SNS/PagerDuty ingress URL | secret store |
| `RELAYER_PUBLISH_SECRET` | **mandatory** in the production profile — shared secret for the `x-relayer-auth` header on `POST /v1/publish` (fail-closed boot without it) | secret store |
| `RELAYER_DB_PATH` | local persistent volume path | checklist §2 |
| `RELAYER_CUSTODY` | `kms` (+ `RELAYER_KMS_*` per `docs/PRODUCTION-IAM.md`) | config + secret store |
| `RELAYER_SUBMITTER` | `dry-run` (default; real cutover CISO-gated) | config |
| `RELAYER_CHAIN_RPC` / `RELAYER_CHAIN_ID` / `RELAYER_CHAIN_ADDRESS` | production L2 RPC + expected chain id + address | config (§1.3) |
| `RELAYER_BUILD_REVISION` | git sha | CI/deploy |
| `VITE_RELAYER_URL` (app build) | `https://relayer.mydaywas.com` | §1.4 |

### 2.1 Operator publish auth and client-IP header (M1/H1, OBS-760)

- **`RELAYER_PUBLISH_SECRET`** — the shared secret the operator publish endpoint
  `POST /v1/publish` requires in the **`x-relayer-auth`** request header. The
  app ingest path `POST /v1/signals` does **not** use this header. The relayer
  compares the value constant-time and returns `401` on a missing or invalid
  header. **It is mandatory in the production profile:** with the durable
  profile (`RELAYER_DB_PATH` set) the relayer **refuses to start** without it
  (`refusing to start: production profile … requires RELAYER_PUBLISH_SECRET`).
  Provision it through the platform secret store — **not** a file, **not** a
  committed value; only the secret **name** appears in the repo.
  `RELAYER_PUBLISH_AUTH_HEADER` optionally overrides the header name (default
  `x-relayer-auth`). **Rotation:** set the new secret in the platform secret
  store and restart the machine; in-flight requests still carrying the old
  header get `401` until the calling operator is updated.
- **`RELAYER_CLIENT_IP_HEADER`** — the platform header the relayer reads for
  the client IP used by rate shaping (default `fly-client-ip`, set by the Fly
  edge). When it is absent the relayer uses the **trusted last hop** of
  `x-forwarded-for` (the value appended by our own proxy) and ignores the
  attacker-controlled leftmost value; failing both, the socket address. If the
  platform stops setting this header (or the key is dropped/renamed), rate
  shaping silently keys on the wrong source and the H1 flood protection is
  weaker than it looks.

Full contract + injection paths: `relayer/.env.production.example` and
`deploy/README.md`. Decision records: `docs/PRODUCTION-DEPLOY-MODEL.md`,
`docs/PRODUCTION-DOMAIN-DECISION.md`; IAM policy:
`docs/PRODUCTION-IAM.md`.

## 3. Runbook (deployment)

All commands [gated] per §6; placeholders (`mydaywas-relayer` app, `iad`
region, `mydaywas_relayer_data` volume) come from `relayer/fly.toml` and are
substituted at provisioning. The ordered sequence of record is
`deploy/README.md` → Deploy [gated] (Steps 1–7); the same steps, condensed:

1. **Pre-flight gates:** OBS-237 written sign-off recorded; OBS-228 M6
   complete; CISO control sign-off (stage 6) complete. Abort if any missing.
2. **Provision** hosting within the envelope; attach KMS key objects (§1.2);
   inject env from the secret store — **including the mandatory
   `RELAYER_PUBLISH_SECRET`** (the production profile refuses to start without
   it, so provision it here, before the first deploy). Create/import the app
   first with `fly launch --config relayer/fly.toml --no-deploy`.
3. **Volume [before the first deploy]:** create the persistent volume named in
   `relayer/fly.toml` `[[mounts]]` (`mydaywas_relayer_data`, mounted at
   `/data`) in the app's region — a machine cannot mount a volume that does
   not exist:
   `fly volumes create mydaywas_relayer_data --app mydaywas-relayer --region iad`
   (https://fly.io/docs/flyctl/volumes-create/).
4. **Custom domain + TLS:** attach the relayer origin of record and provision
   its certificate — `fly launch` creates only the `*.fly.dev` hostname, and
   `force_https = true` does not create a custom-domain certificate:
   `fly certs add relayer.mydaywas.com --app mydaywas-relayer`
   (https://fly.io/docs/flyctl/certs-add/).
5. **Build + deploy the relayer from the repo root:** `fly deploy relayer`.
   `relayer` is flyctl's working directory, so it reads `relayer/fly.toml` and
   `relayer/Dockerfile` there and uses `relayer/` as the Docker build context —
   the relayer's own manifest (`typecheck`/`test`), `tsconfig.json`,
   `vitest.config.mts`, `src/`, `test/`, exactly what CI builds with
   `context: relayer`.
   Then `GET /healthz` returns 200 over TLS via the LB with
   the readiness body (`docs/PRODUCTION-DEPLOYMENT.md` → OBS-313 D2):
   `ok`, `service`, `buildRevision`, `uptimeSec`, `submitter` (dry-run/real),
   `custody` (provider + versioned `blinderKeyId`/`signerKeyId`), `db`
   (backend + reachable); internal probe on plain HTTP also 200 (healthz is
   TLS-exempt by design). No secrets or payload data in the body.
6. **DNS record [Netlify DNS, not the registrar]:** create
   `relayer.mydaywas.com` as a CNAME to the app's CNAME target (the unique
   `*.fly.dev` hostname shown by `fly certs add` / `fly certs setup`;
   https://fly.io/docs/networking/custom-domain/) in the **Netlify DNS** zone
   `mydaywas.com` (zone id `6ad5a320…`) with the managed
   `netlify-obsanity-token` secret. Wait for resolution, confirm the
   certificate is issued (`fly certs check relayer.mydaywas.com`), and verify
   `https://relayer.mydaywas.com/healthz` returns **200 over TLS** before any
   traffic (`docs/PRODUCTION-DOMAIN-DECISION.md`).
7. **Deploy contract** to the approved production chain via
   `contracts/deploy.mjs` (Sepolia-gated key path today; production chain per
   §1.3 written approval). Record address + tx + block in
   `docs/CONTRACT-ADDRESSES.md`.
8. **Verify on-chain address matches repo source:** recompile with
   `contracts/compile.mjs` (solc 0.8.24, optimizer 200, cancun) and diff the
   runtime bytecode at the deployed address against the compiled artifact —
   the same procedure used for the 2026-10-31 staging redeploy (first-divergence
   check). Selector `recordBatch` == `0x0f4d576c`.
9. **Wire the app:** set `VITE_RELAYER_URL=https://relayer.mydaywas.com` in
   the diary production build; attach `app.mydaywas.com` to Netlify; confirm
   the landing CTA resolves. App URL must return 200 over TLS.
10. **Monitoring:** LB uptime probe on `GET /healthz`; alert sink
    (`RELAYER_ALERT_WEBHOOK`) wired for all alert reasons — the sink now
    carries **nine** reason codes (a superset of the required seven),
    including the new `publication_missing` reason (checklist §5);
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

## 5. Vendor quotes — recorded (OBS-357 `lean-envelope` rev 1)

The five production lines are **already quoted** (vendor + list price, board
approvals `063d6679` + `a04b7903`, envelope **$9.44/mo planned / $25.00/mo
cap**):

| Line | Vendor | Quoted |
| --- | --- | --- |
| Relayer hosting (1 container/VM + persistent volume) | Fly.io | $3.86/mo |
| KMS (2 customer-managed keys: HMAC blinder + P-256 signer) | AWS | $4.01/mo |
| Chain RPC (PAYG, inside the 30M CU free allowance) | Alchemy | $0.00/mo |
| Monitoring/alerting (free tier + Slack incoming webhook) | Better Stack | $0.00/mo |
| Inference (local LM Studio on shared internal hardware) | internal | $0.00/mo |
| **Subtotal** | | **$7.87/mo** |
| **Planned (subtotal + 20% contingency) / cap** | | **$9.44/mo / $25.00/mo** |

**Named exclusions — each requires a fresh board decision before any spend:**
dedicated HSM (~$2,100–2,400/mo), L1 chain (+$150–750/mo), live curated partner
network (+$1,000–2,500/mo), Better Stack paid Responder seat (+$34/mo), any
external inference API, and anything outside the five quoted lines above (L2
gas, app hosting, domain/email, support/ops, audits, legal, taxes, salaries,
marketing). The envelope is a **ceiling, not a purchase** — no procurement, no
vendor commitment until a signed quote is in place.

## 6. Gates (hard)

- **No production traffic before the OBS-237 external written sign-off.**
- No mainnet deployment without its own written approval.
- Chain submitter stays dry-run until the Chief Auditor review of the
  real-submitter cutover.
- No secrets in issues, comments, documents, or code — managed secret
  bindings only.

## Deploy-freeze notice (OBS-511)

**Freeze:** No deploy of the diary app to `app.mydaywas.com` is permitted
until the following sign-offs land:
1. **OBS-237** — external written sign-off (launch-readiness, OBS-227 §2.4)
2. **OBS-301** — stage-6 CISO control sign-off

**Superseding coordinated change:** The CSP allow-list (connect-src
'self' + the production relayer origin) and the relayer DNS/LB must be
published as a single coordinated change after both sign-offs land. The
widened CSP (`connect-src 'self' https://relayer.mydaywas.com`) that
shipped on commit `b511b66` must not be published to `app.mydaywas.com`.

**Scope:** This freeze applies to all publish paths to `app.mydaywas.com`:
- Netlify site `mydaywas-app` (branch-linked deploy / build hooks /
  continuous deploy settings / deploy API token or webhook)
- CI workflow (any Netlify deploy step — currently none; app was deployed
  by hand from a digest build)
- Local/scripted deploy paths (`deploy/README.md`, `docs/PRODUCTION-DEPLOYMENT.md`,
  and the Netlify CLI config in the workspace)
- **The landing site and the `m4/signals-v1` → `main` merge path** — the
  second half of the funnel, and the same hazard class. The apex landing
  site (`mydaywas`, builds `main` → landing `dist`) currently serves the
  `main` bundle `index-K5EuV2sz.js`, whose CTA is the resolving staging
  URL `https://obsanitylabs.github.io/MyDayWas/recovered/`. On
  `m4/signals-v1`, `src/config.js` has `APP_URL = 'https://app.mydaywas.com/'`
  (PM-verified: `main` → staging URL, `m4/signals-v1` → `https://app.mydaywas.com/`;
  `origin/main` is a direct ancestor of `origin/m4/signals-v1`). A merge of
  `m4/signals-v1` → `main` followed by a landing deploy flips the public
  CTA onto `app.mydaywas.com` — whose signals path is currently dead. The
  freeze must cover it, with the OBS-227 go/no-go as the gate for the CTA
  switch.

**Deploy id:** The currently published deploy id is `6ae6223747930d130d68763f`
(branch `m4/signals-v1`, deployed with the inert baseline
`connect-src 'self'`). The widened CSP deploy `6ae6201d1d56cce297fe0ece` was
rolled back and is not live.

**Commit status:** The freeze notice is committed and pushed to `origin/m4/signals-v1`
(tip `22835cf`; any later sha pushed with the same tip). The notice is live in
`docs/PRODUCTION-DEPLOYMENT.md` section "Deploy-freeze notice (OBS-511)" and
referenced from `deploy/README.md`.

**Status:** Freeze in effect and verified; live app confirmed inert
(`connect-src 'self'`); relayer host absent (NXDOMAIN) by design; the widened
CSP and the relayer DNS/LB land as one coordinated change after OBS-237 +
OBS-301 sign-offs, with the OBS-227 go/no-go gating the landing CTA switch.