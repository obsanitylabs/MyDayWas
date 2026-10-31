# MyDayWas contract addresses — authoritative record (M4, OBS-83)

Status: **`AggregateSentimentSignals` is deployed to STAGING (Sepolia, chain 11155111). Mainnet: not deployed, and nothing here authorizes mainnet.**

## Authoritative statement

- **Staging (Sepolia, chain id 11155111): `AggregateSentimentSignals` at
  `0xEdeAC9827760CF9AD4D66e17D216F93fe025f35C`**
  (tx `0x8af08c7a7150ab38ffcdd98b3c586545f825bb1f555f5748343cbb5e5c631a23`,
  block 12033039; deployed 2026-10-31 via `contracts/deploy.mjs`, `m4/signals-v1`).
  Deployer/initial owner: `0xCdC39FD5e8befDB9E95E0219E4f69Ae67c24A90c` (two-step
  ownership permits later transfer without redeploy). Relayer EOA:
  `0xD4b73fb5D7AAdC3Ef0f05F84F43a57D2a294D05c`. On-chain verification passed:
  `owner()`, `relayer()`, `pendingOwner()==0`, `paused()==false`,
  `getCounts(0)==[0,0,0]`, `recordBatch` selector `0x0f4d576c`,
  runtime bytecode matches compiled artifact.
- This is the license-bearing revision: the contract source carries
  `SPDX-License-Identifier: Apache-2.0` per the CEO license decision (OBS-239,
  applied on OBS-241), so the deployed runtime bytecode is byte-for-byte
  identical to the published, Apache-2.0-licensed source artifact
  (solc 0.8.24, optimizer runs 200, evmVersion cancun).
- **Superseded staging deployment (2026-10-30, OBS-90): `AggregateSentimentSignals`
  at `0x012b840cC9fEd21322f3bA180f3B546E5564EFA7`**
  (tx `0xfdaa64e9cd48afff7bc35ee888b56b7824efbd76eb3964f1bdeddce7466fdeae`,
  block 12025670). Deployed from the pre-license (`UNLICENSED` SPDX) source; its
  runtime bytecode matched that artifact exactly. It remains on Sepolia as a
  historical record but is NO LONGER the authoritative staging deployment: after
  the Apache-2.0 SPDX header change the appended solc metadata hash changes (first
  runtime-bytecode divergence at hex char 5508; logic identical), so that
  deployment no longer byte-matches the published source. Use
  `0xEdeAC98…5f35C` above.
- Deployed from the `m4/signals-v1` revision recorded on OBS-83 (Chief Auditor
  APPROVE gate cleared, OBS-86; CISO staging sign-off OBS-87); the 2026-10-31
  license-bearing redeploy is authorized by OBS-239/OBS-241 (staging Sepolia
  only, no user funds). The address is
  recorded authoritatively on OBS-83 and mirrored here; nothing else is authoritative.
- The relayer continues on `DryRunSubmitter` on staging until the OBS-89 F1/F2
  follow-up lands and CISO re-verifies; no production `recordBatch` traffic is
  authorized from this record.
- **Mainnet: NOT deployed.** OBS-86 requires an external audit plus separate
  written sign-off before any mainnet deployment; no such sign-off exists.

## Historical addresses (NOT authoritative, NOT deployed by us)

The recovered a587a12 prototype (branch `recover/app-a587a12`, **prohibited from
deployment**, per M2 §8) contained conflicting address references:

| Where (recovered branch) | Address | Note |
| --- | --- | --- |
| `README.md:60`, `src/services/japanSmartChain.ts:105` | `0x23379e41109909f112F7619b17D403D4Cc70d589` | prototype `EmotionalDiary`, per-user ciphertext design; never ours to use |
| `PROGRESS.md:53` | `0xA13d1A9b4403Eda503cd8213eeFF0052520D42E2` | conflicting "deployed" claim for the same prototype |

Both refer to the prohibited prototype. The conflict is resolved by declaring both
**historical references only**: no shipped doc, UI, or relayer configuration may
present either address as a MyDayWas deployment. The M3/M4 staging builds
(`gh-pages` → `/recovered/`) contain no contract references, and the M4 relayer
(`relayer/src/chain.ts`) hard-rejects any submitter instantiated without a
checksum-form address recorded from OBS-83 after the audit gate.

## Prohibitions carried forward (M2 §8 / CISO-confirmed)

- `EmotionalDiary.sol` @ a587a12 and its `getUserEntriesFor` accessor must never be deployed.
- The a587a12 XOR `encryptionService.ts` scheme is broken and must never be reused.
- Per-user storage/readers/attribution must never exist on-chain.