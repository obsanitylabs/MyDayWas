/**
 * Publication pipeline — server-enforced T+24h delay, below-k suppression,
 * one `recordBatch` per (dayId, sentiment set), and the signed daily
 * submitted-vs-published reconciliation artifact (R9).
 */

import { MS_PER_DAY, SENTIMENTS, type Sentiment } from "./types.ts";
import type { SignalStore } from "./store.ts";
import type { KeyCustody } from "./keycustody.ts";
import type { ChainSubmitter, RecordBatch } from "./chain.ts";
import { log } from "./log.ts";
import { MemoryPublicationLedger, type PublicationLedger } from "./ledger.ts";

/** k-anonymity threshold: a cell is only ever committed if it has >= k distinct contributors. */
export const K_THRESHOLD = 100;
/** Publication delay: day D may only be committed after D+1 00:00 UTC. */
export const PUBLICATION_DELAY_MS = MS_PER_DAY; // T+24h, enforced server-side.

export const RECONCILIATION_SCHEMA = "mydaywas.reconciliation.v1";

export interface CellReport {
  sentiment: Sentiment;
  submittedContributors: number;
  submittedSubmissions: number;
  published: boolean;
  publishedDelta: number;
}

export interface ReconciliationArtifact {
  schema: typeof RECONCILIATION_SCHEMA;
  /** The UTC day this artifact was generated for. */
  generatedForDay: number;
  /** The UTC day the artifact was produced on (day resolution). */
  producedOnDay: number;
  /** Relayer key custody provider + key id that signed it. */
  signedBy: { provider: string; keyId: string };
  cells: CellReport[];
  chain: { submitter: string; recordBatch: RecordBatch | null };
  /** Signature over the canonical JSON of everything above. */
  signature: string;
}

export type UnsignedReconciliation = Omit<ReconciliationArtifact, "signature">;

export class NotYetPublishable extends Error {
  readonly dayId: number;
  readonly nowMs: number;
  constructor(dayId: number, nowMs: number) {
    super(`day ${dayId} not publishable before ${(dayId + 1) * MS_PER_DAY}ms`);
    this.dayId = dayId;
    this.nowMs = nowMs;
  }
}

/** F2 (binding): re-publishing an already-published day would double-commit add-only deltas. */
export class AlreadyPublished extends Error {
  readonly dayId: number;
  constructor(dayId: number) {
    super(`day ${dayId} already published by this relayer instance`);
    this.dayId = dayId;
  }
}

/** Day D is publishable only at/after 00:00 UTC on D+1 (T+24h). */
export function publishableAt(dayId: number): number {
  return (dayId + 1) * MS_PER_DAY;
}

export class PublicationPipeline {
  private readonly store: SignalStore;
  private readonly custody: KeyCustody;
  private readonly chain: ChainSubmitter;
  private readonly ledger: PublicationLedger;
  private readonly opts: { kThreshold?: number; delayMs?: number };

  constructor(
    store: SignalStore,
    custody: KeyCustody,
    chain: ChainSubmitter,
    opts: { kThreshold?: number; delayMs?: number; ledger?: PublicationLedger } = {},
  ) {
    this.store = store;
    this.custody = custody;
    this.chain = chain;
    // F2 (binding): per-day replay guard. Staging default is the process-local map;
    // a durable-store backend drops in via opts without protocol changes (F3).
    this.ledger = opts.ledger ?? new MemoryPublicationLedger();
    this.opts = opts;
  }

  get k(): number {
    return this.opts.kThreshold ?? K_THRESHOLD;
  }

  get delayMs(): number {
    return this.opts.delayMs ?? PUBLICATION_DELAY_MS;
  }

