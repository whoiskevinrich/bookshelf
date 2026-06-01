import { http, HttpResponse } from "msw";
import { MOCK_SHELF } from "./seed-data";
import type { ShelfEntry, ShelfStatus } from "../lib/api-client";

// In-memory shelf state for the mock session
let shelf: ShelfEntry[] = [...MOCK_SHELF];

export const handlers = [
  // GET /v1/shelf
  http.get("/v1/shelf", ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as ShelfStatus | null;
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

    const filtered = status ? shelf.filter((e) => e.status === status) : shelf;
    const page = filtered.slice(0, limit);

    return HttpResponse.json({
      entries: page,
      nextCursor: null,
      total: filtered.length,
    });
  }),

  // POST /v1/shelf
  http.post("/v1/shelf", async ({ request }) => {
    const body = (await request.json()) as {
      isbn: string;
      status: ShelfStatus;
      book?: ShelfEntry["book"];
    };

    if (shelf.some((e) => e.isbn === body.isbn)) {
      return HttpResponse.json({ error: "Book already exists on your shelf" }, { status: 409 });
    }

    const entry: ShelfEntry = {
      isbn: body.isbn,
      status: body.status,
      addedAt: new Date().toISOString(),
      notes: null,
      book: body.book ?? null,
    };
    shelf = [entry, ...shelf];
    return HttpResponse.json(entry, { status: 201 });
  }),

  // PATCH /v1/shelf/:isbn
  http.patch("/v1/shelf/:isbn", async ({ params, request }) => {
    const { isbn } = params as { isbn: string };
    const body = (await request.json()) as { status: ShelfStatus };
    const idx = shelf.findIndex((e) => e.isbn === isbn);

    if (idx === -1) {
      return HttpResponse.json({ error: "Book not found on your shelf" }, { status: 404 });
    }

    shelf = shelf.map((e, i) => (i === idx ? { ...e, status: body.status } : e));
    return HttpResponse.json(shelf[idx]);
  }),

  // DELETE /v1/shelf/:isbn
  http.delete("/v1/shelf/:isbn", ({ params }) => {
    const { isbn } = params as { isbn: string };
    const exists = shelf.some((e) => e.isbn === isbn);

    if (!exists) {
      return HttpResponse.json({ error: "Book not found on your shelf" }, { status: 404 });
    }

    shelf = shelf.filter((e) => e.isbn !== isbn);
    return new HttpResponse(null, { status: 204 });
  }),

  // GET /v1/books/search
  http.get("/v1/books/search", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
    const results = MOCK_SHELF.filter(
      (e) =>
        e.book?.title.toLowerCase().includes(q) ||
        e.book?.authors.some((a) => a.toLowerCase().includes(q)),
    ).map((e) => ({ isbn: e.isbn, ...e.book }));

    return HttpResponse.json({ results });
  }),

  // GET /v1/books/isbn/:isbn
  http.get("/v1/books/isbn/:isbn", ({ params }) => {
    const { isbn } = params as { isbn: string };
    const found = MOCK_SHELF.find((e) => e.isbn === isbn);

    if (!found?.book) {
      return HttpResponse.json({ error: "Book not found" }, { status: 404 });
    }

    return HttpResponse.json({ isbn, ...found.book });
  }),
];
