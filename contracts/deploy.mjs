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
 *   - This script NEVER reads, holds, or accepts a private key. The funded
 *     staging deployer account lives under the KeyCustody KMS/HSM seam
 *     (node-managed keystore or KMS-signed bridge). We only submit
 *     `eth_sendTransaction` with the custody-held `from` address; raw key
 *     material must never appear in env vars used by this script.
 *
 * USAGE (staging):
 *   STAGING_RPC_URL=https://staging-rpc.example \
 *   STAGING_DEPLOYER_ADDRESS=0x…  \
 *   STAGING_RELAYER_EOA=0x… \
 *   STAGING_OWNER_ADDRESS=0x… \
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

// --- Required environment (all public values; no secrets) -------------------
const RPC_URL = process.env.STAGING_RPC_URL;
const DEPLOYER = process.env.STAGING_DEPLOYER_ADDRESS;
const OWNER = process.env.STAGING_OWNER_ADDRESS;
const RELAYER = process.env.STAGING_RELAYER_EOA;

for (const [name, v] of Object.entries({ STAGING_RPC_URL: RPC_URL, STAGING_DEPLOYER_ADDRESS: DEPLOYER, STAGING_OWNER_ADDRESS: OWNER, STAGING_RELAYER_EOA: RELAYER })) {
  if (!v) {
    console.error(`missing required env: ${name} (public staging values only; deployer key material stays in KeyCustody)`);
    process.exit(2);
  }
  if (name !== "STAGING_RPC_URL" && !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    console.error(`invalid address for ${name}: ${v}`);
    process.exit(2);
  }
}
if ("DEPLOYER_PRIVATE_KEY" in process.env || "STAGING_PRIVATE_KEY" in process.env) {
  console.error("refusing to run: raw private key env detected — keys must stay under the KeyCustody KMS/HSM seam");
  process.exit(2);
}

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
const ctorArgs = "0x" + addr(OWNER) + addr(RELAYER);
const deployTxData = "0x" + artifact.evm.bytecode.object + ctorArgs;

const sel = (sig) => "0x" + artifact.evm.methodIdentifiers[sig];
const RELAYER_CALL = sel("relayer()");
const OWNER_CALL = sel("owner()");
const PENDING_OWNER_CALL = sel("pendingOwner()");
const PAUSED_CALL = sel("paused()");
const GET_COUNTS_CALL = sel("getCounts(uint32)");
const c = (n) => n.toString(16).padStart(64, "0");

// --- Deploy via custody-held account -----------------------------------------
const chainId = Number(await rpc("eth_chainId", []));
console.log(`staging chain id: ${chainId}`);
const code0 = await rpc("eth_getCode", [DEPLOYER, "latest"]);
if (!/^0x[0-9a-fA-F]*$/.test(code0 ?? "0x")) throw new Error("RPC did not return code");
console.log("submitting deploy tx from KeyCustody-held deployer (eth_sendTransaction; no raw key handling)");
const txHash = await rpc("eth_sendTransaction", [{
  from: DEPLOYER,
  data: deployTxData,
  gas: "0x" + (2_000_000).toString(16),
}]);
console.log(`deploy tx: ${txHash}`);

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
console.log("No secrets were used or printed; deployer key remains in KeyCustody.");