import { describe, expect, it } from "vitest";
import { ROUTES, parseRoute, routeToHash } from "../src/ui/router";

describe("hash router", () => {
  it("defaults to compose for empty / unknown hashes", () => {
    expect(parseRoute(undefined)).toBe("compose");
    expect(parseRoute(null)).toBe("compose");
    expect(parseRoute("")).toBe("compose");
    expect(parseRoute("#")).toBe("compose");
    expect(parseRoute("#nope")).toBe("compose");
  });

  it("recognises the three primary destinations", () => {
    expect(parseRoute("#shelf")).toBe("shelf");
    expect(parseRoute("#stats")).toBe("stats");
    expect(parseRoute("#hand")).toBe("hand");
  });

  it("tolerates a leading slash, trailing slash and case", () => {
    expect(parseRoute("#/shelf")).toBe("shelf");
    expect(parseRoute("#shelf/")).toBe("shelf");
    expect(parseRoute("#SHELF")).toBe("shelf");
    expect(parseRoute("#/Stats")).toBe("stats");
  });

  it("round-trips via routeToHash, with compose clearing the hash", () => {
    expect(routeToHash("compose")).toBe("");
    expect(routeToHash("shelf")).toBe("#shelf");
    for (const r of ROUTES) expect(parseRoute(routeToHash(r))).toBe(r);
  });

  it("exposes exactly the four routes", () => {
    expect(ROUTES).toEqual(["compose", "shelf", "stats", "hand"]);
  });
});
