/**
 * OBS-794 deploy-config guards (supersedes the OBS-676/OBS-701 Fly.io guards):
 * the deploy reference set must stay coherent with the decided Vultr
 * deployment model (board direction 2026-11-05, OBS-598) — no stale Fly.io
 * references, the Vultr reference configs exist with the required shape, the
 * runbook carries the Vultr provisioning steps, and the quoted cost line
 * stays inside the board-approved $25.00/mo cap.
 *
 * Docs-only edits that drop or rename a reference config fail here — change
 * the configs, docs, and this guard together, as one change.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const deployDir = join(repoRoot, "deploy");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

describe("OBS-794: Fly.io reference is fully retired", () => {
  it("deploy/fly.toml no longer exists (replaced by docker-compose.yml)", () => {
    expect(existsSync(join(deployDir, "fly.toml"))).toBe(false);
  });

  it("no active Fly.io commands or artifacts remain in the reference set", () => {
    const files = [
      "deploy/README.md",
      "docs/PRODUCTION-DEPLOYMENT.md",
      "docs/PRODUCTION-DEPLOY-MODEL.md",
      "docs/PRODUCTION-DOMAIN-DECISION.md",
      "docs/PRODUCTION-IAM.md",
      "relayer/.env.production.example",
      "relayer/src/server.ts",
    ];
    // Active lines only: comments (#) and explicit historical/supersession
    // notes (OBS-598 board-direction record) are allowed to name Fly.io.
    const active = (txt: string) =>
      txt
        .split("\n")
        .filter((l) => !l.trim().startsWith("#"))
        .filter((l) => !/supersed|retired|replaces|OBS-598|board direction/i.test(l))
        .join("\n");
    const stale = files.filter((f) =>
      /fly\.toml|fly (launch|deploy|secrets|volumes|certs) |flyctl|fly-client-ip|\*\.fly\.dev/i.test(
        active(read(f)),
      ),
    );
    expect(stale).toEqual([]);
  });
});

describe("OBS-794: Vultr reference configs exist with the decided shape", () => {
  const compose = read("deploy/docker-compose.yml");
  const caddy = read("deploy/Caddyfile");
  const cloudInit = read("deploy/cloud-init.yml");

  it("single relayer service (single-writer topology, CISO OBS-234)", () => {
    expect(compose).toMatch(/^\s{2}relayer:\n/m);
    // No replicas/scaling anywhere in the compose reference.
    expect(compose).not.toMatch(/^\s*replicas:/m);
  });

  it("persistent volume mounted at /data (F3 single-writer WAL)", () => {
    expect(compose).toMatch(/- \/data:\/data/);
    expect(compose).toMatch(/RELAYER_DB_PATH: "\/data\/mydaywas-relayer\.db"/);
  });

  it("secrets reach the container only via the root-owned EnvironmentFile", () => {
    expect(compose).toMatch(/env_file:\s*\n\s+- \/etc\/mydaywas-relayer\/env/);
    expect(compose).not.toMatch(/RELAYER_ALERT_WEBHOOK\s*[:=]\s*\S/);
    expect(compose).not.toMatch(/RELAYER_EOA_SECRET_KEY\s*[:=]\s*\S/);
  });

  it("TLS edge is on-host Caddy honoring x-forwarded-proto (decision 3)", () => {
    expect(caddy).toMatch(/reverse_proxy relayer:8081/);
    expect(compose).toMatch(/RELAYER_REQUIRE_TLS: "1"/);
    expect(compose).toMatch(/caddy:2/);
    // No Load Balancer service in the reference (rejected for the
    // single-writer beta; Caddy on-host is the TLS edge).
    expect(compose).not.toMatch(/^\s{2}[a-z-]*load.?balancer/m);
  });

  it("cloud-init mounts the Block Storage volume at /data (decision 2)", () => {
    expect(cloudInit).toMatch(/#cloud-config/);
    expect(cloudInit).toMatch(/\/data/);
    expect(cloudInit).toMatch(/mkfs\.ext4/);
    expect(cloudInit).toMatch(/EnvironmentFile=\/etc\/mydaywas-relayer\/env/);
  });
});

describe("OBS-794: runbook + cost line stay coherent", () => {
  it("deploy/README.md carries the Vultr provisioning/deploy runbook", () => {
    const runbook = read("deploy/README.md");
    expect(runbook).toMatch(/vultr-cli instance create/);
    expect(runbook).toMatch(/vultr-cli block-storage create/);
    expect(runbook).toMatch(/docker compose --file deploy\/docker-compose\.yml build relayer/);
    expect(runbook).toMatch(/OBS-237/);
  });

  it("quoted Vultr hosting line stays inside the board-approved cap", () => {
    const model = read("docs/PRODUCTION-DEPLOY-MODEL.md");
    const plan = /\*\*\$([\d.]+)\/mo planned\*\*/.exec(model);
    expect(plan).not.toBeNull();
    const planned = Number(plan![1]);
    const cap = /\$25\.00\/mo cap/.exec(model);
    expect(cap).not.toBeNull();
    expect(planned).toBeGreaterThan(0);
    // Cap (board-approved ceiling, approvals 063d6679 + a04b7903): $25.00/mo.
    expect(planned).toBeLessThanOrEqual(25.0);
    expect(model).toMatch(/Vultr/);
    expect(model).toMatch(/\$7\.00\/mo/);
  });
});