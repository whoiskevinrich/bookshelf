import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// config.json without the `features` block — the shape deployed before the
// scanner flag existed. Must still load, with scanner defaulting off.
const baseConfig = {
  cognito: {
    userPoolId: "us-west-2_test",
    userPoolClientId: "client",
    region: "us-west-2",
    oauthDomain: "",
  },
  apiBaseUrl: "/api",
};

async function loadWith(json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(json) }),
  );
  // Fresh module each time so the internal `cached` value doesn't leak between tests.
  const mod = await import("./runtime-config");
  return mod.loadRuntimeConfig();
}

describe("loadRuntimeConfig feature flags", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults scanner to false when config.json predates the flag", async () => {
    const cfg = await loadWith(baseConfig);
    expect(cfg.features.scanner).toBe(false);
  });

  it("reads scanner=true from config.json", async () => {
    const cfg = await loadWith({ ...baseConfig, features: { scanner: true } });
    expect(cfg.features.scanner).toBe(true);
  });

  it("treats scanner=false in config.json as off", async () => {
    const cfg = await loadWith({ ...baseConfig, features: { scanner: false } });
    expect(cfg.features.scanner).toBe(false);
  });
});
