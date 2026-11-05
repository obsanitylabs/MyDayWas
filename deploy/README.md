# deploy/ — relayer deploy, verify, rollback, incident runbook (OBS-313 D3)

**Owner:** CTO (+ SRE). **Gates:** provisioning/deployment below is **[gated]**
— none of it may execute before the OBS-237 external written sign-off and the
stage-6 CISO control sign-off (see `docs/PRODUCTION-DEPLOYMENT.md` §6).
See `docs/PRODUCTION-DEPLOYMENT.md` §Deploy-freeze notice (OBS-511) for the
freeze that gates all app.mydaywas.com publish paths.
No mainnet. No secrets anywhere in this directory — values are injected from
the Paperclip secret store / platform secret manager at deploy time.

## Reference config + artifacts

There is **exactly one** reference platform config: **`relayer/fly.toml`**. It
sits next to `relayer/Dockerfile` — the image it builds — so the config, the
image, and the build context cannot drift apart (OBS-676). Placeholders only.
This directory holds the runbook; it no longer holds a second config.

Supporting artifacts elsewhere:
`relayer/fly.toml` (reference platform config, container/VM + persistent local
volume),
`relayer/Dockerfile` (image build; typecheck + vitest run inside the build),
`relayer/.env.production.example` (the full production env contract),
`.github/workflows/ci.yml` (CI: relayer typecheck+tests+image, diary, landing,
contracts compile check), `docs/PRODUCTION-DEPLOY-MODEL.md` (decision record),
`docs/PRODUCTION-IAM.md` (least-privilege policy), `docs/PRODUCTION-CHECKLIST.md`
(binding checklist incl. rotation runbook + incident `pause()` brake).

## Env injection contract (no secrets in repo)

Every value reaches the running relayer through one of exactly three paths:

1. **Platform env (non-secret config):** `RELAYER_PORT`, `RELAYER_REQUIRE_TLS`,
   `RELAYER_RATE_PER_MIN`, `RELAYER_DB_PATH`, `RELAYER_SUBMITTER`,
   `RELAYER_CHAIN_ID`, `RELAYER_CHAIN_ADDRESS`, `RELAYER_EOA_ADDRESS`,
   `RELAYER_KMS_PROVIDER`, `RELAYER_KMS_BLINDER_KEY_ARN`,
   `RELAYER_KMS_SIGNER_KEY_ARN`, `RELAYER_KMS_*_VERSION`,
   `RELAYER_CLIENT_IP_HEADER`, `RELAYER_ALLOWED_ORIGINS`,
   `RELAYER_BUILD_REVISION` — set in the platform
   config from `relayer/fly.toml` `[env]` + CI (`RELAYER_BUILD_REVISION` = git sha).

   `RELAYER_ALLOWED_ORIGINS` (OBS-549) is the browser CORS allow-list: a
   comma-separated list of **exact** origins permitted to POST to the relayer
   from a browser. The diary app posts `application/json`, which is not
   CORS-safelisted, so the browser sends an `OPTIONS` preflight first; the
   relayer answers it (204) only when the request `Origin` exactly matches an
   entry here. **Unset or empty = closed** (no origin is allowed). Never `*`,
   never a reflected `Origin`. Read once at server construction. The reference
   config (`relayer/fly.toml` `[env]`) sets it to the app origin of record,
   `https://app.mydaywas.com`; if that key is dropped from the platform config
   the browser path is CLOSED and the diary's only network call fails.

   > **Correction (2026-11-05, OBS-824):** `app.mydaywas.com` was deleted by
   > the OBS-789 consolidation (NXDOMAIN). The app origin of record is now
   > **`https://mydaywas.com`**, and `relayer/fly.toml` sets it accordingly.
   > The provisioned platform env value must match at provisioning time.

   `RELAYER_CLIENT_IP_HEADER` (M1/OBS-760) names the platform header the
   relayer reads for the **client IP** used by rate shaping (default
   `fly-client-ip`, which the Fly edge sets). When that header is absent the
   relayer falls back to the **trusted last hop** of `x-forwarded-for` — the
   value appended by our own proxy — and ignores the **attacker-controlled
   leftmost** value; failing both, it uses the socket address. Rate-shaping
   keys depend on this header being set correctly on the platform: if the
   platform stops setting it, or the key is dropped or renamed, shaping
   silently keys on the wrong source and the H1 flood protection is weaker
   than it looks.
