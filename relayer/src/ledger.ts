/**
 * Per-day publication ledger (F2, OBS-89 binding) — publish idempotency.
 *
 * `recordBatch` is add-only on-chain: re-publishing the same dayId double-commits
 * identical deltas. The pipeline therefore claims a day before submitting and
 * rejects any second claim for an already-published day.
 *
 * Scoping (consistent with F3 design): per-day + per-relayer-instance. A single
 * relayer instance is the only writer to the deployed contract, so its own ledger
 * is authoritative for replay prevention; the durable-store follow-up (F3) swaps
 * the backend without changing this interface or the claim/release protocol.
 *
 * Interface notes:
 *  - Methods are async so a durable backend (SQLite/KV with fsync) can implement
 *    them directly; staging uses the in-memory implementation below, which is
 *    correct for a single process and survives nothing across restarts by design.
 *  - `tryClaim` must be atomic: exactly one concurrent caller claims a given dayId.
 */

export interface PublicationLedger {
  /** Atomically claim publication rights for `dayId`. Returns false iff already claimed/published. */
  tryClaim(dayId: number): Promise<boolean>;
  /** Release a previously claimed day whose submission failed, making it retryable. */
  release(dayId: number): Promise<void>;
}

/** Staging implementation: process-local per-instance map (durable-store-ready interface). */
export class MemoryPublicationLedger implements PublicationLedger {
  private readonly published = new Set<number>();

  async tryClaim(dayId: number): Promise<boolean> {
    if (this.published.has(dayId)) return false;
    this.published.add(dayId);
    return true;
  }

  async release(dayId: number): Promise<void> {
    this.published.delete(dayId);
  }
}
