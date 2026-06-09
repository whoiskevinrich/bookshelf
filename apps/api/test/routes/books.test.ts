import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: import("hono").Context, next: import("hono").Next) => {
    c.set("auth", { userId: "test-user-sub", cognitoUsername: "test@example.com" });
    await next();
  }),
}));

vi.mock("../../src/lib/books/search.js", () => ({
  searchBooks: vi.fn(),
  getBookByIsbn: vi.fn(),
  getBookByAsin: vi.fn(),
}));

import { searchBooks, getBookByIsbn, getBookByAsin } from "../../src/lib/books/search.js";
import { booksRouter } from "../../src/routes/books.js";
import { Hono } from "hono";

function makeApp() {
  const app = new Hono();
  app.route("/v1/books", booksRouter);
  return app;
}

const BOOK = {
  isbn: "9780441013593",
  title: "Dune",
  authors: ["Frank Herbert"],
  coverUrl: "https://example.com/dune.jpg",
  publishedYear: 1965,
  description: "A sci-fi classic.",
};

beforeEach(() => {
  vi.mocked(searchBooks).mockReset();
  vi.mocked(getBookByIsbn).mockReset();
  vi.mocked(getBookByAsin).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /v1/books/search", () => {
  it("returns 400 when q is missing", async () => {
    const app = makeApp();
    const res = await app.request("/v1/books/search");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q exceeds max length", async () => {
    const app = makeApp();
    const res = await app.request(`/v1/books/search?q=${"a".repeat(201)}`);
    expect(res.status).toBe(400);
  });

  it("accepts q at exactly the max length (200 chars)", async () => {
    vi.mocked(searchBooks).mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await app.request(`/v1/books/search?q=${"a".repeat(200)}`);
    expect(res.status).toBe(200);
  });

  it("returns results on valid query", async () => {
    vi.mocked(searchBooks).mockResolvedValueOnce([BOOK]);
    const app = makeApp();
    const res = await app.request("/v1/books/search?q=dune");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(1);
  });

  it("returns 502 on provider error", async () => {
    vi.mocked(searchBooks).mockRejectedValueOnce(new Error("API down"));
    const app = makeApp();
    const res = await app.request("/v1/books/search?q=dune");
    expect(res.status).toBe(502);
  });
});

describe("GET /v1/books/isbn/:isbn", () => {
  it("returns 400 for ISBN failing checksum validation", async () => {
    const app = makeApp();
    // 9780441013594 has wrong check digit (valid length but bad checksum)
    const res = await app.request("/v1/books/isbn/9780441013594");
    expect(res.status).toBe(400);
  });

  it("returns 404 when book not found", async () => {
    vi.mocked(getBookByIsbn).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request("/v1/books/isbn/9780441013593");
    expect(res.status).toBe(404);
  });

  it("returns book on success", async () => {
    vi.mocked(getBookByIsbn).mockResolvedValueOnce(BOOK);
    const app = makeApp();
    const res = await app.request("/v1/books/isbn/9780441013593");
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof BOOK;
    expect(body.title).toBe("Dune");
  });
});

describe("GET /v1/books/asin/:asin", () => {
  it("returns 400 for invalid ASIN format", async () => {
    const app = makeApp();
    const res = await app.request("/v1/books/asin/NOT_VALID!@#");
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty ASIN", async () => {
    // Path parameter won't be empty (Hono routes to /asin/ which won't match), but
    // a space-only ASIN after trim is empty — covered by the pattern not matching ""
    const app = makeApp();
    const res = await app.request("/v1/books/asin/%20");
    expect(res.status).toBe(400);
  });

  it("returns 400 for ASIN exceeding max length (21 chars)", async () => {
    const app = makeApp();
    const res = await app.request(`/v1/books/asin/${"A".repeat(21)}`);
    expect(res.status).toBe(400);
  });

  it("accepts ASIN at exactly max length (20 chars)", async () => {
    vi.mocked(getBookByAsin).mockResolvedValueOnce(BOOK);
    const app = makeApp();
    const res = await app.request(`/v1/books/asin/${"A".repeat(20)}`);
    expect(res.status).toBe(200);
  });

  it("returns book on valid ASIN", async () => {
    vi.mocked(getBookByAsin).mockResolvedValueOnce(BOOK);
    const app = makeApp();
    const res = await app.request("/v1/books/asin/B000FC1DQ4");
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof BOOK;
    expect(body.title).toBe("Dune");
  });

  it("returns 404 when book not found", async () => {
    vi.mocked(getBookByAsin).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request("/v1/books/asin/B000FC1DQ4");
    expect(res.status).toBe(404);
  });
});
