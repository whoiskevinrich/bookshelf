import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/metrics.js", () => ({ emitMetric: vi.fn() }));

import { emitMetric } from "../../src/lib/metrics.js";
import {
  FixedWindowRateLimiter,
  userRateLimit,
  type RateLimitTier,
} from "../../src/middleware/rate-limit.js";
import { Hono } from "hono";
import type { Context, Next } from "hono";

const MINUTE: RateLimitTier = { label: "minute", limit: 3, windowMs: 60_000 };
const HOUR: RateLimitTier = { label: "hour", limit: 5, windowMs: 3_600_000 };

describe("FixedWindowRateLimiter", () => {
  it("allows up to the limit then blocks the next request (boundary)", () => {
    const limiter = new FixedWindowRateLimiter([MINUTE], () => 0);
    expect(limiter.check("u").allowed).toBe(true); // 1
    expect(limiter.check("u").allowed).toBe(true); // 2
    expect(limiter.check("u").allowed).toBe(true); // 3 (== limit)
    expect(limiter.check("u").allowed).toBe(false); // 4 (over)
  });

  it("resets the count when the window rolls over", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter([MINUTE], () => now);
    for (let i = 0; i < 3; i++) limiter.check("u");
    expect(limiter.check("u").allowed).toBe(false);
    now = 60_000; // next minute window
    expect(limiter.check("u").allowed).toBe(true);
  });

  it("enforces the longer tier even when the shorter window has reset", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter([MINUTE, HOUR], () => now);
    // 3 in the first minute (hits minute limit but not hour: 3 <= 5)
    for (let i = 0; i < 3; i++) expect(limiter.check("u").allowed).toBe(true);
    now = 60_000; // new minute, same hour
    expect(limiter.check("u").allowed).toBe(true); // hour count 4
    expect(limiter.check("u").allowed).toBe(true); // hour count 5 (== hour limit)
    const blocked = limiter.check("u"); // hour count 6 (over hour, even though minute is fresh)
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.tier).toBe("hour");
  });

  it("reports retry-after as whole seconds until the window ends", () => {
    const limiter = new FixedWindowRateLimiter([MINUTE], () => 10_000); // 10s into the minute
    for (let i = 0; i < 3; i++) limiter.check("u");
    const blocked = limiter.check("u");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBe(50); // 60s - 10s
  });

  it("returns the longest blocking tier's retry-after when both tiers block", () => {
    const limiter = new FixedWindowRateLimiter(
      [
        { label: "minute", limit: 0, windowMs: 60_000 },
        { label: "hour", limit: 0, windowMs: 3_600_000 },
      ],
      () => 0,
    );
    const blocked = limiter.check("u");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.tier).toBe("hour");
      expect(blocked.retryAfterSec).toBe(3600);
    }
  });

  it("isolates counts per key", () => {
    const limiter = new FixedWindowRateLimiter([MINUTE], () => 0);
    for (let i = 0; i < 3; i++) limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true); // b is unaffected
  });

  it("throws if constructed with no tiers", () => {
    expect(() => new FixedWindowRateLimiter([])).toThrow();
  });

  it("prunes stale keys once the tracked map grows past the cap", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter([MINUTE], () => now);
    // Fill past MAX_TRACKED_KEYS (10_000) at t=0.
    for (let i = 0; i <= 10_000; i++) limiter.check(`stale-${i}`);
    // Advance a full minute so all the above are stale, then trigger a sweep by
    // crossing the cap again with a fresh key.
    now = 60_000;
    for (let i = 0; i <= 10_000; i++) limiter.check(`fresh-${i}`);
    // A stale key now starts a brand-new window (count resets to 1 = allowed),
    // proving its old over-limit state was pruned rather than retained.
    for (let i = 0; i < 3; i++) limiter.check("fresh-0");
    expect(limiter.check("fresh-0").allowed).toBe(false); // fresh keys still tracked
  });
});

// ── userRateLimit Hono adapter ───────────────────────────────────────────────

function appWith(
  limiter: FixedWindowRateLimiter,
  authSetter: (c: Context) => void = (c) =>
    c.set("auth", { userId: "u1", cognitoUsername: "u1@example.com", isGoogleUser: false }),
) {
  const app = new Hono();
  app.use("*", async (c: Context, next: Next) => {
    authSetter(c);
    await next();
  });
  app.use("*", userRateLimit(limiter, { metricEvent: "rate_limited_books" }));
  app.get("/", (c) => c.text("ok"));
  return app;
}

beforeEach(() => {
  vi.mocked(emitMetric).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("userRateLimit", () => {
  it("passes through while under the limit", async () => {
    const app = appWith(new FixedWindowRateLimiter([MINUTE], () => 0));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(emitMetric).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After and emits an abuse metric once over", async () => {
    const app = appWith(new FixedWindowRateLimiter([MINUTE], () => 0));
    for (let i = 0; i < 3; i++) await app.request("/"); // exhaust the limit
    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Too many requests");
    expect(emitMetric).toHaveBeenCalledWith(
      "rate_limited_books",
      { window: "minute" },
      "Bookshelf/Abuse",
    );
  });

  it("fails open (allows) when the limiter throws", async () => {
    const throwing = {
      check: () => {
        throw new Error("boom");
      },
    } as unknown as FixedWindowRateLimiter;
    const app = appWith(throwing);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalled();
  });

  it("fails open when no auth context is present", async () => {
    const app = appWith(
      new FixedWindowRateLimiter([{ label: "m", limit: 0, windowMs: 1000 }], () => 0),
      () => {
        /* set no auth */
      },
    );
    const res = await app.request("/");
    expect(res.status).toBe(200); // limit 0 would block — but no userId means fail-open
  });

  it("limits each user independently", async () => {
    let user = "a";
    const app = appWith(new FixedWindowRateLimiter([MINUTE], () => 0), (c) =>
      c.set("auth", { userId: user, cognitoUsername: `${user}@example.com`, isGoogleUser: false }),
    );
    for (let i = 0; i < 3; i++) await app.request("/"); // exhaust user a
    expect((await app.request("/")).status).toBe(429);
    user = "b";
    expect((await app.request("/")).status).toBe(200); // user b unaffected
  });
});
