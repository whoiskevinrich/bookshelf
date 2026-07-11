import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: import("hono").Context, next: import("hono").Next) => {
    c.set("auth", { userId: "test-user-sub" });
    await next();
  }),
}));

// Mock dynamo — import the pure helpers from the real module so instanceof / enum
// validation in route handlers work against the same implementations.
vi.mock("../../src/lib/dynamo.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/lib/dynamo.js")>();
  return {
    queryBookEntries: vi.fn(),
    getBookEntry: vi.fn(),
    batchGetBookEntries: vi.fn(),
    putBookEntry: vi.fn(),
    deleteBookEntry: vi.fn(),
    updateBookEntryAttributes: vi.fn(),
    updateBookEntryNotes: vi.fn(),
    updateBookEntryTags: vi.fn(),
    putBookMetadata: vi.fn(),
    isValidStatus: mod.isValidStatus,
    isValidReadingStatus: mod.isValidReadingStatus,
    derivedStatus: mod.derivedStatus,
    normalizeTag: mod.normalizeTag,
    InvalidCursorError: mod.InvalidCursorError,
  };
});

// Mock book search
vi.mock("../../src/lib/books/search.js", () => ({
  getBookByIsbn: vi.fn(),
}));

import { Hono } from "hono";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  queryBookEntries,
  getBookEntry,
  batchGetBookEntries,
  putBookEntry,
  deleteBookEntry,
  updateBookEntryAttributes,
  updateBookEntryNotes,
  updateBookEntryTags,
  putBookMetadata,
  InvalidCursorError,
  type ShelfEntry,
} from "../../src/lib/dynamo.js";
import { shelfRouter } from "../../src/routes/shelf.js";

function makeApp() {
  const app = new Hono();
  app.route("/v1/shelf", shelfRouter);
  return app;
}

const ENTRY: ShelfEntry = {
  isbn: "9780441013593",
  owned: true,
  want: false,
  readingStatus: null,
  tags: [],
  addedAt: "2026-05-14T10:00:00.000Z",
  notes: null,
  copies: 1,
  status: "owned",
};

const WANT_ENTRY: ShelfEntry = {
  ...ENTRY,
  owned: false,
  want: true,
  status: "want",
};

const SHELF_RESULT = {
  entries: [{ ...ENTRY, book: null }],
  nextCursor: null,
  total: 1,
};

beforeEach(() => {
  vi.mocked(queryBookEntries).mockReset();
  vi.mocked(getBookEntry).mockReset();
  vi.mocked(batchGetBookEntries).mockReset();
  vi.mocked(putBookEntry).mockReset();
  vi.mocked(deleteBookEntry).mockReset();
  vi.mocked(updateBookEntryAttributes).mockReset();
  vi.mocked(updateBookEntryNotes).mockReset();
  vi.mocked(updateBookEntryTags).mockReset();
  vi.mocked(putBookMetadata).mockReset();
});

