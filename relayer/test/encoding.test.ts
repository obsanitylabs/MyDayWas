/**
 * C1 (OBS-760) — `recordBatch` calldata round-trip against the COMPILED contract ABI.
 *
 * The defect: `encodeRecordBatch` emitted the DYNAMIC-array tail for a parameter
 * the contract declares as a FIXED `uint24[3]`, so the published cells decoded
 * wrong and permanently corrupted the add-only per-day counts. A re-typed
 * signature would carry the same mistake, so the ABI is taken FROM THE CONTRACT
 * itself: this test compiles `contracts/AggregateSentimentSignals.sol` with the
 * same solc version the repo pins (`contracts/package.json` -> solc 0.8.24) and
 * decodes the encoder's calldata with ethers against THAT ABI.
 *
 * Skipped when the contract source is not reachable: the production container
 * image builds with context `relayer/`, so `contracts/` is absent inside the
 * image. The guard therefore runs in the relayer CI job (full checkout) and is
 * SKIPPED inside the in-image `npm test` (same pattern as deploy-config.test.ts).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Interface, type FunctionFragment } from "ethers";
import { encodeRecordBatch } from "../src/chain.ts";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT_SOL = resolve(here, "../../contracts/AggregateSentimentSignals.sol");
const CONTRACT_PRESENT = existsSync(CONTRACT_SOL);

interface SolcOutput {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts: Record<string, Record<string, { abi: any[]; evm: { methodIdentifiers: Record<string, string> } }>>;
}

/** Compile the contract with the repo-pinned solc and return its real ABI. */
function compiledAbi(): any[] {
  const solc = require("solc") as { compile(input: string): string };
  const input = {
    language: "Solidity",
    sources: { "AggregateSentimentSignals.sol": { content: readFileSync(CONTRACT_SOL, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.methodIdentifiers"] } },
      evmVersion: "cancun",
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const contract = output.contracts["AggregateSentimentSignals.sol"]?.["AggregateSentimentSignals"];
  if (!contract) throw new Error("AggregateSentimentSignals not present in the solc output");
  return contract.abi;
}

const describeIfContract = CONTRACT_PRESENT ? describe : describe.skip;

describeIfContract("C1 (OBS-760): recordBatch calldata round-trips against the compiled contract ABI", () => {
  const iface = new Interface(CONTRACT_PRESENT ? compiledAbi() : []);

  it("decodes the encoder's output back to exactly the inputs", () => {
    const cases: Array<[number, [number, number, number], number]> = [
      [123, [100, 0, 0], 100],
      [20_000, [150, 250, 0], 150],
      [0, [0, 0, 0], 0],
      [0xff_ffff_ff, [0xff_ffff, 1, 2], 0xff_ffff],
      [42, [255, 256, 65_535], 42],
    ];
    for (const [dayId, deltas, contributors] of cases) {
      const data = encodeRecordBatch(dayId, deltas, contributors);
      const decoded = iface.decodeFunctionData("recordBatch", data) as unknown as {
        dayId: bigint;
        sentimentDeltas: bigint[];
        publishedContributors: bigint;
      };
      expect(decoded.dayId).toBe(BigInt(dayId));
      expect(Array.from(decoded.sentimentDeltas).map(Number)).toEqual(deltas);
      expect(decoded.publishedContributors).toBe(BigInt(contributors));
    }
  });

  it("the OLD dynamic-array (7-word) encoding does NOT decode back to the inputs", () => {
    const dayId = 123;
    const deltas: [number, number, number] = [100, 0, 0];
    const contributors = 100;
    const w = (n: number) => BigInt(n).toString(16).padStart(64, "0");
    // Exact old layout: dayId, 0x60 offset, contributors, length 3, d0, d1, d2.
    const old = "0x0f4d576c" + w(dayId) + w(0x60) + w(contributors) + w(3) + w(deltas[0]) + w(deltas[1]) + w(deltas[2]);
    expect(old.length).toBe(2 + 8 + 64 * 7);
    // Decoded as the fixed-array signature, the 7-word payload yields the WRONG
    // deltas [0x60, contributors, 3] — the exact corruption the defect caused.
    const decoded = iface.decodeFunctionData("recordBatch", old) as unknown as {
      dayId: bigint;
      sentimentDeltas: bigint[];
      publishedContributors: bigint;
    };
    const asInputs = {
      dayId: Number(decoded.dayId),
      deltas: Array.from(decoded.sentimentDeltas).map(Number),
      contributors: Number(decoded.publishedContributors),
    };
    expect(asInputs).not.toEqual({ dayId, deltas, contributors });
    expect(asInputs.deltas).toEqual([0x60, contributors, 3]);
  });

  it("the compiled recordBatch signature is the fixed uint24[3] the encoder targets", () => {
    const fn = iface.getFunction("recordBatch") as FunctionFragment | null;
    expect(fn?.inputs.map((i) => i.type)).toEqual(["uint32", "uint24[3]", "uint24"]);
  });
});
