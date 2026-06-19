import type { Context, MiddlewareHandler, Next } from "hono";
import { emitMetric } from "../lib/metrics.js";

/**
 * App-level per-user rate limiting (ADR-018, free-layer baseline).
 *
 * The WAF the backlog imagined can't attach to this API (it's an HTTP API v2),
 * and a per-IP edge rule wouldn't help anyway: the browser reaches us through
 * CloudFront, so every request shares CloudFront's IP, and single-user
 * quota-drain is a *per-user* problem. So the real fairness control lives here,
 * keyed on the authenticated `userId`. Because it runs in-Lambda it is
 * path-independent — it covers the raw `execute-api` URL and the `api.` MCP
 * domain that bypass CloudFront, not just the browser path.
 *
 * State is an in-memory fixed-window counter held at module scope by the caller,
 * so it survives across warm invocations. This is intentionally approximate:
 * under high concurrency each warm container keeps its own counter, so the
 * effective limit scales with container count. That's acceptable at this app's
 * scale (concurrency is capped at 10, usually 1 warm container handles a user's
 * burst); a strict global counter (DynamoDB-atomic) is the documented upgrade.
 */

/** Namespace for abuse/limit metrics — kept separate from `Bookshelf/WebEvents`. */
const ABUSE_NAMESPACE = "Bookshelf/Abuse";

/** Guard against unbounded memory: prune stale users once the map crosses this. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitTier {
  /** Human label, surfaced in the metric and used to explain Retry-After. */
  label: string;
  /** Max requests permitted within the window. */
  limit: number;
  /** Fixed-window size in milliseconds. */
  windowMs: number;
}

interface WindowState {
  /** Window id (floor(now / windowMs)) this count belongs to. */
  windowId: number;
  count: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number; tier: string };

/**
 * Pure fixed-window limiter over one or more tiers (e.g. per-minute AND
 * per-hour). No Hono/clock coupling — `now` is injectable so tests are
 * deterministic. A request is blocked if *any* tier is over its limit; the
 * returned `retryAfterSec`/`tier` describe the longest-windowed tier that
 * blocked, so a well-behaved client waits long enough to clear all of them.
 */
export class FixedWindowRateLimiter {
  private readonly tiers: RateLimitTier[];
  private readonly now: () => number;
  // key -> tier.label -> WindowState
  private readonly state = new Map<string, Map<string, WindowState>>();

  constructor(tiers: RateLimitTier[], now: () => number = Date.now) {
    if (tiers.length === 0) throw new Error("FixedWindowRateLimiter needs at least one tier");
    this.tiers = tiers;
    this.now = now;
  }

  /** Record one hit for `key` and return whether it is allowed. */
  check(key: string): RateLimitDecision {
    const t = this.now();
    let perTier = this.state.get(key);
    if (!perTier) {
      perTier = new Map();
      this.state.set(key, perTier);
    }

    let blocked: { retryAfterSec: number; tier: string } | undefined;

    for (const tier of this.tiers) {
      const windowId = Math.floor(t / tier.windowMs);
      const cur = perTier.get(tier.label);
      const next: WindowState =
        cur && cur.windowId === windowId
          ? { windowId, count: cur.count + 1 }
          : { windowId, count: 1 };
      perTier.set(tier.label, next);

      if (next.count > tier.limit) {
        const windowEndMs = (windowId + 1) * tier.windowMs;
        const retryAfterSec = Math.max(1, Math.ceil((windowEndMs - t) / 1000));
        // Keep the longest window that blocked — waiting that long clears all.
        if (!blocked || retryAfterSec > blocked.retryAfterSec) {
          blocked = { retryAfterSec, tier: tier.label };
        }
      }
    }

    // Prune stale keys *after* recording this one, so the active key is never
    // swept out from under itself. We may briefly exceed the cap before pruning;
    // that's fine.
    if (this.state.size > MAX_TRACKED_KEYS) this.sweep(t);

    return blocked ? { allowed: false, ...blocked } : { allowed: true };
  }

  /** Drop keys whose every tier window has rolled past — bounds memory growth. */
  private sweep(t: number): void {
    // Hoist the current window id per tier once, rather than recomputing it for
    // every tracked key (the sweep is O(keys); keep the per-key work O(tiers)).
    const currentWindowId = new Map(
      this.tiers.map((tier) => [tier.label, Math.floor(t / tier.windowMs)]),
    );
    for (const [key, perTier] of this.state) {
      let live = false;
      for (const [label, s] of perTier) {
        if (s.windowId === currentWindowId.get(label)) {
          live = true;
          break;
        }
      }
      if (!live) this.state.delete(key);
    }
  }
}

/**
 * Hono adapter: enforces `limiter` keyed on the authenticated `userId`. Must be
 * mounted AFTER `authMiddleware` (it reads `c.get("auth")`). On a block it emits
 * a `Bookshelf/Abuse` metric (no userId — cardinality + privacy, per ADR-016)
 * and returns 429 with a `Retry-After` header and a generic body.
 *
 * Fail-open by design: any internal error (or a missing auth context) allows the
 * request through. A counter bug must never become a denial of service for
 * legitimate users.
 */
export function userRateLimit(
  limiter: FixedWindowRateLimiter,
  opts: { metricEvent: string },
): MiddlewareHandler {
  return async (c: Context, next: Next): Promise<Response | void> => {
    try {
      const userId = c.get("auth")?.userId;
      if (!userId) return next(); // auth runs first; defensive fail-open

      const decision = limiter.check(userId);
      if (decision.allowed) return next();

      emitMetric(opts.metricEvent, { window: decision.tier }, ABUSE_NAMESPACE);
      c.header("Retry-After", String(decision.retryAfterSec));
      return c.json({ error: "Too many requests" }, 429);
    } catch (err) {
      console.error("rate-limit middleware error (failing open):", err);
      return next();
    }
  };
}
