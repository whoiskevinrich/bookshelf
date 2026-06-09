import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { booksRouter } from "./routes/books.js";
import { shelfRouter } from "./routes/shelf.js";
import { shelvesRouter } from "./routes/shelves.js";
import { usersRouter } from "./routes/users.js";

/**
 * Shared Hono app instance — used by both the Lambda handler (index.ts)
 * and the local dev server (server.ts).
 */
export const app = new Hono();

// CORS must be registered before routes so it applies to all responses,
// including error responses (4xx/5xx). Origin is set per-environment.
const corsOrigin = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";
app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

// Reject oversized request bodies before they reach route handlers.
// 64 KB is far above any legitimate payload in this API.
app.use(
  "*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => {
      console.error("Request body exceeded 64 KB limit");
      return c.json({ error: "Request body too large" }, 413);
    },
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/v1/books", booksRouter);
app.route("/v1/shelf", shelfRouter);
app.route("/v1/shelves", shelvesRouter);
app.route("/v1/users", usersRouter);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});
