import { Hono } from "hono";
import { searchBooks, getBookByIsbn, getBookByAsin } from "../lib/books/search.js";
import { isValidIsbn, normalizeIsbn } from "../lib/isbn.js";
import { authMiddleware } from "../middleware/auth.js";
import { FixedWindowRateLimiter, userRateLimit } from "../middleware/rate-limit.js";

export const booksRouter = new Hono();

// Per-user rate limit on the book routes — these proxy Google Books, whose daily
// quota is shared across all users, so one user must not be able to drain it
// (ADR-018). Limits are set well above any human cataloguing workflow. Held at
// module scope so the counter survives across warm Lambda invocations.
const BOOKS_PER_MINUTE = 30;
const BOOKS_PER_HOUR = 300;
const booksLimiter = new FixedWindowRateLimiter([
  { label: "minute", limit: BOOKS_PER_MINUTE, windowMs: 60_000 },
  { label: "hour", limit: BOOKS_PER_HOUR, windowMs: 3_600_000 },
]);

// Order matters: auth first (sets userId), then the per-user limit reads it.
booksRouter.use("*", authMiddleware);
booksRouter.use("*", userRateLimit(booksLimiter, { metricEvent: "rate_limited_books" }));

const SEARCH_MAX_LENGTH = 200;
// Real ASINs are 10 alphanumeric chars; ceiling raised to 20 so callers can
// also pass ISBN-13 (13 chars) to this endpoint — the provider tries an ISBN
// lookup first before falling back to a keyword search.
const ASIN_PATTERN = /^[A-Za-z0-9]{1,20}$/;

booksRouter.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.trim().length === 0) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }
  if (q.trim().length > SEARCH_MAX_LENGTH) {
    return c.json({ error: `Query must be ${SEARCH_MAX_LENGTH} characters or fewer` }, 400);
  }

  try {
    const results = await searchBooks(q.trim());
    return c.json({ results });
  } catch (err) {
    console.error("Book search error:", err);
    return c.json({ error: "Book search failed" }, 502);
  }
});

booksRouter.get("/isbn/:isbn", async (c) => {
  const raw = c.req.param("isbn");
  if (!isValidIsbn(raw)) {
    return c.json({ error: "Invalid ISBN format" }, 400);
  }
  const isbn = normalizeIsbn(raw);
  try {
    const book = await getBookByIsbn(isbn);
    if (!book) return c.json({ error: "Book not found" }, 404);
    return c.json(book);
  } catch (err) {
    console.error("ISBN lookup error:", err);
    return c.json({ error: "Book lookup failed" }, 502);
  }
});

booksRouter.get("/asin/:asin", async (c) => {
  const raw = c.req.param("asin").trim();
  if (!ASIN_PATTERN.test(raw)) {
    return c.json({ error: "Invalid ASIN format" }, 400);
  }
  try {
    const book = await getBookByAsin(raw);
    if (!book) return c.json({ error: "Book not found" }, 404);
    return c.json(book);
  } catch (err) {
    console.error("ASIN lookup error:", err);
    return c.json({ error: "Book lookup failed" }, 502);
  }
});
