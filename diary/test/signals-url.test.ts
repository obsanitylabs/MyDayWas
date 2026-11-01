import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIGNAL_PAYLOAD_FIELDS,
  buildSignalPayload,
  httpTransport,
  signalsEndpoint,
} from "../src/signals/submit";

// OBS-603 regression guard: the relayer serves its endpoints under /v1/ and
// answers `404 {"error":"not_found"}` for POST / (relayer/src/server.ts:246-247).
// VITE_RELAYER_URL is documented as the relayer ORIGIN (deploy/README.md,
// docs/PRODUCTION-DEPLOYMENT.md, relayer/.env.production.example, and the CSP
// connect-src allow-list), so the app must own the /v1/signals path. This test
// fails against the pre-fix transport (which POSTed the origin root verbatim)
// and passes only once the transport targets <origin>/v1/signals.

const ORIGIN = "https://relayer.mydaywas.com";
const EXPECTED_URL = `${ORIGIN}/v1/signals`;

function captureFetch(): { url: string; init?: RequestInit }[] {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 202 } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayer transport targets /v1/signals from the configured origin (OBS-603)", () => {
  it("POSTs the bare origin to exactly <origin>/v1/signals", async () => {
    const calls = captureFetch();
    await httpTransport(ORIGIN).submit(buildSignalPayload("NEUTRAL", "sig_test"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EXPECTED_URL);
  });

  it("handles a trailing slash on the configured value", async () => {
    const calls = captureFetch();
    await httpTransport(`${ORIGIN}/`).submit(buildSignalPayload("NEUTRAL", "sig_test"));
    expect(calls[0].url).toBe(EXPECTED_URL);
  });

  it("collapses repeated trailing slashes to a single path", () => {
    expect(signalsEndpoint(`${ORIGIN}///`)).toBe(EXPECTED_URL);
    expect(signalsEndpoint(ORIGIN)).toBe(EXPECTED_URL);
  });

  // Negative: the path must be appended exactly once — never doubled.
  it("does not double-append the /v1/signals path", async () => {
    const calls = captureFetch();
    await httpTransport(`${ORIGIN}/`).submit(buildSignalPayload("POSITIVE", "sig_test"));
    const url = calls[0].url;
    expect(url.match(/\/v1\/signals/g)).toHaveLength(1);
    expect(url).not.toContain("/v1/signals/v1/signals");
    expect(url.endsWith("/v1/signals")).toBe(true);
    // The origin root alone is the bug this guards against.
    expect(url).not.toBe(ORIGIN);
  });

  it("keeps the request contract unchanged (method/headers/body)", async () => {
    const calls = captureFetch();
    const payload = buildSignalPayload("NEGATIVE", "sig_test");
    await httpTransport(ORIGIN).submit(payload);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([...SIGNAL_PAYLOAD_FIELDS]);
    expect(body).toEqual(payload);
  });
});
