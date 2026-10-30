/**
 * Staging deploy tooling for AggregateSentimentSignals (OBS-90, parent OBS-83).
 *
 * AUTHORIZATION GATES (do not bypass):
 *   - Staging ONLY. No production/mainnet deploy from this script (OBS-86:
 *     mainnet needs an external audit + separate written sign-off).
 *   - Staging deployment is authorized by Chief Auditor APPROVE (OBS-86,
 *     `m4/signals-v1` @ 4af9053) and CISO approve-with-changes (OBS-87,
 *     staging DryRunSubmitter scope).
 *
 * KEY CUSTODY (R9 / KeyCustody seam):
 *   - The deployer private key NEVER appears in code, argv, comments, issues,
 *     or output. It lives in the Paperclip secret store and is injected into
 *     the run environment via an approved binding (env.STAGING_DEPLOYER_SECRET_KEY).
 *     The script only asserts env presence; it never prints the key.
 *   - Public Sepolia RPCs cannot hold node-managed accounts, so `eth_sendTransaction`
 *     from a custody-held account is not possible there. Instead this script
 *     locally signs an EIP-155 (chain-id protected) legacy transaction with the
 *     secret-injected key and broadcasts `eth_sendRawTransaction`.
 *   - Legacy footgun env names (DEPLOYER_PRIVATE_KEY / STAGING_PRIVATE_KEY) are
 *     rejected to force the single sanctioned key path.
 *
 * CHAIN GATE:
 *   - Sepolia only (chain id 11155111) — per the OBS-90 user decision.
 *   - Any other chain id (incl. mainnet 1) is a hard refusal.
 *   - Exception: chain id 31337 (local anvil) is allowed ONLY with
 *     STAGING_DEV_CHAIN=anvil, for end-to-end script verification.
 *
 * USAGE (staging):
 *   STAGING_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
 *   STAGING_DEPLOYER_ADDRESS=0x…  \
 *   STAGING_OWNER_ADDRESS=0x… \
 *   STAGING_RELAYER_EOA=0x… \
 *   STAGING_DEPLOYER_SECRET_KEY=(injected by the Paperclip secret binding) \
 *   node contracts/deploy.mjs
 *
 * OUTPUT: prints the deployed address ONLY after on-chain verification
 * (code present, correct relayer/owner, recordBatch selector pinned from the
 * compiled artifact). The authoritative record is OBS-83 + mirrored in
 * docs/CONTRACT-ADDRESSES.md — this script never writes those.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const solc = require("solc");
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

// --- Required environment (all public values; no secrets) -------------------
const RPC_URL = process.env.STAGING_RPC_URL;
const DEPLOYER = process.env.STAGING_DEPLOYER_ADDRESS;
const OWNER = process.env.STAGING_OWNER_ADDRESS;
const RELAYER = process.env.STAGING_RELAYER_EOA;
const SECRET_KEY = process.env.STAGING_DEPLOYER_SECRET_KEY; // Paperclip secret binding; never printed

for (const [name, v] of Object.entries({ STAGING_RPC_URL: RPC_URL, STAGING_DEPLOYER_ADDRESS: DEPLOYER, STAGING_OWNER_ADDRESS: OWNER, STAGING_RELAYER_EOA: RELAYER })) {
  if (!v) {
    console.error(`missing required env: ${name} (public staging values only; deployer key comes from the Paperclip secret binding)`);
    process.exit(2);
  }
  if (name !== "STAGING_RPC_URL" && !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    console.error(`invalid address for ${name}: ${v}`);
    process.exit(2);
  }
}
if ("DEPLOYER_PRIVATE_KEY" in process.env || "STAGING_PRIVATE_KEY" in process.env) {
  console.error("refusing to run: raw private key env detected — key material must arrive via the Paperclip secret binding (env.STAGING_DEPLOYER_SECRET_KEY)");
  process.exit(2);
}
if (!SECRET_KEY || !/^0x[0-9a-fA-F]{64}$/.test(SECRET_KEY)) {
  console.error("missing/invalid STAGING_DEPLOYER_SECRET_KEY (must be injected by the approved Paperclip secret binding; never passed via argv or files)");
  process.exit(2);
}
const KEY_BYTES = Uint8Array.from(Buffer.from(SECRET_KEY.replace(/^0x/, ""), "hex"));

// --- JSON-RPC client (no deps) ----------------------------------------------
let rpcId = 0;
async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
  return body.result;
}

// --- Chain gate: Sepolia only (OBS-90 user decision); anvil for dev e2e -----
const chainId = Number(await rpc("eth_chainId", []));
const devChain = process.env.STAGING_DEV_CHAIN;
const allowed =
  chainId === 11155111 ||
  (chainId === 31337 && devChain === "anvil");
if (!allowed) {
  console.error(`refusing to run: chain id ${chainId} is not Sepolia (11155111)${devChain === "anvil" ? " or local anvil (31337)" : ""} — staging-only deploy tool (OBS-86/OBS-90)`);
  process.exit(2);
}
console.log(`staging chain id: ${chainId}${devChain === "anvil" ? " (dev chain: anvil)" : ""}`);

// --- Compile -----------------------------------------------------------------
const source = readFileSync(new URL("./AggregateSentimentSignals.sol", import.meta.url), "utf8");
const input = {
  language: "Solidity",
  sources: { "AggregateSentimentSignals.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.methodIdentifiers"] } },
    evmVersion: "cancun",
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const err of output.errors ?? []) {
  if (err.severity === "error") {
    console.error(err.formattedMessage);
    process.exit(1);
  }
}
const artifact = output.contracts["AggregateSentimentSignals.sol"].AggregateSentimentSignals;
const selector = artifact.evm.methodIdentifiers["recordBatch(uint32,uint24[3],uint24)"];
if (selector !== "0f4d576c") {
  console.error(`recordBatch selector drifted: got 0x${selector}, expected 0x0f4d576c (relayer/chain.ts pin)`);
  process.exit(1);
}
console.log(`compiled OK; recordBatch selector pinned: 0x${selector}`);

// --- Minimal ABI encoding (constructor(address,address), getters) ------------
const addr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
// bytecode.object carries no 0x prefix; ctorArgs must not re-add one or the
// initcode gets a literal "0x" embedded (caught by the anvil e2e test).
if (!/^([0-9a-fA-F]{2})+$/.test(artifact.evm.bytecode.object)) {
  console.error("unexpected bytecode.object form from solc (expected bare hex)");
  process.exit(1);
}
const deployTxData = "0x" + artifact.evm.bytecode.object + addr(OWNER) + addr(RELAYER);

const sel = (sig) => "0x" + artifact.evm.methodIdentifiers[sig];
const RELAYER_CALL = sel("relayer()");
const OWNER_CALL = sel("owner()");
const PENDING_OWNER_CALL = sel("pendingOwner()");
const PAUSED_CALL = sel("paused()");
const GET_COUNTS_CALL = sel("getCounts(uint32)");
const c = (n) => n.toString(16).padStart(64, "0");

// --- Local signing: EIP-155 legacy tx with the secret-injected key ----------
const hexToBytes = (h) => {
  h = h.replace(/^0x/, "");
  if (h.length % 2) h = "0" + h;
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.substr(i * 2, 2), 16));
};
const bytesToHex = (b) => "0x" + [...b].map((v) => v.toString(16).padStart(2, "0")).join("");

function rlp(input) {
  let bytes;
  if (Array.isArray(input)) {
    const parts = input.map(rlp);
    const len = parts.reduce((a, p) => a + p.length, 0);
    bytes = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
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
function rlpWrap(b, offset) {
  if (b.length === 1 && b[0] < 0x80 && offset === 0x80) return b;
  if (b.length <= 55) return Uint8Array.from([offset + b.length, ...b]);
  const lenBytes = hexToBytes("0x" + b.length.toString(16)); // minimal length encoding
  return Uint8Array.from([offset + 55 + lenBytes.length, ...lenBytes, ...b]);
}

// sanity: derive the address from the injected key and match it to DEPLOYER
const pub65 = secpGetPublicKey(KEY_BYTES, false); // uncompressed 65B (04 || x || y)
const derived = "0x" + Buffer.from(keccak_256(pub65.subarray(1))).slice(-20).toString("hex");
if (derived.toLowerCase() !== DEPLOYER.toLowerCase()) {
  console.error("refusing to run: STAGING_DEPLOYER_SECRET_KEY does not control STAGING_DEPLOYER_ADDRESS");
  process.exit(2);
}
console.log("verified: secret-injected key controls the deployer address (key not printed)");

const GAS = 50_000_000n;
const nonce = BigInt(await rpc("eth_getTransactionCount", [DEPLOYER, "pending"]));
const gasPriceRaw = BigInt(await rpc("eth_gasPrice", []));
const gasPrice = (gasPriceRaw * 150n) / 100n; // 1.5x headroom; Sepolia basefee can spike
const chainIdBig = BigInt(chainId);

const unsignedTx = rlp([nonce, gasPrice, GAS, "", 0n, deployTxData, chainIdBig, 0n, 0n]);
const msgHash = keccak_256(unsignedTx);
const sig = secpSign(msgHash, KEY_BYTES); // RFC6979 deterministic-k, low-s normalized
if (!secpVerify(sig, msgHash, pub65)) {
  console.error("refusing to run: signature self-verification failed");
  process.exit(2);
}
const v = BigInt(sig.recovery) + 27n + chainIdBig * 2n + 8n; // EIP-155
const rawTx = bytesToHex(rlp([nonce, gasPrice, GAS, "", 0n, deployTxData, v, sig.r, sig.s]));

console.log("submitting locally-signed EIP-155 deploy tx (eth_sendRawTransaction; key stays in env)");
const txHash = await rpc("eth_sendRawTransaction", [rawTx]);
if (txHash !== bytesToHex(keccak_256(hexToBytes(rawTx)))) {
  console.error("tx hash mismatch — node echoed an unexpected hash");
  process.exit(1);
}
console.log(`deploy tx: ${txHash} (gasPrice ${(gasPrice / 10n ** 6n).toString()} micro-ether)`);

let receipt = null;
for (let i = 0; i < 120 && !receipt; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  receipt = await rpc("eth_getTransactionReceipt", [txHash]);
}
if (!receipt || receipt.status !== "0x1") {
  console.error(`deploy failed: no successful receipt for ${txHash}`);
  process.exit(1);
}
const contractAddress = receipt.contractAddress;
console.log(`deployed at: ${contractAddress} (tx ${txHash}, block ${Number(receipt.blockNumber)})`);

// --- On-chain verification before the address may be recorded ----------------
const expect = async (what, call, expected) => {
  const got = await rpc("eth_call", [{ to: contractAddress, data: call }, "latest"]);
  if (got.toLowerCase() !== expected.toLowerCase()) {
    console.error(`verification FAILED: ${what}: got ${got}, expected ${expected}`);
    process.exit(1);
  }
  console.log(`verified: ${what}`);
};

const paddedAddr = (a) => "0x" + addr(a);
await expect("owner()", OWNER_CALL, paddedAddr(OWNER));
await expect("relayer()", RELAYER_CALL, paddedAddr(RELAYER));
await expect("pendingOwner() == 0", PENDING_OWNER_CALL, "0x" + c(0));
await expect("paused() == false", PAUSED_CALL, "0x" + c(0));

// getCounts(dayId) returns uint24[3] — static array, no offsets: 3 words.
const counts = await rpc("eth_call", [{ to: contractAddress, data: GET_COUNTS_CALL + c(0) }, "latest"]);
if (counts.replace(/^0x/, "").length !== 3 * 64 || counts.replace(/^0x/, "") !== "0".repeat(3 * 64)) {
  console.error(`verification FAILED: getCounts(0) not empty uint24[3]: ${counts}`);
  process.exit(1);
}
console.log("verified: getCounts(0) == [0,0,0]");

const deployedCode = await rpc("eth_getCode", [contractAddress, "latest"]);
const runtimeExpected = "0x" + artifact.evm.deployedBytecode.object;
if (deployedCode.toLowerCase() !== runtimeExpected.toLowerCase()) {
  console.error("verification FAILED: on-chain runtime bytecode != compiled runtime bytecode");
  process.exit(1);
}
console.log("verified: on-chain runtime bytecode matches compiled artifact");

// --- Authoritative record instruction -----------------------------------------
console.log("\nDEPLOYMENT VERIFIED.");
console.log(`AggregateSentimentSignals @ ${contractAddress} (staging chain ${chainId})`);
console.log("Record this address ONLY on OBS-83 and mirror in docs/CONTRACT-ADDRESSES.md");
console.log(" (keep the a587a12 historical-address disclaimer intact).");
console.log("No secrets were printed; the deployer key lives only in the Paperclip secret store.");