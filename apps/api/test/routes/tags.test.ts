import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: import("hono").Context, next: import("hono").Next) => {
    c.set("auth", { userId: "test-user-sub" });
    await next();
  }),
}));

vi.mock("../../src/lib/dynamo.js", () => ({
  queryDistinctTags: vi.fn(),
}));

import { Hono } from "hono";
import { queryDistinctTags } from "../../src/lib/dynamo.js";
import { tagsRouter } from "../../src/routes/tags.js";

function makeApp() {
  const app = new Hono();
  app.route("/v1/tags", tagsRouter);
  return app;
}

beforeEach(() => {
  vi.mocked(queryDistinctTags).mockReset();
});

describe("GET /v1/tags", () => {
  it("returns the user's distinct tags with counts", async () => {
    vi.mocked(queryDistinctTags).mockResolvedValueOnce([
      { tag: "sci-fi", count: 12 },
      { tag: "fantasy", count: 4 },
    ]);
    const app = makeApp();
    const res = await app.request("/v1/tags");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: { tag: string; count: number }[] };
    expect(body.tags).toHaveLength(2);
    expect(body.tags[0]).toEqual({ tag: "sci-fi", count: 12 });
    expect(vi.mocked(queryDistinctTags)).toHaveBeenCalledWith("test-user-sub");
  });

  it("returns an empty list when the user has no tags", async () => {
    vi.mocked(queryDistinctTags).mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await app.request("/v1/tags");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: unknown[] };
    expect(body.tags).toEqual([]);
  });

  it("returns 500 when the query fails", async () => {
    vi.mocked(queryDistinctTags).mockRejectedValueOnce(new Error("boom"));
    const app = makeApp();
    const res = await app.request("/v1/tags");
    expect(res.status).toBe(500);
  });
});
