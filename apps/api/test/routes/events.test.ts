import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: import("hono").Context, next: import("hono").Next) => {
    c.set("auth", { userId: "test-user-sub", cognitoUsername: "test@example.com" });
    await next();
  }),
}));

vi.mock("../../src/lib/metrics.js", () => ({
  emitMetric: vi.fn(),
}));

import { emitMetric } from "../../src/lib/metrics.js";
import { eventsRouter } from "../../src/routes/events.js";
import { Hono } from "hono";

function makeApp() {
  const app = new Hono();
  app.route("/v1/events", eventsRouter);
  return app;
}

function post(body: unknown, raw = false) {
  return makeApp().request("/v1/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(emitMetric).mockReset();
});

describe("POST /v1/events", () => {
  it("records an allowlisted event and returns 204", async () => {
    const res = await post({ name: "hint_shown" });
    expect(res.status).toBe(204);
    expect(emitMetric).toHaveBeenCalledWith("hint_shown", undefined);
  });

  it("accepts valid props and forwards them to the metric", async () => {
    const res = await post({ name: "hint_link_clicked", props: { page: "shelf" } });
    expect(res.status).toBe(204);
    expect(emitMetric).toHaveBeenCalledWith("hint_link_clicked", { page: "shelf" });
  });

  it("accepts props at the boundaries: 8 keys, 200-char string, number and boolean", async () => {
    const props: Record<string, string | number | boolean> = {
      s: "x".repeat(200),
      n: 42,
      b: true,
    };
    for (let i = 0; i < 5; i++) props[`k${i}`] = i; // total 8 keys
    const res = await post({ name: "hint_shown", props });
    expect(res.status).toBe(204);
    expect(emitMetric).toHaveBeenCalledWith("hint_shown", props);
  });

  it("rejects props: null and props: [] with 400", async () => {
    expect((await post({ name: "hint_shown", props: null })).status).toBe(400);
    expect((await post({ name: "hint_shown", props: [] })).status).toBe(400);
  });

  it("rejects an unknown event name with 400 and emits nothing", async () => {
    const res = await post({ name: "totally_made_up" });
    expect(res.status).toBe(400);
    expect(emitMetric).not.toHaveBeenCalled();
  });

  it("rejects a missing name with 400", async () => {
    const res = await post({ props: { page: "shelf" } });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await post("{not json", true);
    expect(res.status).toBe(400);
  });

  it("rejects a non-object body with 400", async () => {
    const res = await post(["hint_shown"]);
    expect(res.status).toBe(400);
  });

  it("rejects props that are not a flat object", async () => {
    const res = await post({ name: "hint_shown", props: { nested: { a: 1 } } });
    expect(res.status).toBe(400);
    expect(emitMetric).not.toHaveBeenCalled();
  });

  it("rejects props with too many keys", async () => {
    const props = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
    const res = await post({ name: "hint_shown", props });
    expect(res.status).toBe(400);
  });

  it("rejects a prop string value over the length cap", async () => {
    const res = await post({ name: "hint_shown", props: { v: "x".repeat(201) } });
    expect(res.status).toBe(400);
  });
});
