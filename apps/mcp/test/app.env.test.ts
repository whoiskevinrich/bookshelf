import { describe, it, expect, vi, afterEach } from "vitest";

// app.ts validates required env at module load. These tests re-import the module
// with vi.resetModules() so the top-level requireEnv runs fresh each time.

const REQUIRED: Record<string, string> = {
  API_BASE_URL: "http://api.test",
  COGNITO_ISSUER: "https://issuer.test",
  COGNITO_HOSTED_UI_BASE_URL: "https://hosted-ui.test",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("app module-load env validation", () => {
  it("loads when all required env vars are set", async () => {
    for (const [k, v] of Object.entries(REQUIRED)) vi.stubEnv(k, v);
    vi.resetModules();
    const mod = await import("../src/app.js");
    expect(mod.app).toBeDefined();
  });

  it.each(Object.keys(REQUIRED))("throws at load when %s is missing", async (missing) => {
    for (const [k, v] of Object.entries(REQUIRED)) {
      vi.stubEnv(k, k === missing ? "" : v);
    }
    vi.resetModules();
    await expect(import("../src/app.js")).rejects.toThrow(missing);
  });
});
