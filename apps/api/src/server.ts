/**
 * Local development entrypoint. Starts a plain Node HTTP server on port 3001.
 * Not used in production — the Lambda handler in index.ts is used there.
 *
 * Usage: pnpm --filter @bookshelf/api run dev
 *
 * Loads .env.local using an absolute path derived from this file's location so
 * it works regardless of the CWD when the process is launched.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// NOTE: dotenv.config() runs after ESM imports are hoisted, but the DynamoDB
// client in dynamo.ts is lazily initialized (on first request), so env vars
// are available by the time any DynamoDB call is made.
config({ path: join(__dirname, "../.env.local"), override: true });

import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = 3001;
const corsOrigin = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";

const server = serve({ fetch: app.fetch, port: PORT });

server.on("listening", () => {
  const addr = server.address() as AddressInfo;
  console.log(`API running at http://localhost:${addr.port} (CORS → ${corsOrigin})`);
});

// tsx watch (and node --watch) on Windows may kill the previous process before
// the OS releases the TCP port. Retry for up to 5 seconds.
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} in use — retrying in 500ms...`);
    server.close(() => {
      setTimeout(() => server.listen(PORT), 500);
    });
  } else {
    console.error("Fatal server error:", err);
    process.exit(1);
  }
});

process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