describe("GET /v1/shelf", () => {
  it("returns paginated shelf entries", async () => {
    vi.mocked(queryBookEntries).mockResolvedValueOnce(SHELF_RESULT);
    const app = makeApp();
    const res = await app.request("/v1/shelf");
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof SHELF_RESULT;
    expect(body.entries).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("maps deprecated ?status=owned onto the owned filter", async () => {
    vi.mocked(queryBookEntries).mockResolvedValueOnce(SHELF_RESULT);
    const app = makeApp();
    const res = await app.request("/v1/shelf?status=owned");
    expect(res.status).toBe(200);
    expect(vi.mocked(queryBookEntries)).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.objectContaining({ owned: true }) }),
    );
  });

  it("accepts owned/want/readingStatus filters", async () => {
    vi.mocked(queryBookEntries).mockResolvedValueOnce(SHELF_RESULT);
    const app = makeApp();
    const res = await app.request("/v1/shelf?owned=true&readingStatus=reading");
    expect(res.status).toBe(200);
    expect(vi.mocked(queryBookEntries)).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ owned: true, readingStatus: "reading" }),
      }),
    );
  });

  it("returns 400 for invalid status filter", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf?status=reading");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-boolean owned filter", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf?owned=yes");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid readingStatus filter", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf?readingStatus=halfway");
    expect(res.status).toBe(400);
  });

  it("accepts a normalized tag filter", async () => {
    vi.mocked(queryBookEntries).mockResolvedValueOnce(SHELF_RESULT);
    const app = makeApp();
    const res = await app.request("/v1/shelf?tag=Sci-Fi");
    expect(res.status).toBe(200);
    expect(vi.mocked(queryBookEntries)).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.objectContaining({ tag: "sci-fi" }) }),
    );
  });

  it("decodes a %20-encoded multi-word tag to a space", async () => {
    vi.mocked(queryBookEntries).mockResolvedValueOnce(SHELF_RESULT);
    const app = makeApp();
    const res = await app.request("/v1/shelf?tag=science%20fiction");
    expect(res.status).toBe(200);
    expect(vi.mocked(queryBookEntries)).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.objectContaining({ tag: "science fiction" }) }),
    );
  });

  it("returns 400 for invalid limit", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf?limit=200");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed cursor", async () => {
    vi.mocked(queryBookEntries).mockRejectedValueOnce(new InvalidCursorError());
    const app = makeApp();
    const res = await app.request("/v1/shelf?cursor=not-valid-json");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/shelf/:isbn", () => {
  it("returns a single entry with book metadata", async () => {
    vi.mocked(batchGetBookEntries).mockResolvedValueOnce([{ ...ENTRY, book: null }]);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.isbn).toBe("9780441013593");
    expect(body.owned).toBe(true);
  });

  it("returns 404 when the book is not on the shelf", async () => {
    vi.mocked(batchGetBookEntries).mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593");
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid ISBN", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/not-an-isbn");
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/shelf", () => {
  it("adds a book via the deprecated status field", async () => {
    vi.mocked(putBookEntry).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", status: "owned" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ShelfEntry;
    expect(body.isbn).toBe("9780441013593");
    expect(body.owned).toBe(true);
    expect(body.want).toBe(false);
    expect(body.status).toBe("owned");
    expect(vi.mocked(putBookEntry)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      expect.objectContaining({ owned: true, want: false }),
      expect.any(String),
    );
  });

  it("adds a book via owned boolean", async () => {
    vi.mocked(putBookEntry).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", owned: true, readingStatus: "reading" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ShelfEntry;
    expect(body.owned).toBe(true);
    expect(body.readingStatus).toBe("reading");
    expect(body.copies).toBe(1);
  });

  it("returns 400 when neither owned, want, nor status is provided", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when owned and want are both false", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", owned: false, want: false }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when owned and want are both true (mutually exclusive)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", owned: true, want: true }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid readingStatus", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", owned: true, readingStatus: "halfway" }),
    });
    expect(res.status).toBe(400);
  });

  it("truncates description to 4000 chars before caching", async () => {
    vi.mocked(putBookEntry).mockResolvedValueOnce(undefined);
    vi.mocked(putBookMetadata).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isbn: "9780441013593",
        owned: true,
        book: {
          title: "Dune",
          authors: ["Frank Herbert"],
          coverUrl: null,
          publishedYear: 1965,
          description: "a".repeat(4001),
        },
      }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(putBookMetadata)).toHaveBeenCalledWith(
      "9780441013593",
      expect.objectContaining({ description: "a".repeat(4000) }),
      expect.any(String),
    );
  });

  it("returns 400 for invalid ISBN", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "1234567890123", owned: true }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate", async () => {
    const err = new ConditionalCheckFailedException({ message: "condition failed", $metadata: {} });
    vi.mocked(putBookEntry).mockRejectedValueOnce(err);
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", owned: true }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid status", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", status: "reading" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /v1/shelf/:isbn/notes", () => {
  it("accepts notes at exactly the max length (2000 chars)", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryNotes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "a".repeat(2000) }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 when notes exceeds max length", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "a".repeat(2001) }),
    });
    expect(res.status).toBe(400);
  });

  it("updates notes successfully and returns the full entry", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryNotes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "A great book." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.notes).toBe("A great book.");
    expect(body.owned).toBe(true);
    expect(body.status).toBe("owned");
  });

  it("returns 400 for invalid ISBN in path", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/not-an-isbn/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "fine" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when notes is wrong type (number)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: 42 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /v1/shelf/:isbn", () => {
  it("updates status from owned to want (deprecated field)", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "want" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.owned).toBe(false);
    expect(body.want).toBe(true);
    expect(body.status).toBe("want");
  });

  it("auto-clears want when a wishlist book is marked owned (Q1)", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(WANT_ENTRY);
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owned: true }),
    });
    expect(res.status).toBe(200);
    // The persisted patch sets want:false alongside owned:true.
    expect(vi.mocked(updateBookEntryAttributes)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      expect.objectContaining({ owned: true, want: false }),
    );
    const body = (await res.json()) as ShelfEntry;
    expect(body.owned).toBe(true);
    expect(body.want).toBe(false);
  });

  it("rejects setting owned and want both true (mutually exclusive)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owned: true, want: true }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(updateBookEntryAttributes)).not.toHaveBeenCalled();
  });

  it("auto-clears owned when an owned book is marked want (symmetric)", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ want: true }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateBookEntryAttributes)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      expect.objectContaining({ want: true, owned: false }),
    );
    const body = (await res.json()) as ShelfEntry;
    expect(body.want).toBe(true);
    expect(body.owned).toBe(false);
  });

  it("updates readingStatus only, leaving owned/want untouched", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingStatus: "reading" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.readingStatus).toBe("reading");
    expect(body.owned).toBe(true);
    expect(vi.mocked(updateBookEntryAttributes)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      { readingStatus: "reading" },
    );
  });

  it("clears readingStatus when null is passed", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce({ ...ENTRY, readingStatus: "reading" });
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingStatus: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.readingStatus).toBeNull();
  });

  it("returns 400 when the body has no updatable fields", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid readingStatus", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingStatus: "halfway" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 if book not on shelf", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ want: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/shelf/:isbn — copies (BOOKSHELF-60)", () => {
  it("updates copies within range", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: 3 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.copies).toBe(3);
    expect(vi.mocked(updateBookEntryAttributes)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      { copies: 3 },
    );
  });

  it("accepts copies at the max bound (99)", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: 99 }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 for copies below 1", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: 0 }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(updateBookEntryAttributes)).not.toHaveBeenCalled();
  });

  it("returns 400 for copies above 99", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-integer copies value", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: 2.5 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric copies value", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: "3" }),
    });
    expect(res.status).toBe(400);
  });

  it("resets copies to 1 when moving an owned book to want", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce({ ...ENTRY, copies: 3 });
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ want: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.copies).toBe(1);
    expect(vi.mocked(updateBookEntryAttributes)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      expect.objectContaining({ want: true, owned: false, copies: 1 }),
    );
  });

  it("overrides a client-supplied copies value when also moving to want", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce({ ...ENTRY, copies: 3 });
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ want: true, copies: 5 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.copies).toBe(1);
  });

  it("leaves copies untouched when only readingStatus changes", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce({ ...ENTRY, copies: 4 });
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingStatus: "reading" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.copies).toBe(4);
  });

  it("forces copies to 1 for a bare copies patch on a wishlist (non-owned) book", async () => {
    // copies is owned-only — a client (or bug) sending copies to a want entry must
    // never persist copies > 1 on it.
    vi.mocked(getBookEntry).mockResolvedValueOnce(WANT_ENTRY);
    vi.mocked(updateBookEntryAttributes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: 5 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.copies).toBe(1);
    expect(vi.mocked(updateBookEntryAttributes)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      expect.objectContaining({ copies: 1 }),
    );
  });
});

