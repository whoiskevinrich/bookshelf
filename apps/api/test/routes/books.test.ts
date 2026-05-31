import { describe, it, expect, vi, beforeEach } from "vitest";

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
});

describe("GET /v1/books/search", () => {
  it("returns 400 when q is missing", async () => {
    const app = makeApp();
    const res = await app.request("/v1/books/search");
    expect(res.status).toBe(400);
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
