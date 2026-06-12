import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, okResult, errResult } from "../../src/lib/api.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Build a minimal Response-like object for the parts apiFetch reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("apiFetch", () => {
  it("returns parsed JSON on a 200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    const res = await apiFetch("http://api.test/v1/shelf", "tok");
    expect(res).toEqual({ ok: true, status: 200, data: { items: [] } });
  });

  it("returns null data without reading the body on 204", async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValueOnce({ status: 204, ok: true, json } as unknown as Response);
    const res = await apiFetch("http://api.test/v1/shelf/123", "tok", { method: "DELETE" });
    expect(res).toEqual({ ok: true, status: 204, data: null });
    expect(json).not.toHaveBeenCalled();
  });

  it("sends the bearer token and no Content-Type on a GET", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiFetch("http://api.test/v1/books/search?q=dune", "tok");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("serializes the body and sets Content-Type when a body is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { ok: true }));
    await apiFetch("http://api.test/v1/shelf", "tok", {
      method: "POST",
      body: { isbn: "9780441013593", status: "owned" },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ isbn: "9780441013593", status: "owned" }));
  });

  it("reports ok:false with the error body on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "Not found" }));
    const res = await apiFetch("http://api.test/v1/shelf/000", "tok");
    expect(res).toEqual({ ok: false, status: 404, data: { error: "Not found" } });
  });

  it("falls back to an empty object when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 502,
      ok: false,
      json: () => Promise.reject(new Error("invalid json")),
    } as unknown as Response);
    const res = await apiFetch("http://api.test/v1/books/search?q=x", "tok");
    expect(res).toEqual({ ok: false, status: 502, data: {} });
  });

  it("returns status 0 with a network-error message when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await apiFetch("http://api.test/v1/shelf", "tok");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.data).toMatchObject({ error: expect.stringContaining("Network error") });
  });
});

describe("okResult / errResult", () => {
  it("okResult wraps pretty-printed JSON in a text block", () => {
    const data = { title: "Dune" };
    expect(okResult(data)).toEqual({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    });
  });

  it("errResult formats the API error and flags isError", () => {
    const res = errResult(409, { error: "Already on shelf" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("API error (409): Already on shelf");
  });

  it("errResult falls back to 'Unknown error' when no error field is present", () => {
    const res = errResult(500, {});
    expect(res.content[0].text).toBe("API error (500): Unknown error");
  });
});
