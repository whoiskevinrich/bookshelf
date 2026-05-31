import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from "jose";
import { authMiddleware } from "../../src/middleware/auth.js";

// Provide a valid ISSUER so new URL(...) doesn't throw
vi.stubEnv("COGNITO_ISSUER", "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test");
vi.stubEnv("COGNITO_CLIENT_ID", "test-client-id");

function makeApp() {
  const app = new Hono();
  app.use("*", authMiddleware);
  app.get("/protected", (c) => {
    const auth = c.get("auth");
    return c.json({ userId: auth.userId });
  });
  return app;
}

beforeEach(() => {
  vi.mocked(jwtVerify).mockReset();
});

describe("authMiddleware", () => {
  it("returns 401 when no Authorization header", async () => {
    const app = makeApp();
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization is not Bearer", async () => {
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Basic abc" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("bad token"));
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer bad.token.here" },
    });
    expect(res.status).toBe(401);
  });

  it("sets auth context on valid token", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: "user-123" },
      protectedHeader: {} as never,
    });
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer valid.token.here" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe("user-123");
  });

  it("returns 401 when token has no sub claim", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: {},
      protectedHeader: {} as never,
    });
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer no.sub.token" },
    });
    expect(res.status).toBe(401);
  });
});