2. **Platform secrets (secret values):** `RELAYER_ALERT_WEBHOOK`,
   `RELAYER_EOA_SECRET_KEY`, and **`RELAYER_PUBLISH_SECRET`** — set via the
   platform secret store (`fly secrets set …`), sourced from the Paperclip
   secret store.

   **`RELAYER_PUBLISH_SECRET` is mandatory in production** (H1/OBS-760): the
   shared secret the operator publish endpoint `POST /v1/publish` requires in
   the `x-relayer-auth` request header. The app ingest path `POST /v1/signals`
   does **not** use this header. The relayer compares the secret constant-time
   and returns `401` on a missing or invalid value. With the durable production
   profile (`RELAYER_DB_PATH` set) the relayer **refuses to start without it**
   (fail closed) — provision it through the platform secret store **before the
   first deploy**, not after a failed boot. `RELAYER_PUBLISH_AUTH_HEADER` is an
   **optional** override of the header name (default `x-relayer-auth`). Only
   the secret **name** appears in the repo — never a value. **Rotation:** set
   the new value (`fly secrets set RELAYER_PUBLISH_SECRET=<new>`) and restart
   the machine; requests still carrying the old header get `401` until the
   calling operator is updated.
3. **Host image (deploy-time adapter):** `RELAYER_KMS_OPS_MODULE` — path to the
   KMS adapter module implementing `KmsKeyOperations {mac, sign, verify}`
   against the provider SDK (AWS KMS `GenerateMac`/`Sign`/`Verify` or
   equivalent). The adapter carries provider SDK config only; key material
   stays inside the provider and provider credentials reach the adapter via
   the workload identity (`docs/PRODUCTION-IAM.md`), never via files/env.

The app build gets `VITE_RELAYER_URL=https://relayer.mydaywas.com` and
`VITE_COLLECT_URL=https://mydaywas.com/api/collect` at **build** time (Netlify
env, single `mydaywas.com` site after the OBS-789 consolidation) per
`docs/PRODUCTION-DOMAIN-DECISION.md`, `docs/OBS-789-CONSOLIDATION.md` and
`docs/PRODUCTION-DEPLOYMENT.md` §9. The app is served same-origin at
`https://mydaywas.com/app/`, so the collector POST to `/api/collect` is
same-origin (a root-relative `/api/collect` is equivalent).
`VITE_COLLECT_URL` unset keeps the mdw analytics emitter dormant.

## Deploy [gated]

**GATE — read first:** every step below executes **only after** the OBS-237
external written sign-off and the stage-6 CISO control sign-off are recorded.
Nothing here provisions, deploys or spends by itself, and no step may run
ahead of that gate.

Run the commands from the **repo root** (the working-directory argument is what
sets the Docker build context). Placeholders (`mydaywas-relayer` app,
`iad` region, `mydaywas_relayer_data` volume name) come from
`relayer/fly.toml` and are substituted at provisioning — never with a secret
value (secret *names* only: `RELAYER_ALERT_WEBHOOK`, `RELAYER_EOA_SECRET_KEY`,
`RELAYER_PUBLISH_SECRET`, `netlify-obsanity-token`; secrets are injected from
the Paperclip secret store / platform secret manager at deploy time).

