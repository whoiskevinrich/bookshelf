import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Tool handlers return MCP content blocks. `isError` is set on failure paths.
 */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface CapturedTool {
  description: string;
  schema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * A stand-in for McpServer that records `server.tool(...)` registrations so the
 * handler can be invoked directly in a unit test — no transport, no protocol.
 * This exercises the handler logic (URL building, status mapping, ISBN
 * normalization) while `apiFetch` is mocked. Zod schema validation is NOT run
 * here (the SDK does that at the protocol boundary); cover that in Layer 3.
 */
export function captureTools(): { server: McpServer; tools: Map<string, CapturedTool> } {
  const tools = new Map<string, CapturedTool>();
  const server = {
    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: ToolHandler,
    ): void {
      tools.set(name, { description, schema, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}
