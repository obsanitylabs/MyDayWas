# deploy/ — relayer deploy, verify, rollback, incident runbook (OBS-313 D3)

**Owner:** CTO (+ SRE). **Gates:** provisioning/deployment below is **[gated]**
— none of it may execute before the OBS-237 external written sign-off and the
stage-6 CISO control sign-off (see `docs/PRODUCTION-DEPLOYMENT.md` §6).
No mainnet. No secrets anywhere in this directory — values are injected from
the Paperclip secret store / platform secret manager at deploy time.

## Artifacts in this directory

| File | Purpose |
| --- | --- |
| `fly.toml` | Reference platform config for the chosen model (container/VM + persistent local volume). Placeholders only. |

Supporting artifacts elsewhere:
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
   `RELAYER_BUILD_REVISION` — set in the platform config from
   `fly.toml` `[env]` + CI (`RELAYER_BUILD_REVISION` = git sha).
2. **Platform secrets (secret values):** `RELAYER_ALERT_WEBHOOK`,
   `RELAYER_EOA_SECRET_KEY` — set via the platform secret store
   (`fly secrets set …`), sourced from the Paperclip secret store.
3. **Host image (deploy-time adapter):** `RELAYER_KMS_OPS_MODULE` — path to the
   KMS adapter module implementing `KmsKeyOperations {mac, sign, verify}`
   against the provider SDK (AWS KMS `GenerateMac`/`Sign`/`Verify` or
   equivalent). The adapter carries provider SDK config only; key material
   stays inside the provider and provider credentials reach the adapter via
   the workload identity (`docs/PRODUCTION-IAM.md`), never via files/env.

The app build gets `VITE_RELAYER_URL=https://relayer.mydaywas.com` at **build**
time (Netlify env) per `docs/PRODUCTION-DOMAIN-DECISION.md`.

## Deploy [gated]

1. **Pre-flight gates:** OBS-237 written sign-off recorded; CISO stage-6
   sign-off recorded; IAM policy applied per `docs/PRODUCTION-IAM.md`;
   KMS key objects provisioned (blinder + signer, versioned keyIds);
   `RELAYER_KMS_OPS_MODULE` adapter installed on the image; secrets set.
2. **Build image** from `relayer/Dockerfile` (CI already gates: the build runs
   `npm run typecheck && npm test` inside — a red suite produces no image).
3. **Deploy** one instance (single-writer topology) with the persistent volume
   mounted at `/data` (`RELAYER_DB_PATH=/data/mydaywas-relayer.db`).
   Keep `RELAYER_SUBMITTER=dry-run` — the real-submitter cutover is CISO-gated
   (OBS-166) and additionally requires the OBS-237 sign-off.
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
curl -fsS -X POST https://relayer.mydaywas.com/v1/publish -H 'content-type: application/json' -d '{"dayId":<yesterday>}' | jq .
# expect: signed reconciliation artifact; dry-run submitter name; and NO
# reconciliation_mismatch alert on the ops sink.
```

Alert-sink check: trigger a harmless alert reason (e.g. a malformed submission
`400`) on staging first and confirm `{reason, raisedDay, detail}` arrives at
the ops webhook. The CISO OBS-235 condition: **the reconciliation-vs-
`BatchRecorded` monitor must be live before any production traffic** — verify
the monitor fires (test on staging) before opening traffic.

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