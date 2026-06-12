import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from "jose";
import { verifyToken } from "../src/auth.js";

const ISSUER = "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_test";
const CLIENT_ID = "mcp-test-client-id";

beforeEach(() => {
  vi.mocked(jwtVerify).mockReset();
  vi.stubEnv("COGNITO_ISSUER", ISSUER);
  vi.stubEnv("COGNITO_CLIENT_ID", CLIENT_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mockPayload(payload: Record<string, unknown>): void {
  vi.mocked(jwtVerify).mockResolvedValueOnce({
    payload,
    protectedHeader: {} as never,
  });
}

describe("verifyToken", () => {
  it("returns userId from a valid id token", async () => {
    mockPayload({ sub: "user-123", token_use: "id" });
    await expect(verifyToken("good.token")).resolves.toEqual({ userId: "user-123" });
  });

  it("verifies against the configured audience (mcp client id)", async () => {
    mockPayload({ sub: "user-123", token_use: "id" });
    await verifyToken("good.token");
    expect(jwtVerify).toHaveBeenCalledWith(
      "good.token",
      "mock-jwks",
      expect.objectContaining({ audience: CLIENT_ID, issuer: ISSUER }),
    );
  });

  it("rejects an access token (token_use !== 'id')", async () => {
    mockPayload({ sub: "user-123", token_use: "access" });
    await expect(verifyToken("access.token")).rejects.toThrow(/id token/);
  });

  it("rejects a token with no token_use claim", async () => {
    mockPayload({ sub: "user-123" });
    await expect(verifyToken("no.use.token")).rejects.toThrow(/id token/);
  });

  it("rejects a token with a missing sub claim", async () => {
    mockPayload({ token_use: "id" });
    await expect(verifyToken("no.sub.token")).rejects.toThrow(/missing sub/);
  });

  it("rejects a token with an empty sub claim", async () => {
    mockPayload({ sub: "", token_use: "id" });
    await expect(verifyToken("empty.sub.token")).rejects.toThrow(/missing sub/);
  });

  it("throws when COGNITO_CLIENT_ID is not set", async () => {
    vi.stubEnv("COGNITO_CLIENT_ID", "");
    await expect(verifyToken("any.token")).rejects.toThrow(/COGNITO_CLIENT_ID is not set/);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("propagates a verification failure (bad signature / expired)", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("signature verification failed"));
    await expect(verifyToken("tampered.token")).rejects.toThrow(/signature verification failed/);
  });
});
