import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: import("hono").Context, next: import("hono").Next) => {
    c.set("auth", { userId: "test-user-sub" });
    await next();
  }),
}));

vi.mock("../../src/lib/dynamo.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/lib/dynamo.js")>();
  return {
    querySmartShelves: vi.fn(),
    querySmartShelvesWithCounts: vi.fn(),
    getSmartShelf: vi.fn(),
    putSmartShelf: vi.fn(),
    updateSmartShelfName: vi.fn(),
    deleteSmartShelf: vi.fn(),
    isValidReadingStatus: mod.isValidReadingStatus,
    normalizeTag: mod.normalizeTag,
  };
});

import { Hono } from "hono";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  querySmartShelves,
  querySmartShelvesWithCounts,
  getSmartShelf,
  putSmartShelf,
  updateSmartShelfName,
  deleteSmartShelf,
} from "../../src/lib/dynamo.js";

const UUID = "11111111-1111-4111-8111-111111111111";
import { smartShelvesRouter } from "../../src/routes/smart-shelves.js";

function makeApp() {
  const app = new Hono();
  app.route("/v1/smart-shelves", smartShelvesRouter);
  return app;
}

beforeEach(() => {
  vi.mocked(querySmartShelves).mockReset();
  vi.mocked(querySmartShelvesWithCounts).mockReset();
  vi.mocked(getSmartShelf).mockReset();
  vi.mocked(putSmartShelf).mockReset();
  vi.mocked(updateSmartShelfName).mockReset();
  vi.mocked(deleteSmartShelf).mockReset();
});

describe("GET /v1/smart-shelves", () => {
  it("lists smart shelves with counts", async () => {
    vi.mocked(querySmartShelvesWithCounts).mockResolvedValueOnce([
      {
        smartShelfId: "a",
        name: "Currently reading sci-fi",
        rule: { readingStatus: "reading", tag: "sci-fi" },
        createdAt: "2026-06-28T00:00:00.000Z",
        count: 12,
      },
    ]);
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number }[];
    expect(body[0]!.count).toBe(12);
  });
});

describe("POST /v1/smart-shelves", () => {
  it("creates a smart shelf from a valid rule (tag normalized)", async () => {
    vi.mocked(querySmartShelves).mockResolvedValueOnce([]);
    vi.mocked(putSmartShelf).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Reading sci-fi",
        rule: { readingStatus: "reading", tag: "Sci-Fi" },
      }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(putSmartShelf)).toHaveBeenCalledWith(
      "test-user-sub",
      expect.any(String),
      "Reading sci-fi",
      expect.objectContaining({ readingStatus: "reading", tag: "sci-fi" }),
      expect.any(String),
    );
  });

  it("rejects an empty rule (no facets)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Empty", rule: {} }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(putSmartShelf)).not.toHaveBeenCalled();
  });

  it("rejects owned+want both true in the rule", async () => {
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad", rule: { owned: true, want: true } }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a missing name", async () => {
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule: { owned: true } }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the smart-shelf limit is reached", async () => {
    vi.mocked(querySmartShelves).mockResolvedValueOnce(
      Array.from({ length: 50 }, (_, i) => ({
        smartShelfId: `id-${i}`,
        name: `s${i}`,
        rule: { owned: true },
        createdAt: "2026-06-28T00:00:00.000Z",
      })),
    );
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "One too many", rule: { owned: true } }),
    });
    expect(res.status).toBe(409);
    expect(vi.mocked(putSmartShelf)).not.toHaveBeenCalled();
  });
});

describe("PATCH /v1/smart-shelves/:id", () => {
  it("renames a smart shelf", async () => {
    vi.mocked(updateSmartShelfName).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request(`/v1/smart-shelves/${UUID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New name" }),
    });
    expect(res.status).toBe(204);
  });

  it("returns 400 for an invalid (non-UUID) id", async () => {
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves/not-a-uuid", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New name" }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(updateSmartShelfName)).not.toHaveBeenCalled();
  });

  it("returns 404 when the shelf doesn't exist", async () => {
    vi.mocked(updateSmartShelfName).mockRejectedValueOnce(
      new ConditionalCheckFailedException({ message: "no", $metadata: {} }),
    );
    const app = makeApp();
    const res = await app.request(`/v1/smart-shelves/${UUID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New name" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/smart-shelves/:id", () => {
  it("deletes an existing smart shelf", async () => {
    vi.mocked(getSmartShelf).mockResolvedValueOnce({
      smartShelfId: UUID,
      name: "X",
      rule: { owned: true },
      createdAt: "2026-06-28T00:00:00.000Z",
    });
    vi.mocked(deleteSmartShelf).mockResolvedValueOnce(undefined);
    const app = makeApp();
    const res = await app.request(`/v1/smart-shelves/${UUID}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("returns 400 for an invalid (non-UUID) id", async () => {
    const app = makeApp();
    const res = await app.request("/v1/smart-shelves/not-a-uuid", { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(vi.mocked(getSmartShelf)).not.toHaveBeenCalled();
  });

  it("returns 404 when the shelf doesn't exist", async () => {
    vi.mocked(getSmartShelf).mockResolvedValueOnce(null);
    const app = makeApp();
    const res = await app.request(`/v1/smart-shelves/${UUID}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
