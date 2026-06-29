import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { queryDistinctTags } from "../lib/dynamo.js";

export const tagsRouter = new Hono();

tagsRouter.use("*", authMiddleware);

// GET /v1/tags — the user's distinct tags with usage counts (ADR-019 R2.4).
// Powers tag autocomplete (anti-duplication) and the Phase 3 browse panel.
tagsRouter.get("/", async (c) => {
  const { userId } = c.get("auth");
  try {
    const tags = await queryDistinctTags(userId);
    return c.json({ tags });
  } catch (err) {
    console.error("Tags list error:", err);
    return c.json({ error: "Failed to fetch tags" }, 500);
  }
});
