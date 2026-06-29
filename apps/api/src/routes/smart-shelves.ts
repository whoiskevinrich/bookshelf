import { Hono } from "hono";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { authMiddleware } from "../middleware/auth.js";
import {
  querySmartShelves,
  querySmartShelvesWithCounts,
  getSmartShelf,
  putSmartShelf,
  updateSmartShelfName,
  deleteSmartShelf,
  isValidReadingStatus,
  normalizeTag,
  type SmartShelfRule,
} from "../lib/dynamo.js";
import { parseJsonBody } from "./_utils.js";

export const smartShelvesRouter = new Hono();

smartShelvesRouter.use("*", authMiddleware);

const NAME_MAX_LENGTH = 100;
const TAG_MAX_LENGTH = 50;
const MAX_SMART_SHELVES = 50;

// IDs are server-generated UUIDs; reject anything else before it reaches a key.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateName(name: unknown): name is string {
  return (
    typeof name === "string" && name.trim().length > 0 && name.trim().length <= NAME_MAX_LENGTH
  );
}

/** Parse + validate a rule body into a SmartShelfRule, or return an error message. */
function parseRule(raw: unknown): SmartShelfRule | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "rule must be an object" };
  }
  const r = raw as Record<string, unknown>;
  const rule: SmartShelfRule = {};

  if (r["owned"] !== undefined) {
    if (typeof r["owned"] !== "boolean") return { error: "rule.owned must be a boolean" };
    rule.owned = r["owned"];
  }
  if (r["want"] !== undefined) {
    if (typeof r["want"] !== "boolean") return { error: "rule.want must be a boolean" };
    rule.want = r["want"];
  }
  if (r["readingStatus"] !== undefined) {
    if (!isValidReadingStatus(r["readingStatus"])) {
      return { error: "rule.readingStatus must be 'unread', 'reading', or 'finished'" };
    }
    rule.readingStatus = r["readingStatus"];
  }
  if (r["tag"] !== undefined) {
    if (typeof r["tag"] !== "string") return { error: "rule.tag must be a string" };
    const tag = normalizeTag(r["tag"]);
    if (tag.length === 0 || tag.length > TAG_MAX_LENGTH) {
      return { error: "rule.tag must be 1–50 characters" };
    }
    rule.tag = tag;
  }

  if (
    rule.owned === undefined &&
    rule.want === undefined &&
    rule.readingStatus === undefined &&
    rule.tag === undefined
  ) {
    return { error: "rule must include at least one facet (owned, want, readingStatus, or tag)" };
  }
  if (rule.owned === true && rule.want === true) {
    return { error: "owned and want cannot both be true" };
  }
  return rule;
}

// GET /v1/smart-shelves — saved rules with live match counts
smartShelvesRouter.get("/", async (c) => {
  const { userId } = c.get("auth");
  try {
    const shelves = await querySmartShelvesWithCounts(userId);
    return c.json(shelves);
  } catch (err) {
    console.error("Smart shelves list error:", err);
    return c.json({ error: "Failed to fetch smart shelves" }, 500);
  }
});

// POST /v1/smart-shelves — { name, rule }
smartShelvesRouter.post("/", async (c) => {
  const { userId } = c.get("auth");

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = (bodyOrErr ?? {}) as Record<string, unknown>;

  if (!validateName(body["name"])) {
    return c.json({ error: "name must be a non-empty string (max 100 chars)" }, 400);
  }
  const ruleOrErr = parseRule(body["rule"]);
  if ("error" in ruleOrErr) {
    return c.json({ error: ruleOrErr.error }, 400);
  }

  let existing;
  try {
    existing = await querySmartShelves(userId);
  } catch (err) {
    console.error("Smart shelf list error:", err);
    return c.json({ error: "Failed to create smart shelf" }, 500);
  }
  if (existing.length >= MAX_SMART_SHELVES) {
    return c.json({ error: `You can have at most ${MAX_SMART_SHELVES} smart shelves` }, 409);
  }

  const smartShelfId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await putSmartShelf(userId, smartShelfId, body["name"].trim(), ruleOrErr, createdAt);
  } catch (err) {
    console.error("Smart shelf create error:", err);
    return c.json({ error: "Failed to create smart shelf" }, 500);
  }

  return c.json({ smartShelfId, name: body["name"].trim(), rule: ruleOrErr, createdAt }, 201);
});

// PATCH /v1/smart-shelves/:id — rename
smartShelvesRouter.patch("/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid smart shelf id" }, 400);
  }

  const bodyOrErr = await parseJsonBody(c);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const name = (bodyOrErr as Record<string, unknown>)?.["name"];
  if (!validateName(name)) {
    return c.json({ error: "name must be a non-empty string (max 100 chars)" }, 400);
  }

  try {
    await updateSmartShelfName(userId, id, name.trim());
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return c.json({ error: "Smart shelf not found" }, 404);
    }
    console.error("Smart shelf rename error:", err);
    return c.json({ error: "Failed to rename smart shelf" }, 500);
  }

  return c.body(null, 204);
});

// DELETE /v1/smart-shelves/:id
smartShelvesRouter.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid smart shelf id" }, 400);
  }

  try {
    const existing = await getSmartShelf(userId, id);
    if (!existing) {
      return c.json({ error: "Smart shelf not found" }, 404);
    }
    await deleteSmartShelf(userId, id);
  } catch (err) {
    console.error("Smart shelf delete error:", err);
    return c.json({ error: "Failed to delete smart shelf" }, 500);
  }

  return c.body(null, 204);
});
