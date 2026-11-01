/**
 * Deployment-config guards for the relayer.
 *
 * OBS-628 regression guard (browser CORS path): OBS-549 implemented the
 * relayer's exact-origin CORS contract and OBS-603 pointed the diary's
 * transport at `<origin>/v1/signals`, but the reference platform config the
 * deploy runbook points at never set `RELAYER_ALLOWED_ORIGINS`. The server
 * defaults to CLOSED when the key is unset/empty, so the beta would have
 * shipped with every browser preflight answered without
 * `access-control-allow-origin` — the diary's only network call blocked, with
 * both code layers green. These assertions fail on that unpatched config and
 * pass only when the deploy config sets the app origin of record.
 *
 * OBS-676 regression guard (image build): the reference platform config must
 * actually build the relayer image under Fly's documented semantics. The
 * config is `relayer/fly.toml` (next to `relayer/Dockerfile`), and the
 * documented command is `fly deploy relayer` run from the repo root:
 * `relayer` is flyctl's working directory, so it resolves `relayer/fly.toml`,
 * `relayer/Dockerfile` (via `[build] dockerfile = "Dockerfile"`) and uses
 * `relayer/` as the Docker build context — the relayer's own manifest
 * (`typecheck`/`test`), `tsconfig.json`, `vitest.config.mts`, `src/`, `test/`.
 * That is the same tree CI builds with `context: relayer`. A config without a
 * resolvable Dockerfile, or a command whose context is the repo root (the
 * landing tree), builds the wrong image or none at all.
 *
 * The file assertions are skipped when the deploy docs are not reachable: the
 * production image build uses `context: relayer`, so neither `deploy/` nor
 * `docs/` is in the image build context. The guard is enforced by the repo CI
 * job, where those trees are present (and where the app-level CORS contract is
 * additionally covered by `test/cors.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { LocalDevCustody } from "../src/keycustody.ts";
import { createSignalServer } from "../src/server.ts";

const APP_ORIGIN = "https://app.mydaywas.com";
const DENIED_ORIGIN = "https://not-allowed.example.com";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const relayerDir = resolve(repoRoot, "relayer");

const FLY_TOML = resolve(relayerDir, "fly.toml"); // the config of record
const LEGACY_FLY_TOML = resolve(repoRoot, "deploy/fly.toml"); // must be gone (OBS-676)
const DOCKERFILE = resolve(relayerDir, "Dockerfile");
const RELAYER_MANIFEST = resolve(relayerDir, "package.json");
const ROOT_MANIFEST = resolve(repoRoot, "package.json");
const ENV_TEMPLATE = resolve(repoRoot, "relayer/.env.production.example");
const DEPLOY_DOC = resolve(repoRoot, "docs/PRODUCTION-DEPLOYMENT.md");
const DEPLOY_README = resolve(repoRoot, "deploy/README.md");
const DEPLOY_MODEL_DOC = resolve(repoRoot, "docs/PRODUCTION-DEPLOY-MODEL.md");
const CI_WORKFLOW = resolve(repoRoot, ".github/workflows/ci.yml");

// The documented `fly deploy` working-directory argument; it is also the
// effective Docker build context.
const WORKING_DIR = "relayer";
const CONTEXT_DIR = resolve(repoRoot, WORKING_DIR);

// Sentinel: the deploy docs exist only in a full repo checkout (the image
// build copies neither deploy/ nor docs/). Keying the skip on this — rather
// than on the config file itself — keeps the guard SKIPPED inside the image
// while still RUNNING (and failing) against a tree that has the docs but a
// missing or wrong config, which is exactly the regression this catches.
const DEPLOY_DOCS_PRESENT = existsSync(DEPLOY_DOC);
const describeIfDeploy = DEPLOY_DOCS_PRESENT ? describe : describe.skip;

/** Extract the string entries of a named `[table]` from fly.toml. */
function readStringTable(toml: string, table: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inTable = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inTable = line === table;
      continue;
    }
    if (!inTable || line === "" || line.startsWith("#")) continue;
    const match = line.match(
      /^([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/,
    );
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key !== undefined && value !== undefined) out[key] = value;
  }
  return out;
}

function readEnvBlock(toml: string): Record<string, string> {
  return readStringTable(toml, "[env]");
}

/** Every `fly deploy <argument>` command string in a document. */
function findDeployCommands(text: string): string[] {
  return [...text.matchAll(/fly\s+deploy\s+[^\s`#][^\n`#]*/g)].map((m) =>
    m[0].trim(),
  );
}

/** Source paths of every `COPY` in a Dockerfile (flags like --from ignored). */
function dockerfileCopySources(dockerfile: string): string[] {
  const sources: string[] = [];
  for (const rawLine of dockerfile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^COPY\s/i.test(line)) continue;
    const parts = line
      .slice(4)
      .trim()
      .split(/\s+/)
      .filter((part) => part !== "" && !part.startsWith("--"));
    if (parts.length < 2) continue; // need at least one source + dest
    sources.push(...parts.slice(0, -1));
  }
  return sources;
}

/** Recursively find `fly.toml` files, ignoring vendored/build-output trees. */
function findFlyTomls(root: string): string[] {
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "out",
    "cache",
    ".paperclip",
  ]);
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(resolve(dir, entry.name));
      } else if (entry.isFile() && entry.name === "fly.toml") {
        found.push(resolve(dir, entry.name));
      }
    }
  };
  walk(root);
  return found;
}

