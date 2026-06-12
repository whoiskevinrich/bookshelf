import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "../.env.local"), override: true });

// Import app AFTER dotenv runs. app.ts validates required env vars at module load
// (requireEnv); a static `import` is hoisted above the config() call, so it would
// evaluate app.ts before .env.local is loaded and throw "API_BASE_URL is not set".
// A dynamic import defers evaluation until process.env is populated.
const { app } = await import("./app.js");

const PORT = 3002;

const server = serve({ fetch: app.fetch, port: PORT });

server.on("listening", () => {
  const addr = server.address() as AddressInfo;
  console.log(`MCP server running at http://localhost:${addr.port}`);
});

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
  (server as unknown as import("node:http").Server).closeAllConnections();
  server.close(() => process.exit(0));
});
