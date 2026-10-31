# Production deployment model — decision record (OBS-313 D6)

**Owner:** CTO. **Recorded:** 2026-10-31. **Status:** decided (paperwork only).
**No spend or procurement commitment is made by this document** — provisioning
requires CFO/CEO approval routed through Approvals and stays gated on the
OBS-237 external written sign-off.

## Decision: **container/VM on a single persistent-volume instance** (CFO option 2)

Chosen over the CFO's other two models:

| Model | Verdict |
| --- | --- |
| 1. Serverless functions | **Rejected.** The durable SQLite store (F3, OBS-234 re-verification) pins `RELAYER_DB_PATH` to a **local-disk single-writer WAL topology** — serverless filesystems are ephemeral. A datastore redesign would re-open the audited F3 surface. Also, per-request cold starts re-open the day-over-day `CustodyUsageMonitor`/`SybilEarlyWarning` baselines that the CISO preconditions rely on, and would require solving the stable-blinder-across-cold-starts problem that a long-lived instance solves by construction. |
| 2. **Container + VM (chosen)** | Persistent local volume for the WAL; one long-lived process holds warm KMS sessions and the anomaly baselines; fixed cost; full control of the submitter + signed-reconciliation path OBS-237 audits. |
| 3. Managed automation (Gelato/Chainlink-style) | **Rejected.** Forfeits control of `recordBatch` submission and the signed reconciliation artifact path; adds an external protocol party not covered by the frozen audit scope. |

## Provider + topology

- **Provider class:** Fly.io / ECS Fargate / Railway (reference config:
  `deploy/fly.toml`; final provider picked at provisioning inside the same
  cost envelope). 
- **Topology: single writer.** One instance against one persistent volume
  (`/data`). Multi-instance would have to share a host/local volume; not
  planned for the beta — the single writer IS the deployment model (CISO
  OBS-234 precondition on WAL semantics).
- **TLS:** terminates at the platform LB; the process enforces the edge
  itself (`RELAYER_REQUIRE_TLS=1` → `426` on missing `x-forwarded-proto`).
- **Image:** `relayer/Dockerfile` — typecheck + full vitest run inside the
  build; non-root service user; `HEALTHCHECK` on `GET /healthz`.

## Expected monthly cost (inside the board-APPROVED envelope: $9.44/mo planned, $25.00/mo cap)

The board **rejected** the earlier two-thousand-per-month planned /
two-and-a-half-thousand-per-month cap proposal (card `0801aba1`) on
2026-10-31 and **approved** this quote-backed lean envelope (approvals
`063d6679` + `a04b7903`, recorded in OBS-357 `lean-envelope` rev 1). The numbers
below are the recorded quote set, not estimates.

| Item | Quoted |
| --- | --- |
| Fly.io relayer hosting (1 small container/VM + persistent volume) | $3.86/mo |
| AWS KMS — 2 customer-managed keys (HMAC blinder + P-256 signer) | $4.01/mo |
| Alchemy RPC (PAYG, inside the 30M CU free allowance) | $0.00/mo |
| Better Stack monitoring/alerting (free tier + Slack incoming webhook) | $0.00/mo |
| Local LM Studio inference (shared internal hardware) | $0.00/mo |
| **Subtotal** | **$7.87/mo** |
| + 20% contingency | **$9.44/mo planned** |
| **Cap (board-approved ceiling)** | **$25.00/mo** |

### Named exclusions (NOT in the number — each needs a fresh board decision)

- Dedicated HSM (~$2,100–2,400/mo)
- L1 chain (+$150–750/mo)
- Live curated partner network (+$1,000–2,500/mo)
- Better Stack paid Responder seat (+$34/mo)
- Any external inference API
- Anything outside the five quoted lines above (L2 gas, app hosting,
  domain/email, support/ops, audits, legal, taxes, salaries, marketing)

### Shape the approved envelope assumes

**L2 only** (no L1), **Cloud KMS** (no dedicated HSM), **stub-only partner
network**, **local LM Studio** inference, **1,000 MAU**, and a single
**container/VM relayer + persistent local volume** — exactly the model chosen
above. The audit-vendor cost is also a named exclusion of this envelope
(separate CFO-routed path).

**No procurement, no vendor commitment until a signed quote is in place** —
the envelope is a ceiling, not a purchase; provisioning stays gated on the
OBS-237 external written sign-off (see `docs/PRODUCTION-DEPLOYMENT.md` §5/§6).

## Custody (per `docs/PRODUCTION-CHECKLIST.md` §1)

- **Cloud KMS**, two provider-side key objects: blinder (HMAC) + signer
  (artifact signing). Never one key for both purposes (OBS-87).
- Implementation: `KmsCustody` (`relayer/src/keycustody.ts`) over a
  deploy-time ops adapter (`RELAYER_KMS_OPS_MODULE`). Key material stays
  provider-side; the process only holds versioned keyIds
  `<provider>/<purpose>/v<n>#<fingerprint>`.
- **Stable blinder** (CISO precondition, OBS-234): the blinder key object is
  persistent provider-side state, so restarts do not re-open the
  new-account counter. The OBS-300 guard refuses to start a durable-profile
  process on ephemeral `LocalDevCustody`.
- IAM: least-privilege policy in `docs/PRODUCTION-IAM.md` —
  `sign`/`mac-generate` on exactly the two key objects, nothing else.

## Chain

Staging stays Sepolia (`0xEdeAC98…5f35C`, audited baseline `6c418fc`).
Production chain is **L2-by-default, subject to its own written approval**;
mainnet (chain id 1) is refused by code (`relayer/src/chainrpc.ts`) and needs
its own written sign-off (OBS-86). The real-submitter path is implemented and
**selectable by configuration (`RELAYER_SUBMITTER`), default dry-run**; the
cutover is gated on the CISO re-verification (OBS-166) + OBS-237 sign-off.

## Backup / restore

- The durable store holds only blinded tokens + integer counts (no content
  exists to leak; `relayer/src/durable.ts` privacy header). 
- **Volume snapshots** are the backup primitive: snapshot the volume on a
  schedule and before every deploy/rotation.
- **Restore** = stop instance → attach snapshot → restart → verify
  `GET /healthz` → `db.reachable=true`. Restores that rewind replay-prevention
  state (`published_day`) must be coordinated with the Chief Auditor — a
  rewound ledger claim could re-open a published dayId against the
  replay-guard; the on-chain `BatchRecorded` events remain the authoritative
  cross-check for the reconciliation monitor.

## Rotation + rollback

- Rotation: see the runbook in `docs/PRODUCTION-CHECKLIST.md` §1 (distinct
  schedules; UTC-day-boundary rule for the blinder; old signer public keys
  retained indefinitely for artifact verification).
- Rollback: see `deploy/README.md` (app = Netlify rollback; relayer = previous
  image, volume survives; contract = `pause()` brake per checklist §6).