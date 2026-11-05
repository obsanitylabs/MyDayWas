/**
 * Real-submitter chain wiring (OBS-228 D5 / OBS-313 D1+D8).
 *
 * The production chain submitter path is SELECTABLE BY CONFIGURATION and
 * DEFAULTS TO DRY-RUN. The real cutover itself stays gated on the CISO
 * re-verification of the real-submitter path (OBS-166) and the OBS-237
 * external written sign-off. No mainnet: chain id 1 is refused unconditionally
 * (OBS-86 mainnet path needs its own written sign-off).
 *
 * Key custody (R9, same rules as contracts/deploy.mjs):
 *   - The relayer EOA key NEVER appears in code, argv, comments, or output.
 *     It arrives only via the approved managed secret binding
 *     (env RELAYER_EOA_SECRET_KEY) injected at deploy time.
 *   - The script/module only asserts presence + format; it never prints keys.
 *   - Public Sepolia-class RPCs cannot hold node-managed accounts, so the
 *     sender locally signs an EIP-155 (chain-id protected) legacy transaction
 *     with the secret-injected key and broadcasts eth_sendRawTransaction.
 *
 * D8 (CISO OBS-235 condition 1): `RpcCountsReader.recordedCounts` is the
 * on-chain half of the reconciliation-vs-`BatchRecorded` diff — it reads the
 * authoritative `getCounts(uint32)` state so the monitor can diff the signed
 * reconciliation artifact against what the chain actually recorded.
 */

import { etc as secpUtils, sign as secpSign, verify as secpVerify, getPublicKey as secpGetPublicKey } from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import { BroadcastUncertainError } from "./chain.ts";

// RFC6979 deterministic-k needs an hmac for @noble/secp256k1 sync signing.
secpUtils.hmacSha256Sync = (key, ...msgs) => {
  const h = hmac.create(sha256, key);
  for (const m of msgs) h.update(m);
  return h.digest();
};

/** keccak256("recordBatch(uint32,uint24[3],uint24)")[0:4] — pinned from the compiled artifact. */
export const RECORD_BATCH_SELECTOR = "0f4d576c";
/** keccak256("getCounts(uint32)")[0:4] — pinned from the compiled artifact (verified in tests against @noble). */
export const GET_COUNTS_SELECTOR = "a6b33ea5";

/** Mainnet chain id — refused unconditionally (OBS-86 written sign-off required). */
export const MAINNET_CHAIN_ID = 1;
/** Sepolia staging chain id (OBS-90 decision). */
export const SEPOLIA_CHAIN_ID = 11155111;

/**
 * JSON-RPC error surfaced by a provider. Keeps the JSON-RPC `code` so the
 * submitter can distinguish a DEFINITE pre-broadcast rejection from an
 * ambiguous transport failure (H2/OBS-775). The message text is unchanged from
 * the previous plain `Error` (`rpc <method>: <provider message>`) so existing
 * callers/tests keep their formatting.
 */
export class JsonRpcError extends Error {
  readonly code: number | string | undefined;
  readonly rpcMethod: string;
  constructor(method: string, error: { code?: unknown; message?: unknown }) {
    const message = typeof error.message === "string" ? error.message : "unknown error";
    super(`rpc ${method}: ${message}`);
    this.name = "JsonRpcError";
    this.rpcMethod = method;
    this.code = typeof error.code === "number" || typeof error.code === "string" ? error.code : undefined;
  }
}

/**
 * H2/OBS-775 — DEFINITE pre-broadcast rejection classification.
 *
 * A DEFINITE rejection means the node refused the tx BEFORE putting it in the
 * mempool: the reserved nonce may be returned and the day's ledger claim
 * released (the day stays retryable). Anything not proven definite stays
 * UNCERTAIN: the tx may be in the mempool, so the nonce and claim are kept
 * (releasing them risks a double-commit of add-only on-chain deltas).
 *
 * Recognised JSON-RPC error CODES (provider-independent):
 *   -32700  Parse error            — request body was not parseable; nothing sent.
 *   -32600  Invalid Request        — malformed JSON-RPC request; nothing sent.
 *   -32601  Method not found       — node has no eth_sendRawTransaction; nothing sent.
 *   -32602  Invalid params         — params/calldata rejected before broadcast.
 *
 * Recognised -32000/-32001 message PATTERNS (case-insensitive substrings), the
 * standard geth/Besu/Nethermind txpool rejections:
 *   "nonce too low", "nonce has already been used",
 *   "insufficient funds", "insufficient balance",
 *   "intrinsic gas too low", "exceeds block gas limit",
 *   "transaction underpriced", "replacement transaction underpriced",
 *   "max fee per gas less than block base fee",
 *   "invalid sender", "invalid signature",
 *   "invalid chain id", "invalid chainid",
 *   "invalid transaction", "transaction type not supported",
 *   "unsupported transaction type", "invalid params".
 *
 * Deliberately treated as UNCERTAIN even when a code/message is present:
 *   - "already known" / "known transaction" / "already in the txpool/mempool"
 *     — the node already has the tx, so it may already have been broadcast;
 *   - "timeout" / "timed out" / connection reset/refused/closed / socket hang
 *     up / ECONNRESET / ECONNREFUSED / ETIMEDOUT / EHOSTUNREACH / ENETUNREACH /
 *     EPIPE / "temporarily unavailable" / "service unavailable" / "internal
 *     error" / "try again" / "server error";
 *   - "nonce too high", "txpool is full", "execution reverted" and ANY error
 *     whose code is absent or not in the definite set. Conservative by design.
 *
 * Network-level failures never carry a JSON-RPC code (fetch throws, non-JSON
 * HTTP bodies) and are therefore always UNCERTAIN — we do not classify on
 * loose network-string matching alone.
 */