```bash
# Step 1 — App: create/import the Fly app from the reference config (no build
#   yet). `fly launch` creates only the *.fly.dev hostname.
fly launch --config relayer/fly.toml --no-deploy
# Step 2 — Volume: create the persistent volume named in relayer/fly.toml
#   [[mounts]] (source `mydaywas_relayer_data`, destination `/data`) in the
#   app's region — BEFORE the first deploy: a machine cannot mount a volume
#   that does not exist. (https://fly.io/docs/flyctl/volumes-create/)
fly volumes create mydaywas_relayer_data --app mydaywas-relayer --region iad
# Step 3 — Custom domain + TLS: attach the relayer origin of record and
#   provision its Let's Encrypt certificate. `fly launch` does NOT create the
#   custom-domain certificate, and `force_https = true` in the config does not
#   either — this step does. (https://fly.io/docs/flyctl/certs-add/)
fly certs add relayer.mydaywas.com --app mydaywas-relayer
# Step 4 — Secrets: inject the secret values from the Paperclip secret store.
# RELAYER_PUBLISH_SECRET is mandatory in the production profile (fail-closed boot).
fly secrets set -a mydaywas-relayer \
  RELAYER_ALERT_WEBHOOK=… RELAYER_EOA_SECRET_KEY=… RELAYER_PUBLISH_SECRET=…
# Step 5 — DNS record: create `relayer.mydaywas.com` as a CNAME to the app's
#   CNAME target (the unique *.fly.dev hostname shown by `fly certs add` /
#   `fly certs setup`) in the Netlify DNS zone `mydaywas.com`
#   (zone id `6ad5a320…`) — NOT at the registrar — via the managed
#   `netlify-obsanity-token` secret. (https://fly.io/docs/networking/custom-domain/)
# Step 6 — Deploy: build + deploy. `relayer` is flyctl's working directory, so
#   it reads relayer/fly.toml and relayer/Dockerfile there.
fly deploy relayer
# Step 7 — Verify: wait for DNS resolution, confirm the certificate is issued,
#   then run the Verify block below — `https://relayer.mydaywas.com/healthz`
#   must return 200 over TLS.
fly certs check relayer.mydaywas.com
```

**How the build context is resolved:** `fly deploy relayer` changes flyctl's
working directory to `relayer/`; the config (`relayer/fly.toml`), the Dockerfile
(`relayer/Dockerfile`, via `[build] dockerfile = "Dockerfile"`), and the Docker
build context are all resolved from there. That context is the relayer tree
(`package.json` with `typecheck`/`test`, `tsconfig.json`, `vitest.config.mts`,
`src/`, `test/`) — exactly the tree CI builds with `context: relayer`. Running
`fly deploy` from the repo root with no argument resolves the Dockerfile against
the landing tree instead and produces the wrong (or no) image.

1. **Pre-flight gates:** OBS-237 written sign-off recorded; CISO stage-6
   sign-off recorded; IAM policy applied per `docs/PRODUCTION-IAM.md`;
   KMS key objects provisioned (blinder + signer, versioned keyIds);
   `RELAYER_KMS_OPS_MODULE` adapter installed on the image; secrets set —
   **including the mandatory `RELAYER_PUBLISH_SECRET`** (the durable production
   profile refuses to start without it, so provision it here, before the first
   deploy).
2. **Build image** from `relayer/Dockerfile` (CI already gates: the build runs
   `npm run typecheck && npm test` inside — a red suite produces no image).
   The in-build gate runs against the relayer's own manifest (step 3's
   `relayer` context), not the repo-root landing manifest.
3. **Deploy** one instance (single-writer topology) with the persistent volume
   mounted at `/data` (`RELAYER_DB_PATH=/data/mydaywas-relayer.db`). The
   volume (sequence Step 2 above) must already exist in the region before
   this step; the custom-domain certificate (Step 3) and the DNS record
   (Step 5) are what make `https://relayer.mydaywas.com` resolve and serve
   TLS. Keep `RELAYER_SUBMITTER=dry-run` — the real-submitter cutover is
   CISO-gated (OBS-166) and additionally requires the OBS-237 sign-off.
