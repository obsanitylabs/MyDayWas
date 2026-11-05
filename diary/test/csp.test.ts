import { describe, expect, it } from "vitest";

// OBS-450 regression guard: the shipped CSP must permit the relayer origin the
// production build is wired to (VITE_RELAYER_URL=https://relayer.mydaywas.com —
// docs/PRODUCTION-DOMAIN-DECISION.md, deploy/README.md). connect-src 'self'
// alone silently broke the only network path (shareSignal POST); this test
// fails the build if the CSP ever regresses to blocking the relayer again.
//
// OBS-783 adds the second network path: the mdw analytics emitter POSTs to the
// OBS-125 collector via VITE_COLLECT_URL. After the OBS-789 consolidation the
// app is served same-origin at https://mydaywas.com/app/ and the collector at
// https://mydaywas.com/api/collect, so 'self' already covers it; the explicit
// origin is retained (identical to 'self', not a widening) so the allow-list is
// robust if the collector is ever moved back cross-origin. The allow-list is
// exactly these THREE sources — no wildcard, no scheme, no blind widening.
const PRODUCTION_RELAYER_ORIGIN = "https://relayer.mydaywas.com";
const PRODUCTION_COLLECT_ORIGIN = "https://mydaywas.com";

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

  it("connect-src allows 'self', the relayer origin AND the collector origin", () => {
    const sources = directive("connect-src").split(/\s+/);
    expect(sources).toContain("'self'");
    expect(sources).toContain(PRODUCTION_RELAYER_ORIGIN);
    expect(sources).toContain(PRODUCTION_COLLECT_ORIGIN);
  });

  // OBS-523 (S3 from the M6 QA verdict on OBS-231): presence checks alone are
  // not enough — a policy that kept the relayer origin but also appended
  // `data: blob:` (or widened to `http:`/`https:`/`*`) would still pass. These
  // assertions are discriminating: they fail on the old `connect-src 'self'`
  // policy AND on any `data:`/`blob:`/scheme/wildcard variant, and pass only on
  // the shipped allowlist.
  it("connect-src does not wildcard or scheme-open the policy", () => {
    const sources = directive("connect-src").split(/\s+/).filter(Boolean);
    expect(sources).not.toContain("*");
    expect(sources).not.toContain("http:");
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("data:");
    expect(sources).not.toContain("blob:");
  });

  it("connect-src is exactly the three-source allowlist (OBS-783)", () => {
    const sources = directive("connect-src").split(/\s+/).filter(Boolean);
    expect(sources).toEqual(["'self'", PRODUCTION_RELAYER_ORIGIN, PRODUCTION_COLLECT_ORIGIN]);
    // No source may be a scheme/wildcard or an unlisted origin.
    for (const src of sources) {
      expect(["'self'", PRODUCTION_RELAYER_ORIGIN, PRODUCTION_COLLECT_ORIGIN]).toContain(src);
    }
  });
});