import { Hono } from "hono";
import {
  ConditionalCheckFailedException,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import { authMiddleware } from "../middleware/auth.js";
import {
  queryBookEntries,
  getBookEntry,
  queryEditionsForIsbn,
  queryGroupedWith,
  putBookEntry,
  deleteBookEntry,
  updateBookEntryAttributes,
  updateBookEntryNotes,
  updateBookEntryTags,
  putBookMetadata,
  isValidStatus,
  isValidReadingStatus,
  derivedStatus,
  normalizeTag,
  InvalidCursorError,
  type BookMetadata,
  type ShelfEntry,
  type EntryAttributePatch,
  type EntryFilter,
  type ReadingStatus,
} from "../lib/dynamo.js";
import { getBookByIsbn } from "../lib/books/search.js";
import { isValidIsbn, normalizeIsbn } from "../lib/isbn.js";
import { isValidFormat, soloWorkKey, type EditionFormat } from "../lib/works.js";
import type { Context } from "hono";
import { parseJsonBody } from "./_utils.js";

export const shelfRouter = new Hono();

shelfRouter.use("*", authMiddleware);

const NOTES_MAX_LENGTH = 2000;

// Tag caps (ADR-019 / endpoint checklist). Enforced on the normalized form.
const TAGS_MAX_COUNT = 25;
const TAG_MAX_LENGTH = 50;

// Copies bound (BOOKSHELF-60 / endpoint checklist).
const COPIES_MAX = 99;

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
  const cursor = c.req.query("cursor");
  const rawLimit = c.req.query("limit");

  // Build the in-memory filter (ADR-019). `status` is the deprecated enum kept for
  // one release; it maps onto the owned/want booleans.
  const filter: EntryFilter = {};

  const rawStatus = c.req.query("status");
  if (rawStatus) {
    if (!isValidStatus(rawStatus)) {
      return c.json({ error: "status must be 'owned' or 'want'" }, 400);
    }
    if (rawStatus === "owned") filter.owned = true;
    else filter.want = true;
  }

  const rawOwned = c.req.query("owned");
  if (rawOwned !== undefined) {
    if (rawOwned !== "true" && rawOwned !== "false") {
      return c.json({ error: "owned must be 'true' or 'false'" }, 400);
    }
    filter.owned = rawOwned === "true";
  }

  const rawWant = c.req.query("want");
  if (rawWant !== undefined) {
    if (rawWant !== "true" && rawWant !== "false") {
      return c.json({ error: "want must be 'true' or 'false'" }, 400);
    }
    filter.want = rawWant === "true";
  }

  const rawReadingStatus = c.req.query("readingStatus");
  if (rawReadingStatus !== undefined) {
    if (!isValidReadingStatus(rawReadingStatus)) {
      return c.json({ error: "readingStatus must be 'unread', 'reading', or 'finished'" }, 400);
    }
    filter.readingStatus = rawReadingStatus;
  }

  const rawTag = c.req.query("tag");
  if (rawTag !== undefined) {
    const tag = normalizeTag(rawTag);
    if (tag.length === 0 || tag.length > TAG_MAX_LENGTH) {
      return c.json({ error: "tag must be 1–50 characters" }, 400);
    }
    filter.tag = tag;
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
      filter,
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

// GET /v1/shelf/:isbn — single entry with book metadata + its edition set (BOOKSHELF-90).
// `editions` is the sibling entries sharing this work's effective key (including self);
// `editions.length > 1` means "part of a multi-edition work".
shelfRouter.get("/:isbn", async (c) => {
  const { userId } = c.get("auth");

  const isbnOrErr = parseIsbnParam(c, c.req.param("isbn"));
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  try {
    const result = await queryEditionsForIsbn(userId, isbn);
    if (!result) {
      return c.json({ error: "Book not found on your shelf" }, 404);
    }
    return c.json({ ...result.entry, editions: result.editions });
  } catch (err) {
    console.error("Shelf entry fetch error:", err);
    return c.json({ error: "Failed to fetch book" }, 500);
  }
});

// POST /v1/shelf
shelfRouter.post("/", async (c) => {
  const { userId } = c.get("auth");

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj["isbn"] !== "string") {
    return c.json({ error: "Body must include isbn (string)" }, 400);
  }

  const isbnOrErr = parseIsbnParam(c, obj["isbn"]);
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  // Attributes: accept owned/want/readingStatus, or the deprecated `status` enum
  // (one transition release). At least one of owned/want must end up true.
  let owned = false;
  let want = false;

  if (obj["status"] !== undefined) {
    if (!isValidStatus(obj["status"])) {
      return c.json({ error: "status must be 'owned' or 'want'" }, 400);
    }
    owned = obj["status"] === "owned";
    want = obj["status"] === "want";
  }
  if (obj["owned"] !== undefined) {
    if (typeof obj["owned"] !== "boolean") {
      return c.json({ error: "owned must be a boolean" }, 400);
    }
    owned = obj["owned"];
  }
  if (obj["want"] !== undefined) {
    if (typeof obj["want"] !== "boolean") {
      return c.json({ error: "want must be a boolean" }, 400);
    }
    want = obj["want"];
  }

  // Owned and Want are mutually exclusive — a book is on the shelf or the
  // wishlist, never both, never neither.
  if (owned && want) {
    return c.json({ error: "owned and want are mutually exclusive" }, 400);
  }
  if (!owned && !want) {
    return c.json({ error: "A book must be added as owned or want" }, 400);
  }

  let readingStatus: ReadingStatus | null = null;
  if (obj["readingStatus"] !== undefined && obj["readingStatus"] !== null) {
    if (!isValidReadingStatus(obj["readingStatus"])) {
      return c.json({ error: "readingStatus must be 'unread', 'reading', or 'finished'" }, 400);
    }
    readingStatus = obj["readingStatus"];
  }

  const addedAt = new Date().toISOString();

  try {
    await putBookEntry(userId, isbn, { owned, want, readingStatus }, addedAt);
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

  let resolvedMeta: BookMetadata | null = null;
  try {
    resolvedMeta = clientBook ?? (await getBookByIsbn(isbn));
    if (resolvedMeta) await putBookMetadata(isbn, sanitizeBookMetadata(resolvedMeta), addedAt);
  } catch (err) {
    console.error("Book metadata cache error:", err);
  }

  // Edition grouping (BOOKSHELF-90): tell the client which existing editions this
  // add auto-joined, so it can raise the "grouped with …" notification. Best-effort
  // — a failure here must not fail the add (the book is already on the shelf).
  let groupedWith: string[] = [];
  try {
    groupedWith = await queryGroupedWith(userId, isbn, resolvedMeta);
  } catch (err) {
    console.error("Grouped-with computation error:", err);
  }

  return c.json(
    {
      isbn,
      owned,
      want,
      readingStatus,
      tags: [],
      addedAt,
      notes: null,
      copies: 1,
      format: null,
      status: derivedStatus(owned),
      groupedWith,
    },
    201,
  );
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

  return c.json({ ...existing, notes });
});

// PATCH /v1/shelf/:isbn/tags — replace the entry's tag set
shelfRouter.patch("/:isbn/tags", async (c) => {
  const { userId } = c.get("auth");

  const isbnOrErr = parseIsbnParam(c, c.req.param("isbn"));
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;

  const rawTags = (bodyOrErr as Record<string, unknown>)?.["tags"];
  if (!Array.isArray(rawTags) || !rawTags.every((t) => typeof t === "string")) {
    return c.json({ error: "tags must be an array of strings" }, 400);
  }

  // Normalize, drop empties, dedupe (so "Sci-Fi" + "sci-fi" collapse to one).
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTags as string[]) {
    const tag = normalizeTag(raw);
    if (tag.length === 0) continue;
    if (tag.length > TAG_MAX_LENGTH) {
      return c.json({ error: `Each tag must be ${TAG_MAX_LENGTH} characters or fewer` }, 400);
    }
    if (!seen.has(tag)) {
      seen.add(tag);
      normalized.push(tag);
    }
  }

  if (normalized.length > TAGS_MAX_COUNT) {
    return c.json({ error: `A book can have at most ${TAGS_MAX_COUNT} tags` }, 400);
  }

  let existing: ShelfEntry | null;
  try {
    existing = await getBookEntry(userId, isbn);
  } catch (err) {
    console.error("Shelf entry lookup error (tags):", err);
    return c.json({ error: "Failed to look up book" }, 500);
  }
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }

  try {
    await updateBookEntryTags(userId, isbn, normalized);
  } catch (err) {
    console.error("Shelf tags update error:", err);
    return c.json({ error: "Failed to update tags" }, 500);
  }

  return c.json({ ...existing, tags: [...normalized].sort() });
});

