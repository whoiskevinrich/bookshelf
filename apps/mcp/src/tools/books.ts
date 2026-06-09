import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, okResult, errResult } from "../lib/api.js";

export function registerBookTools(server: McpServer, idToken: string, apiBase: string): void {
  server.tool(
    "search_books",
    "Search for books by title, author, or keyword using the Google Books catalog. Returns up to 10 results.",
    { query: z.string().min(1).describe("Search terms — title, author, or keyword") },
    async ({ query }) => {
      const url = `${apiBase}/v1/books/search?q=${encodeURIComponent(query)}`;
      const { ok, status, data } = await apiFetch(url, idToken);
      if (!ok) return errResult(status, data);
      return okResult(data);
    },
  );

  server.tool(
    "lookup_book_isbn",
    "Look up a single book by ISBN-10 or ISBN-13 (hyphens allowed). Returns title, authors, cover URL, and description.",
    { isbn: z.string().describe("ISBN-10 or ISBN-13 with optional hyphens") },
    async ({ isbn }) => {
      const url = `${apiBase}/v1/books/isbn/${encodeURIComponent(isbn)}`;
      const { ok, status, data } = await apiFetch(url, idToken);
      if (!ok) return errResult(status, data);
      return okResult(data);
    },
  );

  server.tool(
    "lookup_book_asin",
    "Look up a book by Amazon ASIN. Many book ASINs are ISBN-10s; the lookup tries the ISBN path first then falls back to keyword search.",
    { asin: z.string().describe("Amazon ASIN (typically a 10-character alphanumeric string)") },
    async ({ asin }) => {
      const url = `${apiBase}/v1/books/asin/${encodeURIComponent(asin)}`;
      const { ok, status, data } = await apiFetch(url, idToken);
      if (!ok) return errResult(status, data);
      return okResult(data);
    },
  );
}
