import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, okResult, errResult } from "../lib/api.js";

export function registerShelfTools(server: McpServer, idToken: string, apiBase: string): void {
  server.tool(
    "list_shelf",
    "List books on your shelf. Optionally filter by status (owned or want-to-read). Supports pagination via cursor.",
    {
      status: z.enum(["owned", "want"]).optional().describe("Filter by status: 'owned' or 'want'"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results (1–100, default 20)"),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response's nextCursor"),
    },
    async ({ status, limit, cursor }) => {
      const params = new URLSearchParams();
      if (status !== undefined) params.set("status", status);
      if (limit !== undefined) params.set("limit", String(limit));
      if (cursor !== undefined) params.set("cursor", cursor);
      const qs = params.size > 0 ? `?${params.toString()}` : "";
      const { ok, status: httpStatus, data } = await apiFetch(`${apiBase}/v1/shelf${qs}`, idToken);
      if (!ok) return errResult(httpStatus, data);
      return okResult(data);
    },
  );

  server.tool(
    "add_book",
    "Add a book to your shelf. Use 'owned' if you own it, 'want' to add it to your wishlist. Provide the ISBN (10 or 13 digits); use search_books or lookup_book_isbn first if you don't know the ISBN.",
    {
      isbn: z.string().describe("ISBN-10 or ISBN-13 of the book to add"),
      status: z.enum(["owned", "want"]).describe("'owned' — you own it; 'want' — wishlist"),
    },
    async ({ isbn, status }) => {
      const {
        ok,
        status: httpStatus,
        data,
      } = await apiFetch(`${apiBase}/v1/shelf`, idToken, {
        method: "POST",
        body: { isbn, status },
      });
      if (httpStatus === 409) {
        return {
          content: [{ type: "text" as const, text: "This book is already on your shelf." }],
        };
      }
      if (!ok) return errResult(httpStatus, data);
      return okResult(data);
    },
  );

  server.tool(
    "update_book_status",
    "Change a book's status between 'owned' and 'want'. Use this to mark a wishlist book as owned after purchase, or to move an owned book to your wishlist.",
    {
      isbn: z.string().describe("ISBN of the book to update (hyphens are stripped automatically)"),
      status: z.enum(["owned", "want"]).describe("New status: 'owned' or 'want'"),
    },
    async ({ isbn, status }) => {
      const url = `${apiBase}/v1/shelf/${encodeURIComponent(isbn.replace(/-/g, ""))}`;
      const {
        ok,
        status: httpStatus,
        data,
      } = await apiFetch(url, idToken, {
        method: "PATCH",
        body: { status },
      });
      if (!ok) return errResult(httpStatus, data);
      return okResult(data);
    },
  );

  server.tool(
    "remove_book",
    "Remove a book from your shelf entirely. This cannot be undone.",
    {
      isbn: z.string().describe("ISBN of the book to remove (hyphens are stripped automatically)"),
    },
    async ({ isbn }) => {
      const url = `${apiBase}/v1/shelf/${encodeURIComponent(isbn.replace(/-/g, ""))}`;
      const { ok, status: httpStatus, data } = await apiFetch(url, idToken, { method: "DELETE" });
      if (!ok) return errResult(httpStatus, data);
      return { content: [{ type: "text" as const, text: "Book removed from shelf." }] };
    },
  );

  server.tool(
    "set_notes",
    "Set or clear a personal note on a shelf entry. Pass null to clear an existing note.",
    {
      isbn: z.string().describe("ISBN of the book (hyphens are stripped automatically)"),
      notes: z.string().nullable().describe("Note text, or null to clear"),
    },
    async ({ isbn, notes }) => {
      const url = `${apiBase}/v1/shelf/${encodeURIComponent(isbn.replace(/-/g, ""))}/notes`;
      const {
        ok,
        status: httpStatus,
        data,
      } = await apiFetch(url, idToken, {
        method: "PATCH",
        body: { notes },
      });
      if (!ok) return errResult(httpStatus, data);
      return okResult(data);
    },
  );
}
