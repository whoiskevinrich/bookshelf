import { Hono } from "hono";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { authMiddleware } from "../middleware/auth.js";
import {
  queryShelf,
  getShelfEntry,
  putShelfEntry,
  deleteShelfEntry,
  updateShelfStatus,
  updateShelfNotes,
  putBookMetadata,
  isValidStatus,
  InvalidCursorError,
  type BookMetadata,
  type ShelfStatus,
} from "../lib/dynamo.js";
import { getBookByIsbn } from "../lib/books/search.js";
import { isValidIsbn, normalizeIsbn } from "../lib/isbn.js";
import type { Context } from "hono";

export const shelfRouter = new Hono();

shelfRouter.use("*", authMiddleware);

const NOTES_MAX_LENGTH = 2000;

function parseIsbnParam(c: Context, raw: string): string | Response {
  if (!isValidIsbn(raw)) {
    return c.json({ error: "Invalid ISBN" }, 400) as Response;
  }
  return normalizeIsbn(raw);
}

async function parseJsonBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400) as Response;
  }
}

// GET /v1/shelf
shelfRouter.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rawStatus = c.req.query("status");
  const cursor = c.req.query("cursor");
  const rawLimit = c.req.query("limit");

  let status: ShelfStatus | undefined;
  if (rawStatus) {
    if (!isValidStatus(rawStatus)) {
      return c.json({ error: "status must be 'owned' or 'want'" }, 400);
    }
    status = rawStatus;
  }

  let limit: number | undefined;
  if (rawLimit) {
    limit = parseInt(rawLimit, 10);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return c.json({ error: "limit must be an integer between 1 and 100" }, 400);
    }
  }

  try {
    const opts: import("../lib/dynamo.js").QueryShelfOptions = { userId };
    if (status !== undefined) opts.status = status;
    if (cursor !== undefined) opts.cursor = cursor;
    if (limit !== undefined) opts.limit = limit;
    const result = await queryShelf(opts);
    return c.json(result);
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return c.json({ error: "Invalid cursor" }, 400);
    }
    console.error("Shelf query error:", err);
    return c.json({ error: "Failed to fetch shelf" }, 500);
  }
});

// POST /v1/shelf
shelfRouter.post("/", async (c) => {
  const { userId } = c.get("auth");

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>)["isbn"] !== "string" ||
    typeof (body as Record<string, unknown>)["status"] !== "string"
  ) {
    return c.json({ error: "Body must include isbn (string) and status (string)" }, 400);
  }

  const rawIsbn = (body as Record<string, string>)["isbn"]!;
  const rawStatus = (body as Record<string, string>)["status"]!;

  const isbnOrErr = parseIsbnParam(c, rawIsbn);
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  if (!isValidStatus(rawStatus)) {
    return c.json({ error: "status must be 'owned' or 'want'" }, 400);
  }
  const status = rawStatus;
  const addedAt = new Date().toISOString();

  try {
    await putShelfEntry(userId, isbn, status, addedAt);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return c.json({ error: "Book already exists on your shelf" }, 409);
    }
    console.error("Shelf put error:", err);
    return c.json({ error: "Failed to add book" }, 500);
  }

  // Save book metadata synchronously so it's available on the immediate shelf refetch.
  // If the client passed metadata from search results, use it directly (no extra API call).
  // Otherwise fall back to a Google Books lookup.
  const rawBook = (body as Record<string, unknown>)["book"];
  const clientBook =
    rawBook !== null &&
    typeof rawBook === "object" &&
    typeof (rawBook as Record<string, unknown>)["title"] === "string"
      ? (rawBook as BookMetadata)
      : null;

  try {
    const metadata = clientBook ?? (await getBookByIsbn(isbn));
    if (metadata) await putBookMetadata(isbn, metadata, addedAt);
  } catch (err) {
    console.error("Book metadata cache error:", err);
    // Non-fatal — shelf entry was saved; cover/title will be missing until next lookup
  }

  return c.json({ isbn, status, addedAt, notes: null }, 201);
});

// PATCH /v1/shelf/:isbn/notes
shelfRouter.patch("/:isbn/notes", async (c) => {
  const { userId } = c.get("auth");

  const isbnOrErr = parseIsbnParam(c, c.req.param("isbn"));
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;

  const rawNotes = (bodyOrErr as Record<string, unknown>)?.["notes"];
  if (rawNotes !== null && typeof rawNotes !== "string") {
    return c.json({ error: "notes must be a string or null" }, 400);
  }
  const notes = rawNotes as string | null;

  if (typeof notes === "string" && notes.length > NOTES_MAX_LENGTH) {
    return c.json({ error: `notes must be ${NOTES_MAX_LENGTH} characters or fewer` }, 400);
  }

  const existing = await getShelfEntry(userId, isbn);
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }

  try {
    await updateShelfNotes(userId, isbn, existing.status, notes);
  } catch (err) {
    console.error("Shelf notes update error:", err);
    return c.json({ error: "Failed to update notes" }, 500);
  }

  return c.json({ isbn, status: existing.status, addedAt: existing.addedAt, notes });
});

// PATCH /v1/shelf/:isbn
shelfRouter.patch("/:isbn", async (c) => {
  const { userId } = c.get("auth");

  const isbnOrErr = parseIsbnParam(c, c.req.param("isbn"));
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;

  const rawStatus = (bodyOrErr as Record<string, unknown>)?.["status"];
  if (!isValidStatus(rawStatus)) {
    return c.json({ error: "status must be 'owned' or 'want'" }, 400);
  }
  const newStatus = rawStatus;

  const existing = await getShelfEntry(userId, isbn);
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }
  if (existing.status === newStatus) {
    return c.json(existing);
  }

  try {
    await updateShelfStatus(
      userId,
      isbn,
      existing.status,
      newStatus,
      existing.addedAt,
      existing.notes,
    );
  } catch (err) {
    console.error("Shelf update error:", err);
    return c.json({ error: "Failed to update book status" }, 500);
  }

  return c.json({ isbn, status: newStatus, addedAt: existing.addedAt, notes: existing.notes });
});

// DELETE /v1/shelf/:isbn
shelfRouter.delete("/:isbn", async (c) => {
  const { userId } = c.get("auth");

  const isbnOrErr = parseIsbnParam(c, c.req.param("isbn"));
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  const existing = await getShelfEntry(userId, isbn);
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }

  try {
    await deleteShelfEntry(userId, isbn, existing.status);
  } catch (err) {
    console.error("Shelf delete error:", err);
    return c.json({ error: "Failed to remove book" }, 500);
  }

  return c.body(null, 204);
});
