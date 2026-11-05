# deploy/ — relayer deploy, verify, rollback, incident runbook (OBS-313 D3, OBS-794)

**Owner:** CTO (+ SRE). **Gates:** provisioning/deployment below is **[gated]**
— none of it may execute before the OBS-237 external written sign-off and the
stage-6 CISO control sign-off (see `docs/PRODUCTION-DEPLOYMENT.md` §6).
See `docs/PRODUCTION-DEPLOYMENT.md` §Deploy-freeze notice (OBS-511) for the
freeze that gates all app.mydaywas.com publish paths.
No mainnet. No secrets anywhere in this directory — values are injected from
the Paperclip secret store at deploy time.

**Provider (OBS-794, board direction 2026-11-05 / OBS-598):** Vultr Cloud
Compute + Block Storage + on-host Caddy TLS edge. This runbook replaces the
superseded Fly.io reference (`fly.toml`, `fly launch`, `fly secrets set`,
`fly certs add` — retired; OBS-598 records the board direction).

## Artifacts in this directory

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Reference platform config for the chosen model (single container instance + persistent local volume + on-host Caddy TLS edge). Placeholders only. |
| `Caddyfile` | TLS edge: managed Let's Encrypt cert for `relayer.mydaywas.com`, reverse-proxy to the relayer, trusted `x-forwarded-for` last hop. |
| `cloud-init.yml` | Instance bootstrap: Docker, Block Storage volume formatted + mounted at `/data`, secrets EnvironmentFile path, systemd env drop-in. |

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
   `RELAYER_BUILD_REVISION` — set in `deploy/docker-compose.yml`
   (`environment:`) + the runbook deploy step (`RELAYER_BUILD_REVISION`
   = git sha).
2. **Instance secrets (secret values):** `RELAYER_ALERT_WEBHOOK`,
   `RELAYER_EOA_SECRET_KEY` — written to the root-owned
   `EnvironmentFile=/etc/mydaywas-relayer/env` (mode 0600) at provision time
   from the Paperclip secret store, read by compose via `env_file:` (and by
   the systemd unit via the 10-env.conf drop-in). Never in the repo, never in
   the image, never on the compose command line. Fail-closed boot contract
   unchanged: the process refuses to start on an inconsistent env contract
   (OBS-300 custody guard).
3. **Host image (deploy-time adapter):** `RELAYER_KMS_OPS_MODULE` — path to the
   KMS adapter module implementing `KmsKeyOperations {mac, sign, verify}`
   against the provider SDK (AWS KMS `GenerateMac`/`Sign`/`Verify` or
   equivalent). The adapter carries provider SDK config only; key material
   stays inside the provider and provider credentials reach the adapter via
   the workload identity (`docs/PRODUCTION-IAM.md`), never via files/env.

The app build gets `VITE_RELAYER_URL=https://relayer.mydaywas.com` at **build**
time (Netlify env) per `docs/PRODUCTION-DOMAIN-DECISION.md`.

## Vultr shape (decided, OBS-794)

- **Instance:** 1 Cloud Compute VM (Regular Performance, 1 vCPU / 1 GB / 25 GB
  NVMe — placeholder plan `vc2-1c-1gb`; region placeholder `ewr`), single
  instance, single-writer topology.
- **Volume:** Block Storage 10 GB attached + mounted at `/data`
  (`RELAYER_DB_PATH=/data/mydaywas-relayer.db`) via `cloud-init.yml`.
- **TLS edge:** Caddy container on the same instance (managed Let's Encrypt,
  `x-forwarded-proto: https` enforced in-process via
  `RELAYER_REQUIRE_TLS=1`). No Vultr Load Balancer (would breach the quoted
  hosting line; adds nothing to a single-writer topology).
- **Client IP:** trusted-last-hop `x-forwarded-for` (Caddy, no
  trusted_proxies, overwrites XFF with the direct-socket peer — spoof-safe
  for per-IP rate shaping). Vultr has no provider edge header.
- **Image:** built on-instance from the pinned git revision
  (`relayer/Dockerfile`; the build itself runs typecheck + full vitest).

## Deploy [gated]

1. **Pre-flight gates:** OBS-237 written sign-off recorded; CISO stage-6
   sign-off recorded; IAM policy applied per `docs/PRODUCTION-IAM.md`;
   KMS key objects provisioned (blinder + signer, versioned keyIds);
   `RELAYER_KMS_OPS_MODULE` adapter installed on the image; secrets written
   to `/etc/mydaywas-relayer/env` from the Paperclip secret store.
2. **Build image** from `relayer/Dockerfile` (CI already gates: the build runs
   `npm run typecheck && npm test` inside — a red suite produces no image).
3. **Deploy** one instance (single-writer topology) with the Block Storage
   volume mounted at `/data` (`RELAYER_DB_PATH=/data/mydaywas-relayer.db`).
   Keep `RELAYER_SUBMITTER=dry-run` — the real-submitter cutover is CISO-gated
   (OBS-166) and additionally requires the OBS-237 sign-off.
4. **Verify** (below).
5. **Record** the deployed revision (`RELAYER_BUILD_REVISION`),
   instance/volume ids, and keyIds on the deploy record (OBS-264 evidence).

### Reference commands (placeholders — plan ids/regions set at provisioning)

```bash
# Instance + volume (provisioning is OBS-468, gated on OBS-237):
vultr-cli instance create --label mydaywas-relayer --plan vc2-1c-1gb \
  --region ewr --os "Ubuntu 24.04 LTS x64" \
  --user-data "$(base64 -w0 deploy/cloud-init.yml)"
vultr-cli block-storage create --label mydaywas-relayer-data --size-gb 10 \
  --region ewr --type nvme
vultr-cli block-storage attach <volume-id> --instance-id <instance-id>
# On the instance (after cloud-init + a reboot so the volume attaches):
git fetch --tags && git checkout <pinned-revision>
docker compose --file deploy/docker-compose.yml build relayer
install -m 600 /dev/null /etc/mydaywas-relayer/env   # then write secret values
  # from the Paperclip secret store (never via shell history of the repo)
docker compose --file deploy/docker-compose.yml up -d
# DNS (with the registrar, at LB/edge provisioning — OBS-264 steps 2–3):
#   A/ALIAS relayer.mydaywas.com -> <instance-ip>  (Caddy answers ACME HTTP-01)
```

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
  bundle); DNS unchanged.
- **Relayer:** redeploy the previous image tag (`docker compose up -d` with
  the prior `RELAYER_IMAGE_TAG`); the durable SQLite store
  (dayId → blinded tokens + counts only) survives on the Block Storage volume.
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