interface PackageManifest {
  scripts?: Record<string, string>;
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

describeIfDeploy(
  "OBS-628: the reference config (relayer/fly.toml) enables the browser CORS path",
  () => {
    it("sets RELAYER_ALLOWED_ORIGINS in [env] to the app origin of record", () => {
      expect(
        readEnvBlock(readFileSync(FLY_TOML, "utf8")).RELAYER_ALLOWED_ORIGINS,
      ).toBe(APP_ORIGIN);
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
  },
);

describeIfDeploy(
  "OBS-676: the reference config builds the relayer image (context relayer/)",
  () => {
    it("keeps exactly one reference platform config, next to the Dockerfile", () => {
      expect(existsSync(FLY_TOML)).toBe(true);
      expect(existsSync(LEGACY_FLY_TOML)).toBe(false);
      expect(existsSync(DOCKERFILE)).toBe(true);
      expect(findFlyTomls(repoRoot)).toEqual([FLY_TOML]);
    });

    it("the documented deploy command uses working dir `relayer` (the build context)", () => {
      const commands = [
        ...findDeployCommands(readFileSync(DEPLOY_README, "utf8")),
        ...findDeployCommands(readFileSync(DEPLOY_DOC, "utf8")),
      ];
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command).toBe(`fly deploy ${WORKING_DIR}`);
      }
      // The config of record sits inside that working directory.
      expect(dirname(FLY_TOML)).toBe(CONTEXT_DIR);
    });

    it("resolves [build] dockerfile to relayer/Dockerfile inside the context", () => {
      const build = readStringTable(readFileSync(FLY_TOML, "utf8"), "[build]");
      expect(build.dockerfile).toBe("Dockerfile");
      const resolvedDockerfile = resolve(dirname(FLY_TOML), build.dockerfile ?? "");
      expect(resolvedDockerfile).toBe(DOCKERFILE);
      expect(existsSync(resolvedDockerfile)).toBe(true);
      // ...and it is inside the build context (not the repo root landing tree).
      expect(relative(CONTEXT_DIR, resolvedDockerfile).startsWith("..")).toBe(false);
    });

    it("the context carries the relayer manifest, not the landing manifest", () => {
      const relayerManifest = JSON.parse(
        readFileSync(RELAYER_MANIFEST, "utf8"),
      ) as PackageManifest;
      const rootManifest = JSON.parse(
        readFileSync(ROOT_MANIFEST, "utf8"),
      ) as PackageManifest;
      // The in-build gate (`npm run typecheck && npm test`) is satisfiable only
      // by the relayer manifest; the landing manifest has neither script.
      expect(typeof relayerManifest.scripts?.typecheck).toBe("string");
      expect(typeof relayerManifest.scripts?.test).toBe("string");
      expect(rootManifest.scripts?.typecheck).toBeUndefined();
      expect(rootManifest.scripts?.test).toBeUndefined();
      expect(RELAYER_MANIFEST).not.toBe(ROOT_MANIFEST);
      expect(resolve(dirname(RELAYER_MANIFEST))).toBe(CONTEXT_DIR);
    });

    it("the context contains every COPY target the Dockerfile needs", () => {
      const sources = dockerfileCopySources(readFileSync(DOCKERFILE, "utf8"));
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(existsSync(resolve(CONTEXT_DIR, source))).toBe(true);
      }
      for (const required of [
        "tsconfig.json",
        "vitest.config.mts",
        "src",
        "test",
        "package-lock.json",
      ]) {
        expect(existsSync(resolve(CONTEXT_DIR, required))).toBe(true);
      }
    });

    it("builds the same image CI builds (in-build gate, CMD, HEALTHCHECK, context)", () => {
      const dockerfile = readFileSync(DOCKERFILE, "utf8");
      expect(dockerfile).toContain("RUN npm run typecheck && npm test");
      expect(dockerfile).toMatch(
        /CMD \["node", "--no-warnings", "src\/server\.ts"\]/,
      );
      expect(dockerfile).toContain("HEALTHCHECK");
      expect(existsSync(resolve(CONTEXT_DIR, "src/server.ts"))).toBe(true);
      const ci = readFileSync(CI_WORKFLOW, "utf8");
      expect(ci).toMatch(/context:\s*relayer\b/);
    });

    it("leaves no runbook pointing at a second, divergent config or command", () => {
      for (const doc of [DEPLOY_README, DEPLOY_DOC, DEPLOY_MODEL_DOC]) {
        expect(readFileSync(doc, "utf8")).not.toContain("deploy/fly.toml");
      }
      expect(readFileSync(DEPLOY_README, "utf8")).toContain("relayer/fly.toml");
      expect(readFileSync(DEPLOY_DOC, "utf8")).toContain("relayer/fly.toml");
      expect(readFileSync(FLY_TOML, "utf8")).toContain("fly deploy relayer");
    });
  },
);
