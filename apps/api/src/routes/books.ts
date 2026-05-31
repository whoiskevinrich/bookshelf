import { Hono } from "hono";
import { searchBooks, getBookByIsbn, getBookByAsin } from "../lib/books/search.js";

export const booksRouter = new Hono();

booksRouter.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.trim().length === 0) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
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
  const { isbn } = c.req.param();
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
  const { asin } = c.req.param();
  try {
    const book = await getBookByAsin(asin.trim());
    if (!book) return c.json({ error: "Book not found" }, 404);
    return c.json(book);
  } catch (err) {
    console.error("ASIN lookup error:", err);
    return c.json({ error: "Book lookup failed" }, 502);
  }
});
