import { Hono } from "hono";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { authMiddleware } from "../middleware/auth.js";
import {
  queryAllShelvesWithBookIds,
  queryShelvesMeta,
  getShelfMetaItem,
  putShelfMeta,
  updateShelfMetaName,
  updateShelfSortOrder,
  deleteShelfAndMembers,
  putShelfMember,
  deleteShelfMember,
  queryShelfMemberIsns,
  batchGetBookEntries,
  getBookEntry,
  type ShelfWithBookIds,
} from "../lib/dynamo.js";
import { parseJsonBody } from "./_utils.js";

export const shelvesRouter = new Hono();

shelvesRouter.use("*", authMiddleware);

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

  const trimmedName = name.trim();

  const existing = await queryShelvesMeta(userId);
  if (existing.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())) {
    return c.json({ error: "A shelf with this name already exists" }, 409);
  }

  const shelfId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const sortOrder = Date.now();

  try {
    await putShelfMeta(userId, shelfId, trimmedName, createdAt, sortOrder);
  } catch (err) {
    console.error("Shelf create error:", err);
    return c.json({ error: "Failed to create shelf" }, 500);
  }

  const shelf: ShelfWithBookIds = { shelfId, name: trimmedName, createdAt, bookIds: [] };
  return c.json(shelf, 201);
});

// POST /v1/shelves/reorder — accepts { order: string[] } (shelfIds in desired order)
// Registered before /:shelfId so the literal path segment wins.
shelvesRouter.post("/reorder", async (c) => {
  const { userId } = c.get("auth");

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;

  const order = (bodyOrErr as Record<string, unknown>)?.["order"];
  if (
    !Array.isArray(order) ||
    order.length === 0 ||
    !order.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return c.json({ error: "order must be a non-empty array of shelf ID strings" }, 400);
  }

  try {
    await Promise.all(
      (order as string[]).map((shelfId, i) => updateShelfSortOrder(userId, shelfId, i)),
    );
    return c.body(null, 204);
  } catch (err) {
    console.error("Shelf reorder error:", err);
    return c.json({ error: "Failed to reorder shelves" }, 500);
  }
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

  const trimmedName = name.trim();

  const allShelves = await queryShelvesMeta(userId);
  if (
    allShelves.some(
      (s) => s.shelfId !== shelfId && s.name.toLowerCase() === trimmedName.toLowerCase(),
    )
  ) {
    return c.json({ error: "A shelf with this name already exists" }, 409);
  }

  try {
    await updateShelfMetaName(userId, shelfId, trimmedName);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return c.json({ error: "Shelf not found" }, 404);
    }
    console.error("Shelf rename error:", err);
    return c.json({ error: "Failed to rename shelf" }, 500);
  }

  const [updated, bookIds] = await Promise.all([
    getShelfMetaItem(userId, shelfId),
    queryShelfMemberIsns(userId, shelfId),
  ]);
  if (!updated) return c.json({ error: "Shelf not found" }, 404);
  return c.json({ ...updated, bookIds });
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

  const [shelf, entry] = await Promise.all([
    getShelfMetaItem(userId, shelfId),
    getBookEntry(userId, isbn),
  ]);
  if (!shelf) {
    return c.json({ error: "Shelf not found" }, 404);
  }
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
