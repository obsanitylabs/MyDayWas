/**
 * Relayer key custody (R9 / OBS-87 binding checklist).
 *
 * Production: the relayer's signing/blinding keys MUST live in a KMS/HSM
 * (e.g. AWS KMS or CloudHSM) with rotation and anomaly monitoring on usage.
 * OBS-87 requires SEPARATE keys for HMAC-blinding vs reconciliation-signing,
 * each with a VERSIONED keyId (`<provider>/<purpose>/v<n>#<fingerprint>`) so
 * rotation is observable in artifacts and logs. The interfaces below are the
 * seam; `LocalDevCustody` is the development/staging implementation ONLY:
 *   - generates an ephemeral in-memory Ed25519 key + HMAC blinder at startup
 *     (separate material for the two purposes, versioned keyIds),
 *   - persists nothing, exports nothing,
 *   - is acceptable on staging solely because no contract is deployed and no
 *     reconciliation artifact is published anywhere a relying party consumes it.
 * A production deployment replaces it with a KMS-backed implementation and MUST
 * wire rotation + usage-anomaly monitoring (see CustodyUsageMonitor) before
 * any mainnet recordBatch.
 */

import { createHmac, generateKeyPairSync, sign as edSign, verify as verifyEd, randomBytes, type KeyObject } from "node:crypto";
import { Alerts } from "./log.ts";

/** HMAC cell-blinding custody (server-side blinding of contributor tokens). */
export interface CellBlinder {
  /** Versioned key identifier for the BLINDING key (no secret material). */
  blinderKeyId(): Promise<string>;
  /** HMAC-blinded per-cell contributor token (server-side blinding). */
  cellToken(contributorToken: string, dayId: number, sentiment: string): Promise<string>;
}

/** Reconciliation-signing custody (daily submitted-vs-published artifact). */
export interface ReconciliationSigner {
  /** Versioned key identifier for the SIGNING key (no secret material). */
  signerKeyId(): Promise<string>;
  /** Sign the daily submitted-vs-published reconciliation artifact. */
  signReconciliation(payload: string): Promise<string>;
  /** Verify a reconciliation signature (used by CI/tests and monitors). */
  verifyReconciliation(payload: string, signature: string): Promise<boolean>;
}

/** Legacy stable alias for the signing keyId (was the only keyId pre-OBS-87). */
export interface KeyCustody extends CellBlinder, ReconciliationSigner {
  /** Provider id, e.g. "local-dev" or "aws-kms:key-id". */
  readonly provider: string;
  keyId(): Promise<string>;
}

/** Day (UTC) → per-purpose op counts. Integer counts only — no payload data. */
export interface CustodyUsageCounts {
  blindingOps: Map<number, number>;
  signingOps: Map<number, number>;
}

/**
 * OBS-87: usage-anomaly monitoring on key usage. Wraps a custody instance,
 * counts blinding/signing operations per UTC day, and raises
 * `custody_usage_anomaly` when today's op count exceeds
 * `spikeFactor × max(prevTwoDays)` and the absolute `floor`. Counts are
 * in-memory per process (deployment config aggregates across instances via
 * the alert sink).
 */
export class CustodyUsageMonitor implements KeyCustody {
  readonly provider: string;
  private readonly blindingOps = new Map<number, number>();
  private readonly signingOps = new Map<number, number>();

  constructor(
    inner: KeyCustody,
    alerts: Alerts,
    opts: { spikeFactor?: number; floor?: number } = {},
  ) {
    this.inner = inner;
    this.alerts = alerts;
    this.provider = inner.provider;
    this.spikeFactor = opts.spikeFactor ?? 5;
    this.floor = opts.floor ?? 200;
  }

  private readonly inner: KeyCustody;
  private readonly alerts: Alerts;
  private readonly spikeFactor: number;
  private readonly floor: number;

  private async track(map: Map<number, number>, purpose: string): Promise<void> {
    const day = Math.floor(Date.now() / 86_400_000);
    const n = (map.get(day) ?? 0) + 1;
    map.set(day, n);
    const spike = this.spikeFactor;
    const floor = this.floor;
    const prev = Math.max(map.get(day - 1) ?? 0, map.get(day - 2) ?? 0);
    if (prev >= floor && n > prev * spike) {
      this.alerts.raise(
        "custody_usage_anomaly",
        `${purpose} op count ${n} exceeds ${spike}x the recent day-over-day baseline — possible key misuse or credential compromise`,
        Date.now(),
      );
    }
  }

  async keyId(): Promise<string> {
    return this.inner.keyId();
  }
  async blinderKeyId(): Promise<string> {
    return this.inner.blinderKeyId();
  }
  async signerKeyId(): Promise<string> {
    return this.inner.signerKeyId();
  }
  async cellToken(contributorToken: string, dayId: number, sentiment: string): Promise<string> {
    await this.track(this.blindingOps, "blinding");
    return this.inner.cellToken(contributorToken, dayId, sentiment);
  }
  async signReconciliation(payload: string): Promise<string> {
    await this.track(this.signingOps, "signing");
    return this.inner.signReconciliation(payload);
  }
  async verifyReconciliation(payload: string, signature: string): Promise<boolean> {
    return this.inner.verifyReconciliation(payload, signature);
  }
  /** Snapshot of per-day op counts (monitor/alert-sink input; counts only). */
  usageCounts(): CustodyUsageCounts {
    return { blindingOps: new Map(this.blindingOps), signingOps: new Map(this.signingOps) };
  }
}

export class LocalDevCustody implements KeyCustody {
  readonly provider = "local-dev";
  private readonly blinder: Buffer;
  private readonly publicKey: KeyObject;
  private readonly privateKey: KeyObject;
  private readonly blinderId: string;
  private readonly signerId: string;

  constructor() {
    this.blinder = randomBytes(32);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    // OBS-87: versioned keyIds, one per purpose, fingerprints only (no material).
    this.blinderId = `local-dev/blinder/v1#${createHmac("sha256", this.blinder).update("blinder-id").digest("hex").slice(0, 16)}`;
    this.signerId = `local-dev/signer/v1#${createHmac("sha256", this.blinder).update("signer-id").digest("hex").slice(0, 16)}`;
  }

  async keyId(): Promise<string> {
    return this.signerId;
  }
  async blinderKeyId(): Promise<string> {
    return this.blinderId;
  }
  async signerKeyId(): Promise<string> {
    return this.signerId;
  }

  async cellToken(contributorToken: string, dayId: number, sentiment: string): Promise<string> {
    return createHmac("sha256", this.blinder)
      .update(`${dayId}|${sentiment}|${contributorToken}`)
      .digest("hex");
  }

  async signReconciliation(payload: string): Promise<string> {
    return edSign(null, Buffer.from(payload), this.privateKey).toString("base64");
  }

  async verifyReconciliation(payload: string, signature: string): Promise<boolean> {
    try {
      return verifyEd(null, Buffer.from(payload), this.publicKey, Buffer.from(signature, "base64"));
    } catch {
      return false;
    }
  }
}