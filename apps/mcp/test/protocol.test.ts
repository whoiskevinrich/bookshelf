import { describe, it, expect, vi, beforeEach } from "vitest";

// Required env must exist before app.ts is imported (module-load requireEnv).
vi.hoisted(() => {
  process.env["API_BASE_URL"] = "http://api.test";
  process.env["COGNITO_ISSUER"] = "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_test";
  process.env["COGNITO_HOSTED_UI_BASE_URL"] = "https://hosted-ui.test";
  process.env["MCP_SERVER_URL"] = "https://mcp.test";
});

vi.mock("../src/auth.js", () => ({ verifyToken: vi.fn() }));

vi.mock("../src/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api.js")>();
  return { ...actual, apiFetch: vi.fn() };
});

import { verifyToken } from "../src/auth.js";
import { apiFetch } from "../src/lib/api.js";
import { app } from "../src/app.js";

const EXPECTED_TOOLS = [
  "list_shelf",
  "add_book",
  "update_book_status",
  "remove_book",
  "set_notes",
  "search_books",
  "lookup_book_isbn",
  "lookup_book_asin",
].sort();

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

/** POST a single JSON-RPC message through the live MCP endpoint (stateless). */
async function rpc(
  message: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  vi.mocked(verifyToken).mockResolvedValueOnce({ userId: "user-123" });
  return app.request("/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer good.token",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(message),
  });
}

async function rpcJson(message: Record<string, unknown>): Promise<JsonRpcResponse> {
  const res = await rpc(message);
  expect(res.status).toBe(200);
  return (await res.json()) as JsonRpcResponse;
}

function callTool(name: string, args: Record<string, unknown>, id = 2) {
  return rpcJson({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

/** tools/call results are wrapped; pull the first text content block. */
function firstText(result: Record<string, unknown> | undefined): string {
  const content = result?.["content"] as { type: string; text: string }[];
  return content[0].text;
}

beforeEach(() => {
  vi.mocked(verifyToken).mockReset();
  vi.mocked(apiFetch).mockReset();
});

describe("MCP protocol conformance (stateless Streamable HTTP)", () => {
  it("handles initialize and reports the bookshelf server info", async () => {
    const body = await rpcJson({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0.0" },
      },
    });
    expect(body.result?.["serverInfo"]).toMatchObject({ name: "bookshelf", version: "1.0.0" });
    expect(body.result?.["capabilities"]).toHaveProperty("tools");
  });

  it("lists exactly the 8 registered tools", async () => {
    const body = await rpcJson({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const tools = body.result?.["tools"] as { name: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
  });

  it("exposes input schemas with required fields (add_book)", async () => {
    const body = await rpcJson({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const tools = body.result?.["tools"] as {
      name: string;
      inputSchema: Record<string, unknown>;
    }[];
    const addBook = tools.find((t) => t.name === "add_book");
    expect(addBook?.inputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["isbn", "status"]),
    });
  });

  it("invokes a read tool (list_shelf) and returns the API payload", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { items: [{ isbn: "9780441013593", status: "owned" }] },
    });
    const body = await callTool("list_shelf", { status: "owned" });
    expect(body.error).toBeUndefined();
    expect(body.result?.["isError"]).toBeFalsy();
    expect(firstText(body.result)).toContain("9780441013593");
    expect(apiFetch).toHaveBeenCalledWith("http://api.test/v1/shelf?status=owned", "good.token");
  });

  it("invokes a write tool (add_book) and surfaces the 409 duplicate message", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      data: { error: "duplicate" },
    });
    const body = await callTool("add_book", { isbn: "9780441013593", status: "owned" });
    expect(body.error).toBeUndefined();
    expect(firstText(body.result)).toMatch(/already on your shelf/i);
  });

  it("returns a tool error (not a transport crash) for an unknown tool", async () => {
    const body = await callTool("does_not_exist", {});
    // The SDK reports unknown tools as a JSON-RPC error or an isError result —
    // either way the server must not 500.
    const errored = body.error !== undefined || body.result?.["isError"] === true;
    expect(errored).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects invalid tool arguments via schema validation (no network call)", async () => {
    // status must be 'owned' | 'want'; an invalid enum should fail before apiFetch.
    const body = await callTool("add_book", { isbn: "9780441013593", status: "borrowed" });
    const errored = body.error !== undefined || body.result?.["isError"] === true;
    expect(errored).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("returns 406 when the client does not accept text/event-stream", async () => {
    const res = await rpc(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { Accept: "application/json" },
    );
    expect(res.status).toBe(406);
  });
});
