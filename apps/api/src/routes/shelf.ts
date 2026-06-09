import { Hono } from "hono";
import { ConditionalCheckFailedException, DynamoDBServiceException } from "@aws-sdk/client-dynamodb";
import { authMiddleware } from "../middleware/auth.js";
import {
  queryBookEntries,
  getBookEntry,
  putBookEntry,
  deleteBookEntry,
  updateBookEntryStatus,
  updateBookEntryNotes,
  putBookMetadata,
  isValidStatus,
  InvalidCursorError,
  type BookMetadata,
  type ShelfEntry,
  type ShelfStatus,
} from "../lib/dynamo.js";
import { getBookByIsbn } from "../lib/books/search.js";
import { isValidIsbn, normalizeIsbn } from "../lib/isbn.js";
import type { Context } from "hono";
import { parseJsonBody } from "./_utils.js";

export const shelfRouter = new Hono();

shelfRouter.use("*", authMiddleware);

const NOTES_MAX_LENGTH = 2000;

// BookMetadata field caps — applied before every putBookMetadata write.
// The BOOK#${isbn} cache is shared across all users, so we bound the fields
// regardless of whether metadata comes from the client or Google Books.
const BOOK_TITLE_MAX_LENGTH = 512;
const BOOK_DESCRIPTION_MAX_LENGTH = 4000;
const BOOK_COVER_URL_MAX_LENGTH = 2048;
const BOOK_AUTHOR_NAME_MAX_LENGTH = 200;
const BOOK_AUTHORS_MAX_COUNT = 20;

function sanitizeBookMetadata(m: BookMetadata): BookMetadata {
  return {
    title: m.title.slice(0, BOOK_TITLE_MAX_LENGTH),
    authors: m.authors
      .slice(0, BOOK_AUTHORS_MAX_COUNT)
      .map((a) => a.slice(0, BOOK_AUTHOR_NAME_MAX_LENGTH)),
    coverUrl: m.coverUrl ? m.coverUrl.slice(0, BOOK_COVER_URL_MAX_LENGTH) : null,
    publishedYear: m.publishedYear,
    description: m.description ? m.description.slice(0, BOOK_DESCRIPTION_MAX_LENGTH) : null,
  };
}

function parseIsbnParam(c: Context, raw: string): string | Response {
  if (!isValidIsbn(raw)) {
    return c.json({ error: "Invalid ISBN" }, 400) as Response;
  }
  return normalizeIsbn(raw);
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
    const result = await queryBookEntries({
      userId,
      ...(status !== undefined ? { status } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json(result);
  } catch (err) {
    // InvalidCursorError: cursor was syntactically invalid (decodeCursor threw).
    // ValidationException: cursor decoded fine but DynamoDB rejected the key shape.
    // Both are client errors — the cursor token is unusable.
    if (
      err instanceof InvalidCursorError ||
      (err instanceof DynamoDBServiceException && err.name === "ValidationException")
    ) {
      console.warn("Invalid pagination cursor rejected", { userId, cursor });
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
    await putBookEntry(userId, isbn, status, addedAt);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return c.json({ error: "Book already exists on your shelf" }, 409);
    }
    console.error("Shelf put error:", err);
    return c.json({ error: "Failed to add book" }, 500);
  }

  const rawBook = (body as Record<string, unknown>)["book"];
  const clientBook =
    rawBook !== null &&
    typeof rawBook === "object" &&
    typeof (rawBook as Record<string, unknown>)["title"] === "string"
      ? (rawBook as BookMetadata)
      : null;

  try {
    const metadata = clientBook ?? (await getBookByIsbn(isbn));
    if (metadata) await putBookMetadata(isbn, sanitizeBookMetadata(metadata), addedAt);
  } catch (err) {
    console.error("Book metadata cache error:", err);
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

  let existing: ShelfEntry | null;
  try {
    existing = await getBookEntry(userId, isbn);
  } catch (err) {
    console.error("Shelf entry lookup error (notes):", err);
    return c.json({ error: "Failed to look up book" }, 500);
  }
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }

  try {
    await updateBookEntryNotes(userId, isbn, notes);
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

  let existing: ShelfEntry | null;
  try {
    existing = await getBookEntry(userId, isbn);
  } catch (err) {
    console.error("Shelf entry lookup error (status):", err);
    return c.json({ error: "Failed to look up book" }, 500);
  }
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }
  if (existing.status === newStatus) {
    return c.json(existing);
  }

  try {
    await updateBookEntryStatus(userId, isbn, newStatus);
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

  let existing: ShelfEntry | null;
  try {
    existing = await getBookEntry(userId, isbn);
  } catch (err) {
    console.error("Shelf entry lookup error (delete):", err);
    return c.json({ error: "Failed to look up book" }, 500);
  }
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }

  try {
    await deleteBookEntry(userId, isbn);
  } catch (err) {
    console.error("Shelf delete error:", err);
    return c.json({ error: "Failed to remove book" }, 500);
  }

  return c.body(null, 204);
});
