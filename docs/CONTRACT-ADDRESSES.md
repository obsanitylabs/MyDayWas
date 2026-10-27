# MyDayWas contract addresses — authoritative record (M4, OBS-83)

Status: **There is NO deployed `AggregateSentimentSignals` contract. No address exists yet.**

## Authoritative statement

- The `AggregateSentimentSignals` contract (`contracts/AggregateSentimentSignals.sol`,
  M2 architecture §2) is implemented on branch `m4/signals-v1` but **not deployed to
  any network**. Deployment is blocked until the **Chief Auditor review artifact is
  recorded on OBS-83** (hard gate).
- When it deploys, its address will be recorded **only** on OBS-83 and mirrored here.
  Nothing else is authoritative.
- The relayer runs with `DryRunSubmitter` until that gate clears; no `recordBatch`
  transaction is signed or broadcast from this repository.

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