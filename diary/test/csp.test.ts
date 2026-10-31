import { describe, expect, it } from "vitest";

// OBS-450 regression guard: the shipped CSP must permit the relayer origin the
// production build is wired to (VITE_RELAYER_URL=https://relayer.mydaywas.com —
// docs/PRODUCTION-DOMAIN-DECISION.md, deploy/README.md). connect-src 'self'
// alone silently broke the only network path (shareSignal POST); this test
// fails the build if the CSP ever regresses to blocking the relayer again.
const PRODUCTION_RELAYER_ORIGIN = "https://relayer.mydaywas.com";

const html = Object.values(
  import.meta.glob("../index.html", { query: "?raw", import: "default", eager: true }),
)[0] as string;

const cspMatch = html.match(
  /<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"[^>]*>/,
);
if (!cspMatch) throw new Error("diary/index.html: CSP meta tag not found");

const csp = cspMatch[1];

function directive(name: string): string {
  const m = csp.match(new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`));
  if (!m) throw new Error(`CSP is missing the ${name} directive: ${csp}`);
  return m[1].trim();
}

describe("shipped CSP permits the configured relayer origin (OBS-450)", () => {
  it("keeps the lockdown baseline (default-src none + no framing/forms)", () => {
    expect(directive("default-src")).toBe("'none'");
    expect(directive("base-uri")).toBe("'none'");
    expect(directive("form-action")).toBe("'none'");
    expect(directive("frame-ancestors")).toBe("'none'");
  });

  it("connect-src allows 'self' AND the production relayer origin", () => {
    const sources = directive("connect-src").split(/\s+/);
    expect(sources).toContain("'self'");
    expect(sources).toContain(PRODUCTION_RELAYER_ORIGIN);
  });

  it("connect-src does not wildcard open the policy", () => {
    const sources = directive("connect-src").split(/\s+/);
    expect(sources).not.toContain("*");
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("http:");
  });
});