export const DEFINITE_BROADCAST_REJECTION_CODES: readonly (number | string)[] = [
  -32700,
  -32600,
  -32601,
  -32602,
];

export const DEFINITE_BROADCAST_REJECTION_PATTERNS: readonly RegExp[] = [
  /nonce too low/i,
  /nonce has already been used/i,
  /insufficient funds/i,
  /insufficient balance/i,
  /intrinsic gas too low/i,
  /exceeds (?:the )?block gas limit/i,
  /transaction underpriced/i,
  /replacement transaction underpriced/i,
  /max fee per gas less than block base fee/i,
  /invalid sender/i,
  /invalid signature/i,
  /invalid chain ?id/i,
  /invalid transaction/i,
  /transaction type not supported/i,
  /unsupported transaction type/i,
  /invalid params/i,
];

/** Checked FIRST so an "already known" tx is never released as definite. */
export const UNCERTAIN_BROADCAST_PATTERNS: readonly RegExp[] = [
  /already known/i,
  /known transaction/i,
  /already in (?:the )?(?:tx ?pool|mempool|pool)/i,
  /already (?:exists|imported)/i,
  /timeout|timed out/i,
  /connection (?:reset|refused|closed)/i,
  /socket hang up/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /internal error/i,
  /try again/i,
  /server error/i,
];

/**
 * Classify an `eth_sendRawTransaction` failure. Returns `"definite"` only when
 * the provider's JSON-RPC code/message proves the tx was rejected before
 * broadcast; every other case (including non-JSON-RPC errors) is `"uncertain"`.
 */
export function classifyBroadcastFailure(error: unknown): "definite" | "uncertain" {
  if (!(error instanceof JsonRpcError)) return "uncertain";
  const message = error.message.toLowerCase();
  if (UNCERTAIN_BROADCAST_PATTERNS.some((re) => re.test(message))) return "uncertain";
  if (error.code !== undefined && DEFINITE_BROADCAST_REJECTION_CODES.some((c) => c === error.code)) {
    return "definite";
  }
  if ((error.code === -32000 || error.code === -32001) && DEFINITE_BROADCAST_REJECTION_PATTERNS.some((re) => re.test(message))) {
    return "definite";
  }
  return "uncertain";
}

/** JSON-RPC client (no deps). `fetchImpl` is injectable for tests. */
export class JsonRpc {
  private nextId = 0;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  // OBS-363 D5: plain fields assigned in the constructor body — parameter
  // properties are rejected by Node's strip-only TypeScript mode (this module
  // is in the entrypoint's dynamic-import graph and crashed the launch path).
  constructor(url: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.fetchImpl = fetchImpl;
  }
  async call<T = string>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
    });
    const body = (await res.json()) as {
      result?: T;
      error?: { code?: unknown; message?: unknown };
    };
    if (body.error) throw new JsonRpcError(method, body.error);
    return body.result as T;
  }
}

// --- EIP-155 legacy tx encoding (same code path as contracts/deploy.mjs) -----

const hexToBytes = (h: string): Uint8Array => {
  h = h.replace(/^0x/, "");
  if (h.length % 2) h = "0" + h;
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.substr(i * 2, 2), 16));
};
const bytesToHex = (b: Uint8Array): string => "0x" + [...b].map((v) => v.toString(16).padStart(2, "0")).join("");

