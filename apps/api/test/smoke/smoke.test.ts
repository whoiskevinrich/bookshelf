/**
 * Smoke tests — run against a live deployed API.
 * Set API_BASE_URL env var to the API Gateway endpoint before running.
 *
 * These tests deliberately avoid Cognito token creation so they can run
 * without user credentials. Auth-gated routes are verified to return 401
 * with the correct shape, not to exercise full CRUD.
 */

import { describe, it, expect } from "vitest";

const BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, "");

if (!BASE_URL) {
  throw new Error("API_BASE_URL env var is required for smoke tests");
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json", ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const get = (path: string, headers?: Record<string, string>) => request("GET", path, undefined, headers);
const post = (path: string, body: unknown) => request("POST", path, body);
const patch = (path: string, body: unknown) => request("PATCH", path, body);
const del = (path: string) => request("DELETE", path);

describe("Health", () => {
  it("GET /health returns 200 with { status: ok }", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("Books — unauthenticated", () => {
  it("GET /v1/books/search?q=dune returns results array", async () => {
    const res = await get("/v1/books/search?q=dune");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
  });

  it("GET /v1/books/search without q returns 400", async () => {
    const res = await get("/v1/books/search");
    expect(res.status).toBe(400);
  });

  it("GET /v1/books/isbn/9780441013593 returns a book or 404", async () => {
    const res = await get("/v1/books/isbn/9780441013593");
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { isbn: string; title: string };
      expect(typeof body.isbn).toBe("string");
      expect(typeof body.title).toBe("string");
    }
  });

  it("GET /v1/books/isbn/<invalid> returns 400", async () => {
    const res = await get("/v1/books/isbn/not-an-isbn");
    expect(res.status).toBe(400);
  });
});

describe("Shelf — auth gate", () => {
  it("GET /v1/shelf without token returns 401", async () => {
    const res = await get("/v1/shelf");
    expect(res.status).toBe(401);
  });

  it("POST /v1/shelf without token returns 401", async () => {
    const res = await post("/v1/shelf", { isbn: "9780441013593", status: "owned" });
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/shelf/:isbn without token returns 401", async () => {
    const res = await patch("/v1/shelf/9780441013593", { status: "want" });
    expect(res.status).toBe(401);
  });

  it("DELETE /v1/shelf/:isbn without token returns 401", async () => {
    const res = await del("/v1/shelf/9780441013593");
    expect(res.status).toBe(401);
  });

  it("GET /v1/shelf with malformed token returns 401", async () => {
    const res = await get("/v1/shelf", { Authorization: "Bearer not.a.real.token" });
    expect(res.status).toBe(401);
  });
});

describe("404 handling", () => {
  it("unknown route returns 404", async () => {
    const res = await get("/v1/does-not-exist");
    expect(res.status).toBe(404);
  });
});
