import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { parseJsonBody } from "./_utils.js";
import { emitMetric } from "../lib/metrics.js";

/**
 * Client analytics sink. A single authenticated `POST /v1/events` that records
 * a named client event as a CloudWatch metric (ADR-016). Generic on purpose —
 * any feature can call it — but the event `name` is allowlisted so a client
 * can't mint unbounded CloudWatch metrics. No user identifier is recorded
 * (privacy + metric cardinality): the metric is a pure count.
 */
export const eventsRouter = new Hono();

eventsRouter.use("*", authMiddleware);

/** Known client event names. Add new events here before the client emits them. */
const ALLOWED_EVENTS = new Set<string>(["hint_shown", "hint_link_clicked", "hint_dismissed"]);

// Props are accepted for forward-compatibility but only validated/bounded, not
// recorded as metric dimensions (that would create unbounded metrics).
const PROPS_MAX_KEYS = 8;
const PROP_VALUE_MAX_LENGTH = 200;

function isValidProps(props: unknown): boolean {
  if (props === undefined) return true;
  if (typeof props !== "object" || props === null || Array.isArray(props)) return false;
  const entries = Object.entries(props as Record<string, unknown>);
  if (entries.length > PROPS_MAX_KEYS) return false;
  return entries.every(([, v]) => {
    if (typeof v === "number" || typeof v === "boolean") return true;
    return typeof v === "string" && v.length <= PROP_VALUE_MAX_LENGTH;
  });
}

// POST /v1/events
eventsRouter.post("/", async (c) => {
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }

  const { name, props } = body as { name?: unknown; props?: unknown };

  if (typeof name !== "string" || !ALLOWED_EVENTS.has(name)) {
    return c.json({ error: "Unknown event name" }, 400);
  }
  if (!isValidProps(props)) {
    return c.json({ error: "Invalid event props" }, 400);
  }

  emitMetric(name, props as Record<string, string | number | boolean> | undefined);
  return c.body(null, 204);
});