describe("PATCH /v1/shelf/:isbn/tags", () => {
  it("replaces the tag set and returns sorted tags", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryTags).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["sci-fi", "favorites"] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShelfEntry;
    expect(body.tags).toEqual(["favorites", "sci-fi"]);
    expect(vi.mocked(updateBookEntryTags)).toHaveBeenCalledWith("test-user-sub", "9780441013593", [
      "sci-fi",
      "favorites",
    ]);
  });

  it("normalizes and dedupes (Sci-Fi / sci-fi / spaces collapse to one)", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryTags).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["  Sci-Fi ", "sci-fi", "book   club", ""] }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateBookEntryTags)).toHaveBeenCalledWith("test-user-sub", "9780441013593", [
      "sci-fi",
      "book club",
    ]);
  });

  it("clears all tags (empty array)", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce({ ...ENTRY, tags: ["sci-fi"] });
    vi.mocked(updateBookEntryTags).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: [] }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateBookEntryTags)).toHaveBeenCalledWith(
      "test-user-sub",
      "9780441013593",
      [],
    );
    const body = (await res.json()) as ShelfEntry;
    expect(body.tags).toEqual([]);
  });

  it("returns 400 when tags is not an array of strings", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["ok", 42] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when a tag exceeds the length cap", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["a".repeat(51)] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the tag count exceeds the cap (after dedupe)", async () => {
    const app = makeApp();
    const tooMany = Array.from({ length: 26 }, (_, i) => `tag${i}`);
    const res = await app.request("/v1/shelf/9780441013593/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: tooMany }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the book is not on the shelf", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["sci-fi"] }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/shelf/:isbn", () => {
  it("deletes an entry successfully", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(deleteBookEntry).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("returns 404 if book not on shelf", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
