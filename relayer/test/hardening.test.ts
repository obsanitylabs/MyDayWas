/**
 * OBS-760 hardening tests: H1 (/v1/publish operator auth + content-type +
 * rate shaping), M1 (trusted client IP + O(1) LRU), M2 (bounded alert buffer).
 * M3/H2.4 (publication_missing horizon) is covered in prod.test.ts next to the
 * R-5 reconciliation tests.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { LocalDevCustody } from "../src/keycustody.ts";
import { Alerts, type Alert } from "../src/log.ts";
import { clientIp, createSignalServer, PUBLISH_AUTH_HEADER, secretMatches, type RelayerConfig } from "../src/server.ts";
import { MS_PER_DAY } from "../src/types.ts";

const SECRET = "operator-shared-secret-value";
const today = Math.floor(Date.now() / MS_PER_DAY);
const PUBLISHABLE_DAY = today - 1;

function token(n: number): string {
  return `tok_${n.toString().padStart(13, "0")}`;
}

async function boot(
  auth?: { secret: string },
  extra: Partial<RelayerConfig> = {},
): Promise<{ server: ReturnType<typeof createSignalServer>["server"]; store: ReturnType<typeof createSignalServer>["store"]; port: number }> {
  const custody = new LocalDevCustody();
  const { server, store } = createSignalServer(custody, {
    kThreshold: 1,
    delayMs: 0,
    ...(auth ? { publishAuth: auth } : {}),
    ...extra,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { server, store, port };
}

async function recordPublishable(store: ReturnType<typeof createSignalServer>["store"]): Promise<void> {
  await store.record(
    { v: 1, sentiment: "POSITIVE", dayId: PUBLISHABLE_DAY, contributorToken: token(1) },
    PUBLISHABLE_DAY * MS_PER_DAY + 3_600_000,
  );
}

function publish(
  port: number,
  headers: Record<string, string>,
  body: unknown = { dayId: PUBLISHABLE_DAY },
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("OBS-760 H1: /v1/publish operator authentication", () => {
  it("secretMatches is exact and length-independent (hashed, constant-time)", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(SECRET, SECRET + "x")).toBe(false);
    expect(secretMatches(SECRET + "x", SECRET)).toBe(false);
    expect(secretMatches("", SECRET)).toBe(false);
    expect(secretMatches(SECRET, "")).toBe(false);
  });

  it("401 without the header, 401 on a wrong secret, 200 with the correct secret", async () => {
    const { server, store, port } = await boot({ secret: SECRET });
    try {
      await recordPublishable(store);
      const noAuth = await publish(port, { "content-type": "application/json" });
      expect(noAuth.status).toBe(401);
      expect(await noAuth.json()).toEqual({ error: "unauthorized" });

      const badAuth = await publish(port, { "content-type": "application/json", [PUBLISH_AUTH_HEADER]: "nope" });
      expect(badAuth.status).toBe(401);

      const ok = await publish(port, { "content-type": "application/json", [PUBLISH_AUTH_HEADER]: SECRET });
      expect(ok.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("auth is off when no secret is configured (staging default)", async () => {
    const { server, store, port } = await boot(undefined);
    try {
      await recordPublishable(store);
      const res = await publish(port, { "content-type": "application/json" });
      expect(res.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("requires content-type: application/json once authenticated (415 otherwise)", async () => {
    const { server, store, port } = await boot({ secret: SECRET });
    try {
      await recordPublishable(store);
      const badCt = await publish(port, { "content-type": "text/plain", [PUBLISH_AUTH_HEADER]: SECRET });
      expect(badCt.status).toBe(415);
      expect(await badCt.json()).toEqual({ error: "unsupported_media_type" });
      const missingCt = await publish(port, { [PUBLISH_AUTH_HEADER]: SECRET });
      expect(missingCt.status).toBe(415);
      // charset parameter is accepted
      const withCharset = await publish(port, {
        "content-type": "application/json; charset=utf-8",
        [PUBLISH_AUTH_HEADER]: SECRET,
      });
      expect(withCharset.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("rate shapes /v1/publish (independent of the /v1/signals bucket)", async () => {
    const { server, port } = await boot(undefined, { ratePerMin: 1 });
    try {
      const first = await publish(port, { "content-type": "application/json" });
      expect(first.status).not.toBe(429); // allowed (409 not_yet_publishable for today's day)
      const second = await publish(port, { "content-type": "application/json" });
      expect(second.status).toBe(429);
      expect(await second.json()).toEqual({ error: "rate_limited" });
      // the /v1/signals bucket was not consumed by publish traffic
      const signal = await fetch(`http://127.0.0.1:${port}/v1/signals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: 1, sentiment: "NEUTRAL", dayId: today, contributorToken: token(9) }),
      });
      expect(signal.status).toBe(202);
    } finally {
      server.close();
    }
  });

  it("checkout: a preflight for /v1/publish advertises the auth header", async () => {
    const { server, port } = await boot({ secret: SECRET }, { requireTls: true });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/publish`, {
        method: "OPTIONS",
        headers: { origin: "https://mydaywas.com", "x-forwarded-proto": "https" },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-headers")).toContain(PUBLISH_AUTH_HEADER);
    } finally {
      server.close();
    }
  });
});

describe("OBS-760 M1: trusted client IP", () => {
  const fake = (headers: Record<string, string>, remoteAddress?: string): IncomingMessage =>
    ({ headers, socket: { remoteAddress } } as unknown as IncomingMessage);

  it("prefers the platform client-IP header", () => {
    expect(clientIp(fake({ "fly-client-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, "10.0.0.1"), "fly-client-ip")).toBe(
      "9.9.9.9",
    );
  });

  it("uses the TRUSTED LAST hop of x-forwarded-for, never the spoofable leftmost", () => {
    expect(clientIp(fake({ "x-forwarded-for": "6.6.6.6, 5.5.5.5" }))).toBe("5.5.5.5");
    expect(clientIp(fake({ "x-forwarded-for": "6.6.6.6" }))).toBe("6.6.6.6");
  });

  it("falls back to the socket address when no trusted header is present", () => {
    expect(clientIp(fake({}, "10.0.0.7"))).toBe("10.0.0.7");
    expect(clientIp(fake({}))).toBe("unknown");
  });
});

describe("OBS-760 M2: Alerts is a bounded ring buffer", () => {
  it("caps raised alerts at the capacity, keeping the most recent in order", () => {
    const sink: Alert[] = [];
    const alerts = new Alerts((a) => sink.push(a), 3);
    for (let i = 0; i < 5; i++) alerts.raise("rate_limited", `detail-${i}`, 0);
    const listed = alerts.list();
    expect(listed).toHaveLength(3);
    expect(listed.map((a) => a.detail)).toEqual(["detail-2", "detail-3", "detail-4"]);
    // the sink still saw every alert (forwarding is unaffected by the cap)
    expect(sink).toHaveLength(5);
  });

  it("keeps every alert while below capacity", () => {
    const alerts = new Alerts(() => {}, 10);
    alerts.raise("rate_limited", "a", 0);
    alerts.raise("reconciliation_mismatch", "b", 0);
    expect(alerts.list().map((a) => a.detail)).toEqual(["a", "b"]);
  });
});
