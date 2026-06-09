import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "../.env.local"), override: true });

import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

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
