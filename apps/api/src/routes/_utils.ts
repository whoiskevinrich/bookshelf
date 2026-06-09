import type { Context } from "hono";

/**
 * Parse the request body as JSON. Returns the parsed value on success, or a
 * Response on failure so callers can do `if (x instanceof Response) return x`.
 *
 * Distinguishes SyntaxError (malformed JSON → 400) from unexpected read errors
 * (→ 500) so clients get an actionable status code.
 */
export async function parseJsonBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON body" }, 400) as Response;
    }
    console.error("Unexpected error reading request body:", err);
    return c.json({ error: "Failed to read request body" }, 500) as Response;
  }
}
