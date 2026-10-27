// Compile check for AggregateSentimentSignals.sol via solc-js.
// Deployment gate: Chief Auditor review must be recorded on OBS-83 BEFORE any
// deployment (staging or production). This script only compiles; it never deploys.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const solc = require("solc");

const source = readFileSync(new URL("./AggregateSentimentSignals.sol", import.meta.url), "utf8");
const input = {
  language: "Solidity",
  sources: { "AggregateSentimentSignals.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.methodIdentifiers"] } },
    evmVersion: "cancun",
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const err of output.errors ?? []) {
  if (err.severity === "error") {
    console.error(err.formattedMessage);
    process.exit(1);
  }
  console.warn(err.formattedMessage);
}
const file = output.contracts["AggregateSentimentSignals.sol"];
for (const [name, c] of Object.entries(file)) {
  console.log(`${name}: compiled OK (${c.evm.bytecode.object.length / 2 - 1} bytes runtime-independent estimate), ABI entries: ${c.abi.length}`);
  console.log(`recordBatch selector: 0x${c.evm.methodIdentifiers["recordBatch(uint32,uint24[3],uint24)"]}`);
}