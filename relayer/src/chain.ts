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

/** Minimal ABI encoder for the fixed recordBatch signature (no deps). */
export function encodeRecordBatch(dayId: number, deltas: [number, number, number], contributors: number): string {
  if (deltas.length !== 3) throw new Error("sentimentDeltas must be length 3");
  const selector = "0x" + selectorFor("recordBatch(uint32,uint24[3],uint24)");
  const words: string[] = [];
  words.push(hexWord(dayId));
  words.push(hexWord(0x60)); // offset of uint24[3] in the dynamic tail
  words.push(hexWord(contributors));
  // dynamic tail: length + 3 elements (each uint24 right-aligned in a 32-byte word)
  words.push(hexWord(3));
  for (const d of deltas) words.push(hexWord(d));
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

function hexWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error(`word out of range: ${n}`);
  return n.toString(16).padStart(64, "0");
}