// PATCH /v1/shelf/:isbn — update owned / want / readingStatus (or legacy status)
shelfRouter.patch("/:isbn", async (c) => {
  const { userId } = c.get("auth");

  const isbnOrErr = parseIsbnParam(c, c.req.param("isbn"));
  if (isbnOrErr instanceof Response) return isbnOrErr;
  const isbn = isbnOrErr;

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const obj = (bodyOrErr ?? {}) as Record<string, unknown>;

  const patch: EntryAttributePatch = {};

  // Deprecated `status` enum (one transition release) → owned/want booleans.
  if (obj["status"] !== undefined) {
    if (!isValidStatus(obj["status"])) {
      return c.json({ error: "status must be 'owned' or 'want'" }, 400);
    }
    patch.owned = obj["status"] === "owned";
    patch.want = obj["status"] === "want";
  }
  if (obj["owned"] !== undefined) {
    if (typeof obj["owned"] !== "boolean") {
      return c.json({ error: "owned must be a boolean" }, 400);
    }
    patch.owned = obj["owned"];
  }
  if (obj["want"] !== undefined) {
    if (typeof obj["want"] !== "boolean") {
      return c.json({ error: "want must be a boolean" }, 400);
    }
    patch.want = obj["want"];
  }
  if (obj["readingStatus"] !== undefined) {
    if (obj["readingStatus"] !== null && !isValidReadingStatus(obj["readingStatus"])) {
      return c.json(
        { error: "readingStatus must be 'unread', 'reading', 'finished', or null" },
        400,
      );
    }
    patch.readingStatus = obj["readingStatus"] as ReadingStatus | null;
  }
  if (obj["copies"] !== undefined) {
    const copies = obj["copies"];
    if (
      typeof copies !== "number" ||
      !Number.isInteger(copies) ||
      copies < 1 ||
      copies > COPIES_MAX
    ) {
      return c.json({ error: `copies must be an integer between 1 and ${COPIES_MAX}` }, 400);
    }
    patch.copies = copies;
  }
  // Edition format (BOOKSHELF-90): one of the enum values, or null to clear.
  if (obj["format"] !== undefined) {
    if (obj["format"] !== null && !isValidFormat(obj["format"])) {
      return c.json(
        { error: "format must be 'hardcover', 'paperback', 'ebook', 'audiobook', or null" },
        400,
      );
    }
    patch.format = obj["format"] as EditionFormat | null;
  }
  // Ungroup / regroup (BOOKSHELF-90): a semantic verb. The raw workKey override stays
  // server-internal — `false` detaches this edition (unique solo key), `true` re-attaches
  // it (drop the override so the derived key applies). Translated to a patch below.
  let grouped: boolean | undefined;
  if (obj["grouped"] !== undefined) {
    if (typeof obj["grouped"] !== "boolean") {
      return c.json({ error: "grouped must be a boolean" }, 400);
    }
    grouped = obj["grouped"];
  }

  if (
    patch.owned === undefined &&
    patch.want === undefined &&
    patch.readingStatus === undefined &&
    patch.copies === undefined &&
    patch.format === undefined &&
    grouped === undefined
  ) {
    return c.json(
      { error: "Body must include owned, want, readingStatus, copies, format, or grouped" },
      400,
    );
  }

  // Owned and Want are mutually exclusive (ADR-019, revised). Setting one true
  // auto-clears the other when the other isn't explicitly provided; an explicit
  // request to set both true is rejected.
  if (patch.owned === true && patch.want === undefined) {
    patch.want = false;
  } else if (patch.want === true && patch.owned === undefined) {
    patch.owned = false;
  }
  if (patch.owned === true && patch.want === true) {
    return c.json({ error: "owned and want are mutually exclusive" }, 400);
  }

  let existing: ShelfEntry | null;
  try {
    existing = await getBookEntry(userId, isbn);
  } catch (err) {
    console.error("Shelf entry lookup error (attributes):", err);
    return c.json({ error: "Failed to look up book" }, 500);
  }
  if (!existing) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }

  // copies is only meaningful when owned (BOOKSHELF-60). Force it to 1 whenever the
  // resulting state is not owned — this covers owned→want *and* a bare `{copies}`
  // patch against a book that's already on the wishlist, so a non-owned entry can
  // never carry copies > 1 regardless of what the client sends.
  if (!(patch.owned ?? existing.owned)) {
    patch.copies = 1;
  }

  // Translate the `grouped` verb into the workKey override write (BOOKSHELF-90):
  // false → detach (unique solo key); true → re-attach (REMOVE the override → null).
  if (grouped !== undefined) {
    patch.workKey = grouped ? null : soloWorkKey(isbn);
  }

  try {
    await updateBookEntryAttributes(userId, isbn, patch);
  } catch (err) {
    console.error("Shelf update error:", err);
    return c.json({ error: "Failed to update book" }, 500);
  }

  const owned = patch.owned ?? existing.owned;
  const want = patch.want ?? existing.want;
  const readingStatus =
    patch.readingStatus !== undefined ? patch.readingStatus : existing.readingStatus;
  const copies = patch.copies ?? existing.copies;
  const format = patch.format !== undefined ? patch.format : existing.format;

  return c.json({
    isbn,
    owned,
    want,
    readingStatus,
    tags: existing.tags,
    addedAt: existing.addedAt,
    notes: existing.notes,
    copies,
    format,
    status: derivedStatus(owned),
  });
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
