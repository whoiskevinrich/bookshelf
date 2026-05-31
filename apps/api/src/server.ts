/**
 * Local development entrypoint. Starts a plain Node HTTP server on port 3001.
 * Not used in production — the Lambda handler in index.ts is used there.
 *
 * Usage: pnpm --filter @bookshelf/api run dev
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { booksRouter } from "./routes/books.js";
import { shelfRouter } from "./routes/shelf.js";

const app = new Hono();

// Allow requests from the local Vite dev server
app.use(
  "*",
  cors({
    origin: "http://localhost:3000",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/v1/books", booksRouter);
app.route("/v1/shelf", shelfRouter);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

const PORT = 3001;

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running at http://localhost:${PORT}`);
});
