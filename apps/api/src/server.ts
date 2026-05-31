/**
 * Local development entrypoint. Starts a plain Node HTTP server on port 3001.
 * Not used in production — the Lambda handler in index.ts is used there.
 *
 * Usage: pnpm --filter @bookshelf/api run dev
 */
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { app } from "./app.js";

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

const PORT = 3001;

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running at http://localhost:${PORT} (CORS → ${corsOrigin})`);
});
