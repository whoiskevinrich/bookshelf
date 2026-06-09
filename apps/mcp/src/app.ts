import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyToken } from "./auth.js";
import { registerShelfTools } from "./tools/shelf.js";
import { registerBookTools } from "./tools/books.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Read required env vars at module load so misconfiguration surfaces at cold-start
const API_BASE_URL = requireEnv("API_BASE_URL");
const COGNITO_ISSUER = requireEnv("COGNITO_ISSUER");
const COGNITO_HOSTED_UI_BASE_URL = requireEnv("COGNITO_HOSTED_UI_BASE_URL");
const MCP_SERVER_URL = process.env["MCP_SERVER_URL"] ?? ""; // optional: empty in dev

export const app = new Hono();

// ── OAuth discovery (required by MCP HTTP transport spec) ─────────────────

app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json({
    resource: MCP_SERVER_URL,
    authorization_servers: [COGNITO_ISSUER],
    scopes_supported: ["openid", "email", "profile"],
    bearer_methods_supported: ["header"],
  });
});

app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json({
    issuer: COGNITO_ISSUER,
    authorization_endpoint: `${COGNITO_HOSTED_UI_BASE_URL}/oauth2/authorize`,
    token_endpoint: `${COGNITO_HOSTED_UI_BASE_URL}/oauth2/token`,
    jwks_uri: `${COGNITO_ISSUER}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "email", "profile"],
  });
});

app.get("/health", (c) => c.json({ status: "ok" }));

// ── MCP endpoint ──────────────────────────────────────────────────────────

// SSE (GET) and session teardown (DELETE) are not supported: Lambda cannot hold
// long-lived connections. Return a structured JSON-RPC error so MCP clients
// can parse the rejection instead of receiving an empty body.
const methodNotAllowed = {
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed" },
  id: null,
};
app.get("/mcp", (c) => c.json(methodNotAllowed, 405));
app.delete("/mcp", (c) => c.json(methodNotAllowed, 405));

app.post("/mcp", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${MCP_SERVER_URL}/.well-known/oauth-protected-resource"`,
    });
  }

  const idToken = authHeader.slice(7);
  try {
    await verifyToken(idToken);
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Stateless mode: no sessionIdGenerator = no session tracking per request.
  // Safe on Lambda since each invocation is independent.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

  const mcpServer = new McpServer({ name: "bookshelf", version: "1.0.0" });
  registerShelfTools(mcpServer, idToken, API_BASE_URL);
  registerBookTools(mcpServer, idToken, API_BASE_URL);

  await mcpServer.connect(transport);

  const response = await transport.handleRequest(c.req.raw, { parsedBody: body });

  await mcpServer.close();

  return response;
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