function rlp(input: unknown): Uint8Array {
  let bytes: Uint8Array;
  if (Array.isArray(input)) {
    const parts = input.map(rlp);
    const len = parts.reduce((a, p) => a + p.length, 0);
    bytes = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      bytes.set(p, o);
      o += p.length;
    }
    return rlpWrap(bytes, 0xc0);
  }
  if (typeof input === "bigint") {
    bytes = input === 0n ? new Uint8Array(0) : hexToBytes("0x" + input.toString(16));
  } else if (typeof input === "string") {
    bytes = hexToBytes(input);
  } else {
    throw new Error(`rlp: unsupported input ${typeof input}`);
  }
  return rlpWrap(bytes, 0x80);
}
function rlpWrap(b: Uint8Array, offset: number): Uint8Array {
  if (b.length === 1 && (b[0] ?? 0x80) < 0x80 && offset === 0x80) return b;
  if (b.length <= 55) return Uint8Array.from([offset + b.length, ...b]);
  const lenBytes = hexToBytes("0x" + b.length.toString(16)); // minimal length encoding
  return Uint8Array.from([offset + 55 + lenBytes.length, ...lenBytes, ...b]);
}

/**
 * Locally-signing EIP-155 legacy-tx sender for `recordBatch`. One tx per
 * send; nonce is per-process monotonic (bootstrap fetches the pending count).
 * The EOA key is used only in memory to sign; it is never logged or echoed.
 *
 * H2 (OBS-760) corrections:
 *  - **Serialized sends**: `send` calls are chained through a promise mutex, so
 *    concurrent publishes can never read/increment the nonce in an interleaved
 *    way (the old code signed the same nonce for two txs and one dropped).
 *  - **Atomic nonce reservation**: the nonce is reserved (advanced) as part of
 *    the serialized critical section BEFORE broadcast; a definite pre-broadcast
 *    failure gives it back (no stuck gap), an ambiguous failure keeps it (never
 *    reuse a nonce that may be in the mempool).
 *  - **Receipt confirmation**: `send` returns only after
 *    `eth_getTransactionReceipt` reports `status == 1`; a reverted tx
 *    (`status == 0`) throws (a definite no-effect failure), and an unknown
 *    inclusion state throws `BroadcastUncertainError` (the pipeline keeps the
 *    claim). `eth_sendRawTransaction` returning pre-inclusion is no longer
 *    mistaken for a commit.
 */
export interface ReceiptPollOpts {
  /** Max `eth_getTransactionReceipt` attempts before giving up (inclusion unknown). */
  attempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
}

const DEFAULT_RECEIPT_POLL = { attempts: 15, initialDelayMs: 1_000, backoffFactor: 1.5, maxDelayMs: 10_000 } as const;

export class RpcLegacySender {
  private readonly rpc: JsonRpc;
  private readonly keyBytes: Uint8Array;
  private readonly pub65: Uint8Array;
  private nonce: bigint | null = null;
  /** H2.1: serializes sends so concurrent callers never reuse a nonce. */
  private sendQueue: Promise<void> = Promise.resolve();
  readonly eoaAddress: string;
  constructor(opts: {
    rpcUrl: string;
    /** Expected chain id; the connection is refused on any other id. */
    expectedChainId: number;
    /** EOA address (public, checked against the derived key). */
    eoaAddress: string;
    /**
     * EOA private key hex — from the approved managed secret binding only
     * (env RELAYER_EOA_SECRET_KEY); never argv, files, or logs.
     */
    keyHex: string;
    fetchImpl?: typeof fetch;
    /** H2.2: receipt-poll budget (tests inject a no-op `sleep`). */
    receiptPoll?: ReceiptPollOpts;
    /** Injectable sleep (tests pass a no-op so backoff never stalls the suite). */
    sleep?: (ms: number) => Promise<void>;
  }) {
    if (opts.expectedChainId === MAINNET_CHAIN_ID) {
      throw new Error("refusing mainnet (chain id 1): the mainnet path needs its own written sign-off (OBS-86)");
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(opts.eoaAddress)) {
      throw new Error(`invalid EOA address: ${opts.eoaAddress}`);
    }
    if (!opts.keyHex || !/^0x[0-9a-fA-F]{64}$/.test(opts.keyHex)) {
      throw new Error("missing/invalid RELAYER_EOA_SECRET_KEY (must arrive via the approved managed secret binding; never printed)");
    }
    this.rpc = new JsonRpc(opts.rpcUrl, opts.fetchImpl);
    this.keyBytes = hexToBytes(opts.keyHex);
    this.expectedChainId = opts.expectedChainId;
    this.receiptPoll = { ...DEFAULT_RECEIPT_POLL, ...opts.receiptPoll };
    this.sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    this.pub65 = secpGetPublicKey(this.keyBytes, false); // uncompressed 65B (04 || x || y)
    const derived = "0x" + Buffer.from(keccak_256(this.pub65.subarray(1))).slice(-20).toString("hex");
    if (derived.toLowerCase() !== opts.eoaAddress.toLowerCase()) {
      throw new Error("refusing to run: RELAYER_EOA_SECRET_KEY does not control RELAYER_EOA_ADDRESS");
    }
    this.eoaAddress = opts.eoaAddress;
  }

