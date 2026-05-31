import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { booksRouter } from "./routes/books.js";
import { shelfRouter } from "./routes/shelf.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/v1/books", booksRouter);
app.route("/v1/shelf", shelfRouter);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export const handler = handle(app);
