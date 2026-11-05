/**
 * OBS-549: browser CORS contract for the relayer's two POST paths.
 *
 * The diary app POSTs `content-type: application/json`, which is NOT
 * CORS-safelisted, so a browser sends an OPTIONS preflight before the POST.
 * Before this change the relayer answered every non-POST request with 404 and
 * set no Access-Control-* header at all, so the app's only outbound call could
 * never succeed from a browser. These tests pin the contract:
 *
 *   - preflight on BOTH /v1/signals and /v1/publish -> 204, no body,
 *     exact-origin ACAO, Vary: Origin, Allow-Methods, Allow-Headers:
 *     content-type only, Max-Age 600
 *   - a disallowed origin gets NO ACAO header (never a comma-list, never an
 *     empty value, never a reflected arbitrary origin)
 *   - the allow-list defaults to closed
 *   - every error branch carries ACAO for an allowed origin, so the browser
 *     can read the error body
 *   - TLS parity: a plain-HTTP preflight is 426, exactly like the POST paths
 *
 * Every server listens on an ephemeral port (never a hard-coded port).
 */
import { describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { LocalDevCustody } from "../src/keycustody.ts";
import { createSignalServer } from "../src/server.ts";
import { MS_PER_DAY, type Sentiment } from "../src/types.ts";

const ALLOWED = "https://mydaywas.com";
const SECOND_ALLOWED = "https://app.example.com";
const DENIED = "https://not-allowed.example.com";
const today = Math.floor(Date.now() / MS_PER_DAY);

function token(n: number): string {
  return `tok_${n.toString().padStart(13, "0")}`;
}

function submission(n: number, sentiment: Sentiment = "NEUTRAL", dayId = today - 1) {
  return { v: 1, sentiment, dayId, contributorToken: token(n) };
}

async function start(
  opts: { allowed?: string[]; requireTls?: boolean; ratePerMin?: number } = {},
): Promise<{ server: Server; port: number }> {
  const prev = process.env.RELAYER_ALLOWED_ORIGINS;
  if (opts.allowed && opts.allowed.length > 0) process.env.RELAYER_ALLOWED_ORIGINS = opts.allowed.join(",");
  else delete process.env.RELAYER_ALLOWED_ORIGINS;
  try {
    const custody = new LocalDevCustody();
    const { server } = createSignalServer(custody, {
      kThreshold: 1,
      delayMs: 0,
      ...(opts.requireTls === undefined ? {} : { requireTls: opts.requireTls }),
      ...(opts.ratePerMin === undefined ? {} : { ratePerMin: opts.ratePerMin }),
    });
    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    return { server, port };
  } finally {
    if (prev === undefined) delete process.env.RELAYER_ALLOWED_ORIGINS;
    else process.env.RELAYER_ALLOWED_ORIGINS = prev;
  }
}

function preflight(port: number, path: string, origin: string, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, { method: "OPTIONS", headers: { origin, ...headers } });
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("OBS-549: CORS preflight", () => {
  it("answers the /v1/signals preflight with 204 and the exact-origin headers", async () => {
    const { server, port } = await start({ allowed: [ALLOWED] });
    try {
      const res = await preflight(port, "/v1/signals", ALLOWED);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
      expect(res.headers.get("vary")).toBe("Origin");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
      expect(res.headers.get("access-control-max-age")).toBe("600");
    } finally {
      server.close();
    }
  });

  it("answers the /v1/publish preflight with the same contract", async () => {
    const { server, port } = await start({ allowed: [ALLOWED] });
    try {
      const res = await preflight(port, "/v1/publish", ALLOWED);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
      expect(res.headers.get("vary")).toBe("Origin");
      expect(res.headers.get("access-control-max-age")).toBe("600");
    } finally {
      server.close();
    }
  });

  it("emits no ACAO header for a disallowed origin (never a comma-list, never reflected)", async () => {
    const { server, port } = await start({ allowed: [ALLOWED] });
    try {
      const pre = await preflight(port, "/v1/signals", DENIED);
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-origin")).toBeNull();
      const posted = await post(port, "/v1/signals", submission(1), { origin: DENIED });
      expect(posted.status).toBe(202);
      expect(posted.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      server.close();
    }
  });

  it("defaults to closed: with no allow-list configured no origin is allowed", async () => {
    const { server, port } = await start({});
    try {
      const res = await preflight(port, "/v1/signals", ALLOWED);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const posted = await post(port, "/v1/signals", submission(2), { origin: ALLOWED });
      expect(posted.status).toBe(202);
      expect(posted.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      server.close();
    }
  });

  it("emits the single matching origin when more than one is configured", async () => {
    const { server, port } = await start({ allowed: [ALLOWED, SECOND_ALLOWED] });
    try {
      const first = await preflight(port, "/v1/signals", ALLOWED);
      expect(first.headers.get("access-control-allow-origin")).toBe(ALLOWED);
      const second = await preflight(port, "/v1/signals", SECOND_ALLOWED);
      expect(second.headers.get("access-control-allow-origin")).toBe(SECOND_ALLOWED);
    } finally {
      server.close();
    }
  });
});

describe("OBS-549: error responses carry the CORS headers", () => {
  it("400 malformed_json carries ACAO for an allowed origin", async () => {
    const { server, port } = await start({ allowed: [ALLOWED] });
    try {
      const res = await post(port, "/v1/signals", "{not json", { origin: ALLOWED });
      expect(res.status).toBe(400);
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    } finally {
      server.close();
    }
  });

  it("413 payload_too_large carries ACAO for an allowed origin", async () => {
    const { server, port } = await start({ allowed: [ALLOWED] });
    try {
      const res = await post(port, "/v1/signals", "x".repeat(9_000), { origin: ALLOWED });
      expect(res.status).toBe(413);
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    } finally {
      server.close();
    }
  });

  it("429 rate_limited carries ACAO for an allowed origin", async () => {
    const { server, port } = await start({ allowed: [ALLOWED], ratePerMin: 1 });
    try {
      const first = await post(port, "/v1/signals", submission(3), { origin: ALLOWED });
      expect(first.status).toBe(202);
      const second = await post(port, "/v1/signals", submission(4), { origin: ALLOWED });
      expect(second.status).toBe(429);
      expect(second.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    } finally {
      server.close();
    }
  });

  it("426 tls_required carries ACAO for an allowed origin", async () => {
    const { server, port } = await start({ allowed: [ALLOWED], requireTls: true });
    try {
      const res = await post(port, "/v1/signals", submission(5), { origin: ALLOWED });
      expect(res.status).toBe(426);
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    } finally {
      server.close();
    }
  });

  it("409 already_published carries ACAO for an allowed origin", async () => {
    const { server, port } = await start({ allowed: [ALLOWED] });
    try {
      const accepted = await post(port, "/v1/signals", submission(6), { origin: ALLOWED });
      expect(accepted.status).toBe(202);
      const dayId = today - 1;
      const published = await post(port, "/v1/publish", { dayId }, { origin: ALLOWED });
      expect(published.status).toBe(200);
      const replay = await post(port, "/v1/publish", { dayId }, { origin: ALLOWED });
      expect(replay.status).toBe(409);
      expect(replay.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    } finally {
      server.close();
    }
  });
});

describe("OBS-549: TLS parity on the preflight", () => {
  it("rejects a plain-HTTP preflight with 426 tls_required", async () => {
    const { server, port } = await start({ allowed: [ALLOWED], requireTls: true });
    try {
      const res = await preflight(port, "/v1/signals", ALLOWED);
      expect(res.status).toBe(426);
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    } finally {
      server.close();
    }
  });

  it("answers the preflight over TLS when the proxy reports https", async () => {
    const { server, port } = await start({ allowed: [ALLOWED], requireTls: true });
    try {
      const res = await preflight(port, "/v1/signals", ALLOWED, { "x-forwarded-proto": "https" });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    } finally {
      server.close();
    }
  });
});
