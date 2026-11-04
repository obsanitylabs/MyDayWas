/**
 * Chain submission seam.
 *
 * GATE (OBS-83 hard gate): the `AggregateSentimentSignals` contract is NOT
 * deployed anywhere yet. Deployment requires the Chief Auditor review artifact
 * to be recorded on OBS-83 first. Until then the relayer runs with
 * `DryRunSubmitter`, which performs every suppression/T+24h/reconciliation step
 * but commits nothing on-chain. A deployed configuration swaps in
 * `AggregateSentimentSignalsSubmitter` with the authoritative address recorded
 * on OBS-83 — never an address guessed from old docs (the recovered a587a12
 * prototype addresses 0x2337…589 / 0xA13d…42E2 are historical references only).
 */

import type { CellReport } from "./pipeline.ts";
import { log } from "./log.ts";

export interface RecordBatch {
  dayId: number;
  /** [POSITIVE, NEGATIVE, NEUTRAL] deltas to commit. */
  deltas: [number, number, number];
  /** Min distinct contributors across published cells (attested off-chain). */
  publishedContributors: number;
  cells: CellReport[];
  hasPublishedCells: boolean;
}

export interface ChainSubmitter {
  readonly name: string;
  /** Submit ONE recordBatch per day/sentiment set. Returns the submitted batch. */
  submitRecordBatch(batch: RecordBatch): Promise<RecordBatch>;
}

/** Staging default: no chain write, full pipeline + reconciliation only. */
export class DryRunSubmitter implements ChainSubmitter {
  readonly name = "dry-run (contract not deployed; awaiting Chief Auditor review)";
  async submitRecordBatch(batch: RecordBatch): Promise<RecordBatch> {
    if (batch.hasPublishedCells) {
      log("chain", "dry-run recordBatch (would commit on-chain)", batch.dayId);
    } else {
      log("chain", "no recordBatch: every cell below k", batch.dayId);
    }
    return batch;
  }
}

/** Post-audit implementation: submits the real tx to the deployed contract. */
export class AggregateSentimentSignalsSubmitter implements ChainSubmitter {
  readonly name: string;
  readonly address: string;
  private readonly send: (to: string, data: string) => Promise<string>;
  constructor(address: string, send: (to: string, data: string) => Promise<string>) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`invalid contract address: ${address}`);
    this.address = address;
    this.send = send;
    this.name = `aggregate-sentiment-signals@${address.toLowerCase()}`;
  }
  async submitRecordBatch(batch: RecordBatch): Promise<RecordBatch> {
    if (!batch.hasPublishedCells) {
      log("chain", "no recordBatch: every cell below k", batch.dayId);
      return batch;
    }
    // recordBatch(uint32 dayId, uint24[3] sentimentDeltas, uint24 publishedContributors)
    const data = encodeRecordBatch(batch.dayId, batch.deltas, batch.publishedContributors);
    await this.send(this.address, data);
    log("chain", "recordBatch committed", batch.dayId);
    return batch;
  }
}

/** Solidity ABI for recordBatch(uint32,uint24[3],uint24). */
export const RECORD_BATCH_ABI = [
  {
    type: "function",
    name: "recordBatch",
    inputs: [
      { name: "dayId", type: "uint32" },
      { name: "sentimentDeltas", type: "uint24[3]" },
      { name: "publishedContributors", type: "uint24" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** uint24 upper bound (a uint24 value cell is > 2^24 - 1 reverted on-chain). */
export const UINT24_MAX = 0xff_ffff;
/** uint32 upper bound (the dayId parameter). */
export const UINT32_MAX = 0xffff_ffff;

/**
 * Minimal ABI encoder for the fixed recordBatch signature (no deps).
 *
 * C1 (OBS-760, critical): `recordBatch` takes `uint24[SENTIMENTS]` — a FIXED
 * array (`SENTIMENTS = 3`). Its ABI head is therefore 5 STATIC words in the
 * order `dayId, d0, d1, d2, contributors`. The previous encoder emitted the
 * DYNAMIC-array tail (`dayId, 0x60, contributors, 3, d0, d1, d2` = 7 words),
 * which the contract decodes as a *different* batch (deltas `[0x60, contributors,
 * 3]`), permanently corrupting the add-only per-day counts. Corrected here and
 * pinned by a round-trip decode test against the compiled contract ABI.
 */
export function encodeRecordBatch(dayId: number, deltas: [number, number, number], contributors: number): string {
  if (deltas.length !== 3) throw new Error("sentimentDeltas must be length 3");
  const selector = "0x" + selectorFor("recordBatch(uint32,uint24[3],uint24)");
  const words: string[] = [
    hexWord(dayId, UINT32_MAX),
    hexWord(deltas[0], UINT24_MAX),
    hexWord(deltas[1], UINT24_MAX),
    hexWord(deltas[2], UINT24_MAX),
    hexWord(contributors, UINT24_MAX),
  ];
  return selector + words.join("");
}

// keccak256("recordBatch(uint32,uint24[3],uint24)")[0:4], computed by solc-js
// `evm.methodIdentifiers` from contracts/AggregateSentimentSignals.sol (see
// contracts/compile.mjs) — never hand-typed; verified against the compiled ABI.
const PINNED_SELECTORS: Record<string, string> = {
  "recordBatch(uint32,uint24[3],uint24)": "0f4d576c",
};

function selectorFor(sig: string): string {
  const sel = PINNED_SELECTORS[sig];
  if (!sel) throw new Error(`no pinned selector for ${sig}`);
  return sel;
}

function hexWord(n: number, max: number): string {
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`word out of range: ${n} (max ${max})`);
  return n.toString(16).padStart(64, "0");
}

/**
 * H2.3 (OBS-760): raised by a `ChainSubmitter` when a submission MAY have been
 * broadcast (tx hash submitted / receipt unknown) — i.e. the failure is NOT a
 * definitive pre-broadcast failure. The pipeline keeps the day's ledger claim on
 * this error so a retry cannot double-commit add-only deltas; every other throw
 * is treated as a definite no-effect failure and releases the claim.
 */
export class BroadcastUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BroadcastUncertainError";
  }
}