4. **Verify** (below).
5. **Record** the deployed revision (`RELAYER_BUILD_REVISION`), instance/volume
   ids, and keyIds on the deploy record (OBS-264 evidence).

## Verify (after every deploy)

```bash
curl -fsS https://relayer.mydaywas.com/healthz | jq .
# expect: ok=true; custody.provider set; blinderKeyId/signerKeyId present and
# versioned (<provider>/<purpose>/v<n>#<fp>); submitter=dry-run… (until the
# gated cutover); db.backend=sqlite, db.reachable=true; buildRevision=sha.
# Plain local HTTP probe also returns 200 (healthz is TLS-exempt by design).
curl -fsS -X POST https://relayer.mydaywas.com/v1/publish \
  -H 'content-type: application/json' \
  -H "x-relayer-auth: $RELAYER_PUBLISH_SECRET" \
  -d '{"dayId":<yesterday>}' | jq .
# expect: signed reconciliation artifact; dry-run submitter name; and NO
# reconciliation_mismatch alert on the ops sink.
# The operator publish endpoint requires the x-relayer-auth header carrying
# RELAYER_PUBLISH_SECRET; a missing or stale value returns 401. The app ingest
# path POST /v1/signals does NOT use this header.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://relayer.mydaywas.com/v1/publish \
  -H 'content-type: application/json' -d '{"dayId":<yesterday>}'
# expect: 401 (fail closed without the operator secret).
```

Browser CORS preflight (OBS-549/OBS-628) — the deployed config must actually
answer the diary's origin; a 204 without `access-control-allow-origin` means the
allow-list is empty and the beta ships with the POST blocked:

```bash
curl -sS -o /dev/null -D - -X OPTIONS https://relayer.mydaywas.com/v1/signals \
  -H 'Origin: https://mydaywas.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
# expect: 204; access-control-allow-origin: https://mydaywas.com;
# vary: Origin; access-control-allow-methods contains POST; max-age 600.
# (Updated 2026-11-05, OBS-824: previously used https://app.mydaywas.com,
# a domain the OBS-789 consolidation deleted.)
curl -sS -o /dev/null -D - -X OPTIONS https://relayer.mydaywas.com/v1/signals \
  -H 'Origin: https://not-allowed.example.com'
# expect: 204 but NO access-control-allow-origin (disallowed origin is blocked).
```

Alert-sink check: trigger a harmless alert reason (e.g. a malformed submission
`400`) on staging first and confirm `{reason, raisedDay, detail}` arrives at
the ops webhook. The sink carries **nine** reason codes (a superset of the
required seven), including the new `publication_missing` reason. The CISO
OBS-235 condition: **the reconciliation-vs-`BatchRecorded` monitor must be
live before any production traffic** — verify the monitor fires (test on
staging) before opening traffic.

## Rollback

- **App:** Netlify instant rollback to the previous immutable deploy (static
  bundle); DNS/LB unchanged.
- **Relayer:** redeploy the previous image tag; the durable SQLite store
  (dayId → blinded tokens + counts only) survives on the persistent volume.
- **Contract:** non-upgradeable — rollback is the `pause()` brake
  (`docs/PRODUCTION-CHECKLIST.md` §6): `onlyOwner` `pause()`, verify
  `paused == true`, rotate affected custody keys, preserve alert log + store +
  reconciliation artifacts for the Chief Auditor, resume only after CISO +
  Chief Auditor sign-off.
- **Volume:** snapshots/restores are the storage-layer primitive — restore a
  pre-incident snapshot only with the Chief Auditor informed (the store is
  replay-prevention state; see `docs/PRODUCTION-DEPLOY-MODEL.md` §backup).

## Incident

Follow `docs/PRODUCTION-CHECKLIST.md` §6 (brake first: `pause()`; rotate;
preserve; notify CISO + Chief Auditor; resume only on sign-off). Page ops via
the alert sink. Do not paste payloads or key material into tickets — reason
codes + day resolution only.