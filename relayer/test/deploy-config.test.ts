/**
 * OBS-628 regression guard: the deployment config must actually turn the
 * browser CORS path on.
 *
 * OBS-549 implemented the relayer's exact-origin CORS contract and OBS-603
 * pointed the diary's transport at `<origin>/v1/signals`, but the reference
 * platform config the deploy runbook points at (`deploy/fly.toml` ->
 * `fly launch --config deploy/fly.toml`) did not set `RELAYER_ALLOWED_ORIGINS`.
 * The server defaults to CLOSED when the key is unset/empty, so the beta would
 * have shipped with every browser preflight answered without
 * `access-control-allow-origin` — the diary's only network call blocked, with
 * both code layers green. These assertions fail on that unpatched config and
 * pass only when the deploy config sets the app origin of record.
 *
 * The file assertions are skipped when `deploy/fly.toml` is not reachable: the
 * production image build uses `context: relayer`, so the repo-root `deploy/`
 * directory is not in the image and the app-level CORS contract is already
 * covered by `test/cors.test.ts` there. The guard is enforced by the repo CI
 * job, where `deploy/fly.toml` is present.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LocalDevCustody } from "../src/keycustody.ts";
import { createSignalServer } from "../src/server.ts";

const APP_ORIGIN = "https://app.mydaywas.com";
const DENIED_ORIGIN = "https://not-allowed.example.com";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const FLY_TOML = resolve(repoRoot, "deploy/fly.toml");
const ENV_TEMPLATE = resolve(repoRoot, "relayer/.env.production.example");
const DEPLOY_DOC = resolve(repoRoot, "docs/PRODUCTION-DEPLOYMENT.md");
const DEPLOY_CONFIG_PRESENT = existsSync(FLY_TOML);
const describeIfDeploy = DEPLOY_CONFIG_PRESENT ? describe : describe.skip;

/** Extract the string entries of the `[env]` table from fly.toml. */
function readEnvBlock(toml: string): Record<string, string> {
  const env: Record<string, string> = {};
  let inEnv = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inEnv = line === "[env]";
      continue;
    }
    if (!inEnv || line === "" || line.startsWith("#")) continue;
    const match = line.match(
      /^([A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/,
    );
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key !== undefined && value !== undefined) env[key] = value;
  }
  return env;
}

function deployedAllowList(): string {
  return readEnvBlock(readFileSync(FLY_TOML, "utf8")).RELAYER_ALLOWED_ORIGINS ?? "";
}

/** An allow-list entry must be a canonical https origin, not a wildcard/scheme. */
function assertExactOrigin(entry: string): void {
  expect(entry).not.toBe("*");
  expect(entry).not.toBe("null");
  expect(entry.startsWith("https://")).toBe(true);
  const url = new URL(entry);
  expect(url.origin).toBe(entry);
  expect(url.pathname).toBe("/");
  expect(url.search).toBe("");
  expect(url.hash).toBe("");
}

async function withServer<T>(
  allowed: string | undefined,
  fn: (port: number) => Promise<T>,
): Promise<T> {
  const prev = process.env.RELAYER_ALLOWED_ORIGINS;
  if (allowed === undefined) delete process.env.RELAYER_ALLOWED_ORIGINS;
  else process.env.RELAYER_ALLOWED_ORIGINS = allowed;
  const custody = new LocalDevCustody();
  const { server } = createSignalServer(custody, {
    kThreshold: 1,
    delayMs: 0,
    requireTls: true,
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    return await fn(port);
  } finally {
    server.close();
    server.closeAllConnections?.();
    if (prev === undefined) delete process.env.RELAYER_ALLOWED_ORIGINS;
    else process.env.RELAYER_ALLOWED_ORIGINS = prev;
  }
}

function preflight(port: number, path: string, origin: string) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
      "x-forwarded-proto": "https",
    },
  });
}

describeIfDeploy("OBS-628: deploy/fly.toml enables the browser CORS path", () => {
  it("sets RELAYER_ALLOWED_ORIGINS in [env] to the app origin of record", () => {
    expect(readEnvBlock(readFileSync(FLY_TOML, "utf8")).RELAYER_ALLOWED_ORIGINS).toBe(
      APP_ORIGIN,
    );
  });

  it("keeps the value a literal exact-origin list (no wildcard/scheme/path/dup)", () => {
    const raw = deployedAllowList();
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).not.toContain("${");
    expect(raw).not.toContain("<");
    expect(raw).not.toContain("changeme");
    const parts = raw.split(",");
    expect(parts.every((p) => p.trim().length > 0)).toBe(true);
    const entries = parts.map((p) => p.trim());
    expect(new Set(entries).size).toBe(entries.length);
    for (const entry of entries) assertExactOrigin(entry);
  });

  it("does not drift from the production env template", () => {
    const template = readFileSync(ENV_TEMPLATE, "utf8");
    const match = template.match(/^RELAYER_ALLOWED_ORIGINS=(.*)$/m);
    expect(match).not.toBeNull();
    expect(match?.[1]?.trim()).toBe(deployedAllowList());
  });

  it("is documented in the production deployment record", () => {
    const doc = readFileSync(DEPLOY_DOC, "utf8");
    expect(doc).toContain("RELAYER_ALLOWED_ORIGINS");
    expect(doc).toContain(APP_ORIGIN);
  });

  it("answers the deployed origin's preflight and blocks a disallowed origin at runtime", async () => {
    const allowList = deployedAllowList();
    expect(allowList).not.toBe("");
    await withServer(allowList, async (port) => {
      const allowed = await preflight(port, "/v1/signals", APP_ORIGIN);
      expect(allowed.status).toBe(204);
      expect(await allowed.text()).toBe("");
      expect(allowed.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
      expect(allowed.headers.get("vary")).toBe("Origin");
      expect(allowed.headers.get("access-control-allow-methods")).toContain("POST");
      expect(allowed.headers.get("access-control-max-age")).toBe("600");

      const denied = await preflight(port, "/v1/signals", DENIED_ORIGIN);
      expect(denied.status).toBe(204);
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("is CLOSED when the key is dropped (the regression this guard exists to catch)", async () => {
    await withServer(undefined, async (port) => {
      const res = await preflight(port, "/v1/signals", APP_ORIGIN);
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