  /**
   * Sign + broadcast one tx to `to` with calldata `data`, then wait for a
   * receipt with `status == 1`. Send calls are serialized (H2.1). Returns the
   * confirmed tx hash. Throws `BroadcastUncertainError` when the tx may have
   * been broadcast but its fate is unknown; throws a plain `Error` for a
   * definite no-effect failure (pre-broadcast fault, or a mined revert).
   */
  async send(to: string, data: string): Promise<string> {
    const run = this.sendQueue.then(() => this.sendSerialized(to, data));
    // Keep the chain alive even if this send rejects, so one failure cannot
    // wedge every subsequent send.
    this.sendQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async sendSerialized(to: string, data: string): Promise<string> {
    const chainId = Number(await this.rpc.call<string>("eth_chainId", []));
    if (chainId !== this.expectedChainId) {
      throw new Error(`chain id mismatch: connected ${chainId}, configured ${this.expectedChainId}`);
    }
    if (this.nonce === null) {
      this.nonce = BigInt(await this.rpc.call<string>("eth_getTransactionCount", [this.eoaAddress, "pending"]));
    }
    const nonce = this.nonce;
    // Reserve the nonce inside the serialized section so no concurrent/queued
    // send can reuse it.
    this.nonce = nonce + 1n;
    let rawTx: string;
    try {
      const gasPriceRaw = BigInt(await this.rpc.call<string>("eth_gasPrice", []));
      const gasPrice = (gasPriceRaw * 150n) / 100n; // 1.5x headroom (same policy as deploy.mjs)
      // recordBatch is a fixed cheap write; 5M is a sane hard cap that still
      // rejects anything unexpected (deploy.mjs needed 50M for the CREATE initcode).
      const gas = 5_000_000n;
      const chainIdBig = BigInt(chainId);
      const unsignedTx = rlp([nonce, gasPrice, gas, "", 0n, data, chainIdBig, 0n, 0n]);
      const msgHash = keccak_256(unsignedTx);
      const sig = secpSign(msgHash, this.keyBytes); // RFC6979 deterministic-k, low-s normalized
      if (!secpVerify(sig, msgHash, this.pub65)) {
        throw new Error("signature self-verification failed");
      }
      const v = BigInt(sig.recovery) + 27n + chainIdBig * 2n + 8n; // EIP-155
      rawTx = bytesToHex(rlp([nonce, gasPrice, gas, "", 0n, data, v, sig.r, sig.s]));
    } catch (e) {
      // Definite pre-broadcast failure: nothing reached the mempool. Give the
      // reserved nonce back so a retry uses it (no stuck nonce gap).
      this.nonce = nonce;
      throw e;
    }
    let txHash: string;
    try {
      txHash = await this.rpc.call<string>("eth_sendRawTransaction", [rawTx]);
    } catch (e) {
      // H2/OBS-775: a DEFINITE JSON-RPC rejection (nonce too low, insufficient
      // funds, intrinsic gas too low, invalid params, replacement underpriced,
      // ...) proves the tx never reached the mempool. Take the same
      // definite-pre-broadcast path as the rawTx build above: give the reserved
      // nonce back and rethrow the plain error so the pipeline releases the
      // ledger claim (the day stays retryable). Anything else is ambiguous —
      // the tx may be in the mempool — so keep the nonce/claim and raise
      // BroadcastUncertainError exactly as before.
      if (classifyBroadcastFailure(e) === "definite") {
        this.nonce = nonce;
        throw e;
      }
      const detail = e instanceof Error ? e.message : String(e);
      throw new BroadcastUncertainError(
        `eth_sendRawTransaction failed after a broadcast attempt (tx may be in the mempool): ${detail}`,
      );
    }
    if (txHash !== bytesToHex(keccak_256(hexToBytes(rawTx)))) {
      throw new BroadcastUncertainError("tx hash mismatch — node echoed an unexpected hash");
    }
    await this.awaitReceipt(txHash);
    return txHash;
  }

  /**
   * H2.2/OBS-778: poll for a receipt. Resolve on status==0x1; plain-throw only
   * on a DEFINITE revert (status==0x0); treat an absent/unknown status, a
   * lookup failure, or a timeout as UNCERTAIN (keep the ledger claim).
   */
  private async awaitReceipt(txHash: string): Promise<void> {
    const poll = this.receiptPoll;
    for (let attempt = 0; attempt < Math.max(1, poll.attempts); attempt++) {
      if (attempt > 0) {
        const delay = Math.min(poll.initialDelayMs * Math.pow(poll.backoffFactor, attempt - 1), poll.maxDelayMs);
        await this.sleep(delay);
      }
      let receipt: { status?: string } | null;
      try {
        receipt = await this.rpc.call<{ status?: string } | null>("eth_getTransactionReceipt", [txHash]);
      } catch (e) {
        throw new BroadcastUncertainError(`receipt lookup failed for ${txHash} (tx state unknown): ${(e as Error).message}`);
      }
      if (receipt === null || receipt === undefined) continue; // not yet included
      if (receipt.status === "0x1") return; // mined and executed
      if (receipt.status === "0x0") {
        // Mined but reverted: recordBatch was rejected (paused / not relayer /
        // out-of-gas) — a DEFINITE no-effect failure, safe to release the claim.
        throw new Error(`recordBatch reverted (receipt status 0x0) for tx ${txHash}`);
      }
      // OBS-778: an ABSENT or UNKNOWN status is not a definite revert. The tx
      // may have been mined with an effect we cannot see; treating it as a
      // definite failure would release the day's ledger claim and let a retry
      // double-commit the add-only per-day counts. Keep the claim (uncertain) —
      // same class as a lookup failure or a receipt timeout.
      throw new BroadcastUncertainError(
        `receipt status unknown (receipt status ${receipt.status ?? "absent"}) for tx ${txHash}: tx state unknown`,
      );
    }
    throw new BroadcastUncertainError(`no receipt for ${txHash} after ${poll.attempts} attempts (inclusion unknown)`);
  }

  private readonly expectedChainId: number;
  private readonly receiptPoll: Required<ReceiptPollOpts>;
  private readonly sleep: (ms: number) => Promise<void>;
}

/**
 * On-chain `BatchRecorded` reader (D8): authoritative per-day counts via
 * `getCounts(uint32)` → `uint24[3]`. Static array, no offsets: 3 words.
 * Used by the reconciliation monitor to diff the signed artifact against
 * the chain. Returns null when nothing is recorded for the day (all zeros).
 */
export class RpcCountsReader {
  private readonly rpc: JsonRpc;
  constructor(opts: { rpcUrl: string; /** AggregateSentimentSignals address (validated). */ address: string; expectedChainId: number; fetchImpl?: typeof fetch }) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(opts.address)) {
      throw new Error(`invalid contract address: ${opts.address}`);
    }
    this.rpc = new JsonRpc(opts.rpcUrl, opts.fetchImpl);
    this.address = opts.address;
    this.expectedChainId = opts.expectedChainId;
  }
  private readonly address: string;
  private readonly expectedChainId: number;
  async recordedCounts(dayId: number): Promise<{ dayId: number; deltas: [number, number, number] } | null> {
    const chainId = Number(await this.rpc.call<string>("eth_chainId", []));
    if (chainId !== this.expectedChainId) {
      throw new Error(`chain id mismatch: connected ${chainId}, configured ${this.expectedChainId}`);
    }
    const data = "0x" + GET_COUNTS_SELECTOR + dayId.toString(16).padStart(64, "0");
    const out = await this.rpc.call<string>("eth_call", [{ to: this.address, data }, "latest"]);
    const hex = out.replace(/^0x/, "");
    if (hex.length !== 3 * 64) throw new Error(`getCounts(${dayId}) did not return uint24[3]: ${out}`);
    // uint24 right-aligned in each 32-byte word.
    const deltas = [0, 1, 2].map((i) => Number(BigInt("0x" + hex.substr(i * 64, 64)))) as [number, number, number];
    if (deltas.every((d) => d === 0)) return null; // nothing recorded (a recorded day always has >=k in a published cell)
    return { dayId, deltas };
  }
}

/** Verify the pinned selectors against keccak at runtime (CI/test guard against drift). */
export function verifyPinnedSelectors(): { recordBatch: boolean; getCounts: boolean } {
  const sel = (sig: string) => Buffer.from(keccak_256(sig)).subarray(0, 4).toString("hex");
  return {
    recordBatch: sel("recordBatch(uint32,uint24[3],uint24)") === RECORD_BATCH_SELECTOR.replace(/^0x/, ""),
    getCounts: sel("getCounts(uint32)") === GET_COUNTS_SELECTOR,
  };
}