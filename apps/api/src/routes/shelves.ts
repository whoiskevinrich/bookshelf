import { Hono } from "hono";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { authMiddleware } from "../middleware/auth.js";
import {
  queryAllShelvesWithBookIds,
  getShelfMetaItem,
  putShelfMeta,
  updateShelfMetaName,
  deleteShelfAndMembers,
  putShelfMember,
  deleteShelfMember,
  queryShelfMemberIsns,
  batchGetBookEntries,
  getBookEntry,
  type ShelfWithBookIds,
} from "../lib/dynamo.js";
import type { Context } from "hono";

export const shelvesRouter = new Hono();

shelvesRouter.use("*", authMiddleware);

async function parseJsonBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400) as Response;
  }
}

function validateShelfName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100;
}

// GET /v1/shelves
shelvesRouter.get("/", async (c) => {
  const { userId } = c.get("auth");
  try {
    const shelves = await queryAllShelvesWithBookIds(userId);
    return c.json(shelves);
  } catch (err) {
    console.error("Shelves list error:", err);
    return c.json({ error: "Failed to fetch shelves" }, 500);
  }
});

// POST /v1/shelves
shelvesRouter.post("/", async (c) => {
  const { userId } = c.get("auth");

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;

  const name = (bodyOrErr as Record<string, unknown>)?.["name"];
  if (!validateShelfName(name)) {
    return c.json({ error: "name must be a non-empty string (max 100 chars)" }, 400);
  }

  const shelfId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await putShelfMeta(userId, shelfId, name.trim(), createdAt);
  } catch (err) {
    console.error("Shelf create error:", err);
    return c.json({ error: "Failed to create shelf" }, 500);
  }

  const shelf: ShelfWithBookIds = { shelfId, name: name.trim(), createdAt, bookIds: [] };
  return c.json(shelf, 201);
});

// PATCH /v1/shelves/:shelfId
shelvesRouter.patch("/:shelfId", async (c) => {
  const { userId } = c.get("auth");
  const shelfId = c.req.param("shelfId");

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;

  const name = (bodyOrErr as Record<string, unknown>)?.["name"];
  if (!validateShelfName(name)) {
    return c.json({ error: "name must be a non-empty string (max 100 chars)" }, 400);
  }

  try {
    await updateShelfMetaName(userId, shelfId, name.trim());
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return c.json({ error: "Shelf not found" }, 404);
    }
    console.error("Shelf rename error:", err);
    return c.json({ error: "Failed to rename shelf" }, 500);
  }

  const existing = await getShelfMetaItem(userId, shelfId);
  if (!existing) return c.json({ error: "Shelf not found" }, 404);

  const bookIds = await queryShelfMemberIsns(userId, shelfId);
  return c.json({ ...existing, bookIds });
});

// DELETE /v1/shelves/:shelfId
shelvesRouter.delete("/:shelfId", async (c) => {
  const { userId } = c.get("auth");
  const shelfId = c.req.param("shelfId");

  const existing = await getShelfMetaItem(userId, shelfId);
  if (!existing) {
    return c.json({ error: "Shelf not found" }, 404);
  }

  try {
    await deleteShelfAndMembers(userId, shelfId);
  } catch (err) {
    console.error("Shelf delete error:", err);
    return c.json({ error: "Failed to delete shelf" }, 500);
  }

  return c.body(null, 204);
});

// POST /v1/shelves/:shelfId/books/:isbn
shelvesRouter.post("/:shelfId/books/:isbn", async (c) => {
  const { userId } = c.get("auth");
  const shelfId = c.req.param("shelfId");
  const isbn = c.req.param("isbn");

  const shelf = await getShelfMetaItem(userId, shelfId);
  if (!shelf) {
    return c.json({ error: "Shelf not found" }, 404);
  }

  const entry = await getBookEntry(userId, isbn);
  if (!entry) {
    return c.json({ error: "Book not found on your shelf" }, 404);
  }

  try {
    await putShelfMember(userId, shelfId, isbn);
  } catch (err) {
    console.error("Shelf member add error:", err);
    return c.json({ error: "Failed to add book to shelf" }, 500);
  }

  return c.body(null, 204);
});

// DELETE /v1/shelves/:shelfId/books/:isbn
shelvesRouter.delete("/:shelfId/books/:isbn", async (c) => {
  const { userId } = c.get("auth");
  const shelfId = c.req.param("shelfId");
  const isbn = c.req.param("isbn");

  try {
    await deleteShelfMember(userId, shelfId, isbn);
  } catch (err) {
    console.error("Shelf member remove error:", err);
    return c.json({ error: "Failed to remove book from shelf" }, 500);
  }

  return c.body(null, 204);
});

// GET /v1/shelves/:shelfId/books — returns full entries with book metadata
shelvesRouter.get("/:shelfId/books", async (c) => {
  const { userId } = c.get("auth");
  const shelfId = c.req.param("shelfId");

  const shelf = await getShelfMetaItem(userId, shelfId);
  if (!shelf) {
    return c.json({ error: "Shelf not found" }, 404);
  }

  try {
    const bookIds = await queryShelfMemberIsns(userId, shelfId);
    if (bookIds.length === 0) return c.json([]);
    const entries = await batchGetBookEntries(userId, bookIds);
    return c.json(entries);
  } catch (err) {
    console.error("Shelf books fetch error:", err);
    return c.json({ error: "Failed to fetch shelf books" }, 500);
  }
});
