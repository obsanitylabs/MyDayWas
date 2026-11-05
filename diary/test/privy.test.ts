import { describe, expect, it } from "vitest";
import { getPrivyConfig } from "../src/auth/privy";
import defaultExport from "../src/auth/privy";

describe("Privy scaffold (config only, not mounted)", () => {
  it("returns null while VITE_PRIVY_APP_ID is unset", () => {
    expect(getPrivyConfig({})).toBeNull();
    expect(getPrivyConfig({ VITE_PRIVY_APP_ID: "" })).toBeNull();
  });

  it("returns the app id when configured", () => {
    expect(getPrivyConfig({ VITE_PRIVY_APP_ID: "app_cmp_123" })).toEqual({ appId: "app_cmp_123" });
  });

  it("defaults to the build-time env (null in this test build)", () => {
    // VITE_PRIVY_APP_ID is not configured for the test/staging build, so the
    // existing injected-wallet auth remains the active path.
    expect(getPrivyConfig()).toBeNull();
  });

  it("default export is the same helper", () => {
    expect(defaultExport).toBe(getPrivyConfig);
  });
});
