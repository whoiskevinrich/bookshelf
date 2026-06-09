import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: import("hono").Context, next: import("hono").Next) => {
    c.set("auth", { userId: "test-user-sub" });
    await next();
  }),
}));

// Mock dynamo — import InvalidCursorError and isValidStatus from the real module
// so instanceof checks in route handlers work against the same class.
vi.mock("../../src/lib/dynamo.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/lib/dynamo.js")>();
  return {
    queryBookEntries: vi.fn(),
    getBookEntry: vi.fn(),
    putBookEntry: vi.fn(),
    deleteBookEntry: vi.fn(),
    updateBookEntryStatus: vi.fn(),
    updateBookEntryNotes: vi.fn(),
    putBookMetadata: vi.fn(),
    isValidStatus: mod.isValidStatus,
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
  putBookEntry,
  deleteBookEntry,
  updateBookEntryStatus,
  updateBookEntryNotes,
  putBookMetadata,
  InvalidCursorError,
} from "../../src/lib/dynamo.js";
import { shelfRouter } from "../../src/routes/shelf.js";

function makeApp() {
  const app = new Hono();
  app.route("/v1/shelf", shelfRouter);
  return app;
}

const ENTRY = {
  isbn: "9780441013593",
  status: "owned" as const,
  addedAt: "2026-05-14T10:00:00.000Z",
  notes: null,
};

const SHELF_RESULT = {
  entries: [{ ...ENTRY, book: null }],
  nextCursor: null,
  total: 1,
};

beforeEach(() => {
  vi.mocked(queryBookEntries).mockReset();
  vi.mocked(getBookEntry).mockReset();
  vi.mocked(putBookEntry).mockReset();
  vi.mocked(deleteBookEntry).mockReset();
  vi.mocked(updateBookEntryStatus).mockReset();
  vi.mocked(updateBookEntryNotes).mockReset();
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

  it("returns 400 for invalid status filter", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf?status=reading");
    expect(res.status).toBe(400);
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

describe("POST /v1/shelf", () => {
  it("adds a book successfully", async () => {
    vi.mocked(putBookEntry).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780441013593", status: "owned" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as typeof ENTRY;
    expect(body.isbn).toBe("9780441013593");
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
        status: "owned",
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

  it("truncates title to 512 chars before caching", async () => {
    vi.mocked(putBookEntry).mockResolvedValueOnce(undefined);
    vi.mocked(putBookMetadata).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isbn: "9780441013593",
        status: "owned",
        book: {
          title: "T".repeat(513),
          authors: ["Frank Herbert"],
          coverUrl: null,
          publishedYear: 1965,
          description: null,
        },
      }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(putBookMetadata)).toHaveBeenCalledWith(
      "9780441013593",
      expect.objectContaining({ title: "T".repeat(512) }),
      expect.any(String),
    );
  });

  it("returns 400 for invalid ISBN", async () => {
    const app = makeApp();
    const res = await app.request("/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "1234567890123", status: "owned" }),
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
      body: JSON.stringify({ isbn: "9780441013593", status: "owned" }),
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

  it("updates notes successfully", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryNotes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "A great book." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: string | null };
    expect(body.notes).toBe("A great book.");
  });

  it("clears notes when null is passed", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce({ ...ENTRY, notes: "old note" });
    vi.mocked(updateBookEntryNotes).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: string | null };
    expect(body.notes).toBeNull();
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
  it("updates status from owned to want", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(ENTRY);
    vi.mocked(updateBookEntryStatus).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "want" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("want");
  });

  it("returns 404 if book not on shelf", async () => {
    vi.mocked(getBookEntry).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request("/v1/shelf/9780441013593", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "want" }),
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
