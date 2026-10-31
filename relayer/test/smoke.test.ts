/**
 * OBS-363 D5: boot smoke test — the REAL entrypoint must actually start.
 *
 * `node src/server.ts` (Node strip-only TypeScript) crashes at boot on
 * TypeScript parameter properties (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX), and
 * a typecheck + vitest build cannot catch that class of defect — that is
 * exactly how the broken image shipped. This test boots the documented
 * launch path (relayer/package.json `start` / relayer/Dockerfile CMD) as a
 * real child process and asserts `GET /healthz` answers 200, so any boot-time
 * syntax/runtime failure in the entrypoint module graph fails the suite.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

describe("OBS-363 D5: entrypoint boot smoke (launch path boots and serves /healthz)", () => {
  it("node --no-warnings src/server.ts starts and GET /healthz -> 200", async () => {
    const port = 18_099;
    // Deterministic staging profile: strip any RELAYER_* env so a developer
    // machine running the durable profile cannot fail this test.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith("RELAYER_") && v !== undefined) env[k] = v;
    }
    env.RELAYER_PORT = String(port);

    const child = spawn(
      process.execPath,
      ["--no-warnings", "src/server.ts"],
      { cwd: new URL("..", import.meta.url).pathname, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let bootLog = "";
    child.stdout.on("data", (d) => (bootLog += d));
    child.stderr.on("data", (d) => (bootLog += d));

    const childExit = new Promise<number | null>((r) => child.on("exit", r));
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    try {
      // Poll /healthz until the server answers; fail fast if it dies first.
      let status = 0;
      let body = "";
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) {
          throw new Error(`entrypoint exited with code ${child.exitCode} before answering /healthz\n${bootLog}`);
        }
        try {
          const res = await fetch(`http://127.0.0.1:${port}/healthz`);
          status = res.status;
          body = await res.text();
          if (status === 200) break;
        } catch {
          /* not listening yet */
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(status).toBe(200);
      const json = JSON.parse(body) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(json.service).toBe("mydaywas-relayer");
      expect((json.submitter as string)).toMatch(/^dry-run/);
    } finally {
      clearTimeout(timeout);
      child.kill("SIGTERM");
    }
    await childExit;
  }, 45_000);
});