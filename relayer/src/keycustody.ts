/**
 * Relayer key custody (R9).
 *
 * Production: the relayer's signing/blinding keys MUST live in a KMS/HSM
 * (e.g. AWS KMS or CloudHSM) with rotation and anomaly monitoring on usage.
 * The `KeyCustody` interface below is the seam; `LocalDevCustody` is the
 * development/staging implementation ONLY:
 *   - generates an ephemeral in-memory Ed25519 key + HMAC blinder at startup,
 *   - persists nothing, exports nothing,
 *   - is acceptable on staging solely because no contract is deployed and no
 *     reconciliation artifact is published anywhere a relying party consumes it.
 * A production deployment replaces it with a KMS-backed implementation and MUST
 * wire rotation + usage-anomaly monitoring before any mainnet recordBatch.
 */

import { createHmac, generateKeyPairSync, sign as edSign, verify as verifyEd, randomBytes, type KeyObject } from "node:crypto";

export interface KeyCustody {
  /** Provider id, e.g. "local-dev" or "aws-kms:key-id". */
  readonly provider: string;
  /** Stable key identifier (no secret material). */
  keyId(): Promise<string>;
  /** HMAC-blinded per-cell contributor token (server-side blinding). */
  cellToken(contributorToken: string, dayId: number, sentiment: string): Promise<string>;
  /** Sign the daily submitted-vs-published reconciliation artifact. */
  signReconciliation(payload: string): Promise<string>;
  /** Verify a reconciliation signature (used by CI/tests and monitors). */
  verifyReconciliation(payload: string, signature: string): Promise<boolean>;
}

export class LocalDevCustody implements KeyCustody {
  readonly provider = "local-dev";
  private readonly blinder: Buffer;
  private readonly publicKey: KeyObject;
  private readonly privateKey: KeyObject;
  private readonly id: string;

  constructor() {
    this.blinder = randomBytes(32);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.id = createHmac("sha256", this.blinder).update("key-id").digest("hex").slice(0, 16);
  }

  async keyId(): Promise<string> {
    return this.id;
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