  /**
   * Build the suppressed batch for one day. BELOW-k CELLS ARE SUPPRESSED HERE,
   * BEFORE ANYTHING TOUCHES THE CHAIN. One recordBatch covers the whole day's
   * sentiment set (up to 3 deltas); if every cell is below k, no tx at all.
   * Delta per published cell = number of distinct contributors, so the on-chain
   * aggregate counts contributors, not raw (re-)submissions.
   * @throws NotYetPublishable if the T+24h window has not passed.
   */
  buildBatch(dayId: number, nowMs: number): RecordBatch {
    // The effective delay never drops below T+24h, whatever config says.
    const effectiveDelay = Math.max(this.delayMs, MS_PER_DAY);
    if (nowMs < publishableAt(dayId) + (effectiveDelay - MS_PER_DAY)) {
      throw new NotYetPublishable(dayId, nowMs);
    }
    let publishedContributors = 0;
    let seen = false;
    const deltas: [number, number, number] = [0, 0, 0];
    const cells: CellReport[] = [];
    for (const sentiment of SENTIMENTS) {
      const stats = this.store.stats(dayId, sentiment);
      const publish = stats.contributors >= this.k;
      const delta = publish ? stats.contributors : 0;
      deltas[SENTIMENTS.indexOf(sentiment)] = delta;
      if (publish) {
        publishedContributors = seen ? Math.min(publishedContributors, stats.contributors) : stats.contributors;
        seen = true;
      }
      cells.push({
        sentiment,
        submittedContributors: stats.contributors,
        submittedSubmissions: stats.submissions,
        published: publish,
        publishedDelta: delta,
      });
    }
    return {
      dayId,
      deltas,
      publishedContributors,
      cells,
      hasPublishedCells: seen,
    };
  }

  /**
   * Commit one day's suppressed batch: one `recordBatch` per day/sentiment set,
   * then emit the signed daily submitted-vs-published reconciliation artifact.
   *
   * F1 (binding): the signature is produced AFTER submission and covers exactly
   * what was sent (`result`). The returned artifact is never post-substituted,
   * so a submitter that mutates the batch cannot pass verification by coincidence:
   * any artifact carrying a different recordBatch than the one submitted fails.
   *
   * F2 (binding): claims `dayId` in the publication ledger before submitting and
   * rejects re-publishes with AlreadyPublished (add-only on-chain deltas would
   * otherwise double-commit). The claim is released ONLY when submission itself
   * failed; any later failure (signing/custody) keeps it, so a retry cannot
   * double-commit an already-sent batch.
   */
  async publishDay(dayId: number, nowMs: number): Promise<ReconciliationArtifact> {
    // Read-only gate first: unpublishable days must not consume a ledger claim.
    const batch = this.buildBatch(dayId, nowMs);
    if (!(await this.ledger.tryClaim(dayId))) throw new AlreadyPublished(dayId);

    let result: RecordBatch;
    try {
      result = await this.chain.submitRecordBatch(batch);
    } catch (e) {
      // Trust assumption: submitters throw only when no chain effect occurred,
      // so releasing makes the day safely retryable.
      await this.ledger.release(dayId);
      throw e;
    }

    const producedOnDay = Math.floor(nowMs / MS_PER_DAY);
    const unsigned: UnsignedReconciliation = {
      schema: RECONCILIATION_SCHEMA,
      generatedForDay: dayId,
      producedOnDay,
      signedBy: { provider: this.custody.provider, keyId: await this.custody.keyId() },
      cells: batch.cells,
      // Sign AFTER submit: the artifact carries exactly what was sent to chain.
      chain: { submitter: this.chain.name, recordBatch: result.hasPublishedCells ? result : null },
    };
    const signature = await this.custody.signReconciliation(canonical(unsigned));
    log(
      "pipeline",
      batch.hasPublishedCells ? "recordBatch committed" : "all cells below k; nothing committed",
      dayId,
      batch.deltas.reduce((a, b) => a + b, 0),
    );
    return { ...unsigned, signature };
  }

  /** Verify a reconciliation artifact signature (CI + monitor hook). */
  async verifyArtifact(artifact: ReconciliationArtifact): Promise<boolean> {
    const { signature, ...rest } = artifact;
    return this.custody.verifyReconciliation(canonical(rest), signature);
  }
}

/** Stable JSON for signing: sorted keys, no whitespace. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}