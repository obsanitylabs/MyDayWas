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
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
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
 */
export class RpcLegacySender {
  private readonly rpc: JsonRpc;
  private readonly keyBytes: Uint8Array;
  private readonly pub65: Uint8Array;
  private nonce: bigint | null = null;
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
    this.pub65 = secpGetPublicKey(this.keyBytes, false); // uncompressed 65B (04 || x || y)
    const derived = "0x" + Buffer.from(keccak_256(this.pub65.subarray(1))).slice(-20).toString("hex");
    if (derived.toLowerCase() !== opts.eoaAddress.toLowerCase()) {
      throw new Error("refusing to run: RELAYER_EOA_SECRET_KEY does not control RELAYER_EOA_ADDRESS");
    }
    this.eoaAddress = opts.eoaAddress;
  }

  /** Sign + broadcast one tx to `to` with calldata `data`. Returns the tx hash. */
  async send(to: string, data: string): Promise<string> {
    const chainId = Number(await this.rpc.call<string>("eth_chainId", []));
    if (chainId !== this.expectedChainId) {
      throw new Error(`chain id mismatch: connected ${chainId}, configured ${this.expectedChainId}`);
    }
    if (this.nonce === null) {
      this.nonce = BigInt(await this.rpc.call<string>("eth_getTransactionCount", [this.eoaAddress, "pending"]));
    }
    const gasPriceRaw = BigInt(await this.rpc.call<string>("eth_gasPrice", []));
    const gasPrice = (gasPriceRaw * 150n) / 100n; // 1.5x headroom (same policy as deploy.mjs)
    // recordBatch is a fixed cheap write; 5M is a sane hard cap that still
    // rejects anything unexpected (deploy.mjs needed 50M for the CREATE initcode).
    const gas = 5_000_000n;
    const chainIdBig = BigInt(chainId);
    const unsignedTx = rlp([this.nonce, gasPrice, gas, "", 0n, data, chainIdBig, 0n, 0n]);
    const msgHash = keccak_256(unsignedTx);
    const sig = secpSign(msgHash, this.keyBytes); // RFC6979 deterministic-k, low-s normalized
    if (!secpVerify(sig, msgHash, this.pub65)) {
      throw new Error("signature self-verification failed");
    }
    const v = BigInt(sig.recovery) + 27n + chainIdBig * 2n + 8n; // EIP-155
    const rawTx = bytesToHex(rlp([this.nonce, gasPrice, gas, "", 0n, data, v, sig.r, sig.s]));
    const txHash = await this.rpc.call<string>("eth_sendRawTransaction", [rawTx]);
    if (txHash !== bytesToHex(keccak_256(hexToBytes(rawTx)))) {
      throw new Error("tx hash mismatch — node echoed an unexpected hash");
    }
    this.nonce = (this.nonce ?? 0n) + 1n;
    return txHash;
  }

  private readonly expectedChainId: number;
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