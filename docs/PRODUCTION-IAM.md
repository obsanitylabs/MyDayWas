# Least-privilege IAM policy — relayer service identity (OBS-313 D5 / OBS-87 §2)

**Owner:** CTO (+ CISO review on apply). **Applies to:** the production relayer
workload identity (container/VM instance role / service account) on the chosen
provider (see `docs/PRODUCTION-DEPLOY-MODEL.md`). Provisioning is [gated] on
the OBS-237 sign-off; this document is the policy of record to apply then.

## 1. KMS — exactly two key objects, two operations, nothing else

The workload identity may perform **`sign`** and **`mac-generate`** on
**exactly two key objects**:

| Key object | Purpose | Operations | keyId (observable form) |
| --- | --- | --- | --- |
| `RELAYER_KMS_BLINDER_KEY_ARN` | HMAC cell-blinding (`CellBlinder`) | `mac-generate` (+ `mac-verify` if the provider splits it) | `<provider>/blinder/v<n>#<fingerprint>` |
| `RELAYER_KMS_SIGNER_KEY_ARN` | Reconciliation artifact signing (`ReconciliationSigner`) | `sign` (+ `verify` for `verifyReconciliation`) | `<provider>/signer/v<n>#<fingerprint>` |

**Explicitly denied / not granted:**
- `decrypt` / `encrypt` — the relayer has no envelope-decryption duty.
- KMS admin plane: `CreateKey`, `DeleteKey`, `RotateKey*`, `PutKeyPolicy`,
  `UpdateKey*`, `ScheduleKeyDeletion`, `TagResource` — **no key-create, no
  admin, no self-service rotation** (rotation is a human + runbook action;
  see `docs/PRODUCTION-CHECKLIST.md` §1).
- `GetKeyPolicy`/`ListKeys` beyond what the provider needs to resolve the two
  ARNs (scope the statement to the two ARNs, not the account).
- Export of key material (`GetPublicKey` **only** on the signer key object —
  needed for artifact verification by relying parties; never on the blinder,
  which is symmetric and must be exportable by nobody, including us).

Rotation changes the ARN version → the policy of record pins the **keyIds'**
version numbers in config, and the IAM statement follows the new ARN. The
OBS-300 custody guard fails the process closed if the env contract is
inconsistent.

## 2. Network surface

### Ingress
- **`443/tcp` (TLS) at the LB** → `8081/tcp` internal to the relayer process.
  The process itself enforces `x-forwarded-proto: https`
  (`RELAYER_REQUIRE_TLS=1`, `426` otherwise).
- **`/healthz`** is the only probe surface (TLS-exempt by design so plain
  local HTTP LB probes succeed; carries readiness data only — no payload data,
  no secrets).
- No other ports, no direct instance exposure (no SSH with password; any
  ops access is via the platform's session tooling, which is audited).

### Egress (allow-list)
| Destination | Purpose |
| --- | --- |
| Provider KMS endpoint (TLS) | `mac-generate` / `sign` / `verify` on the two key objects |
| Chain RPC endpoint (`RELAYER_CHAIN_RPC`, TLS) | `eth_call` (`getCounts`), and `eth_sendRawTransaction` **only after the gated real-submitter cutover** (`RELAYER_SUBMITTER=real`; default dry-run makes no tx calls) |
| Ops alert sink (`RELAYER_ALERT_WEBHOOK`, TLS) | POST `{reason, raisedDay, detail}` on alerts |
| Package/registry pull at image build | build-time only (CI/builder), not runtime egress |

Default-deny everything else; in particular **no general Internet egress**
from the runtime identity (the workload needs exactly the three endpoints
above + DNS).

## 3. Secret sources (nothing in the repo, ever)

| Secret | Source | Reach |
| --- | --- | --- |
| `RELAYER_ALERT_WEBHOOK` | Paperclip secret store → platform secret store | runtime env, never logged (alert sink sends reason+day only) |
| `RELAYER_EOA_SECRET_KEY` | Paperclip secret store (CISO custody handover per checklist §7) → platform secret store | in-memory only: signs EIP-155 legacy txs; validated against `RELAYER_EOA_ADDRESS` at boot, never printed |
| KMS provider credentials | Workload identity (IAM role / workload identity federation) — **not** static keys, **not** env | the ops adapter (`RELAYER_KMS_OPS_MODULE`) resolves them from the platform identity |
| `RELAYER_KMS_OPS_MODULE` | Installed on the image at provision time (deploy-time config; SDK config only, no key material) | filesystem path |

Non-secret config (`RELAYER_PORT`, `RELAYER_REQUIRE_TLS`,
`RELAYER_RATE_PER_MIN`, `RELAYER_DB_PATH`, `RELAYER_SUBMITTER`,
`RELAYER_CHAIN_ID`, `RELAYER_CHAIN_ADDRESS`, `RELAYER_EOA_ADDRESS`,
`RELAYER_KMS_*`, `RELAYER_BUILD_REVISION`) is platform env, injected at deploy
time per `deploy/README.md`.

## 4. Storage

- `RELAYER_DB_PATH` on the **persistent local volume only** (`/data`,
  single-writer topology — CISO OBS-234). No network filesystems. The
  database contains blinded tokens + integer counts only
  (`relayer/src/durable.ts`), so a volume snapshot carries no content.
- Volume access is instance-scoped; snapshot/restore operations are
  administrator-plane, not workload-identity permissions.