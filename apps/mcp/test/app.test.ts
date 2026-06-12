import { describe, it, expect, vi, beforeEach } from "vitest";

// app.ts reads required env vars at module load (requireEnv), so they must be
// present before the import below. vi.hoisted runs ahead of the import.
vi.hoisted(() => {
  process.env["API_BASE_URL"] = "http://api.test";
  process.env["COGNITO_ISSUER"] = "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_test";
  process.env["COGNITO_HOSTED_UI_BASE_URL"] = "https://hosted-ui.test";
  process.env["MCP_SERVER_URL"] = "https://mcp.test";
});

vi.mock("../src/auth.js", () => ({ verifyToken: vi.fn() }));

import { verifyToken } from "../src/auth.js";
import { app } from "../src/app.js";

beforeEach(() => {
  vi.mocked(verifyToken).mockReset();
});

describe("health + discovery", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("exposes oauth-protected-resource metadata", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: "https://mcp.test",
      authorization_servers: ["https://cognito-idp.us-west-2.amazonaws.com/us-west-2_test"],
      bearer_methods_supported: ["header"],
    });
  });

  it("exposes oauth-authorization-server metadata derived from the hosted UI", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body["authorization_endpoint"]).toBe("https://hosted-ui.test/oauth2/authorize");
    expect(body["token_endpoint"]).toBe("https://hosted-ui.test/oauth2/token");
    expect(body["code_challenge_methods_supported"]).toEqual(["S256"]);
  });
});

describe("method routing on /mcp", () => {
  it("rejects GET with a JSON-RPC 'Method not allowed' (405)", async () => {
    const res = await app.request("/mcp");
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ error: { code: -32000 } });
  });

  it("rejects DELETE with a JSON-RPC 'Method not allowed' (405)", async () => {
    const res = await app.request("/mcp", { method: "DELETE" });
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});

describe("POST /mcp auth gate", () => {
  it("401s without an Authorization header and advertises the resource metadata", async () => {
    const res = await app.request("/mcp", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource");
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("401s when the Authorization scheme is not Bearer", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Basic abc" },
    });
    expect(res.status).toBe(401);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("401s when the token fails verification", async () => {
    vi.mocked(verifyToken).mockRejectedValueOnce(new Error("expired"));
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer bad.token" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Invalid or expired token" });
  });

  it("400s on a malformed JSON body after a valid token", async () => {
    vi.mocked(verifyToken).mockResolvedValueOnce({ userId: "user-123" });
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer good.token", "Content-Type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid JSON body" });
  });

  // Layer 3 protocol conformance (initialize → tools/list → tools/call) lives in
  // test/protocol.test.ts — it drives real JSON-RPC through this same endpoint.
});
