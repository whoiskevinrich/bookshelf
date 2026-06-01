/**
 * Local development entrypoint. Starts a plain Node HTTP server on port 3001.
 * Not used in production — the Lambda handler in index.ts is used there.
 *
 * Usage: pnpm --filter @bookshelf/api run dev
 */
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = 3001;
const corsOrigin = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running at http://localhost:${PORT} (CORS → ${corsOrigin})`);
});
