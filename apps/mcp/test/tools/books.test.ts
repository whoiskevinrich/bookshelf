import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api.js")>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../src/lib/api.js";
import { registerBookTools } from "../../src/tools/books.js";
import { captureTools, type CapturedTool } from "../helpers.js";

const TOKEN = "tok";
const API = "http://api.test";

let tools: Map<string, CapturedTool>;

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  const captured = captureTools();
  registerBookTools(captured.server, TOKEN, API);
  tools = captured.tools;
});

function call(name: string, args: Record<string, unknown>) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool.handler(args);
}

function mockApi(value: { ok: boolean; status: number; data: unknown }) {
  vi.mocked(apiFetch).mockResolvedValueOnce(value);
}

describe("registerBookTools", () => {
  it("registers the expected tool set", () => {
    expect([...tools.keys()].sort()).toEqual(
      ["lookup_book_asin", "lookup_book_isbn", "search_books"].sort(),
    );
  });

  describe("search_books", () => {
    it("URL-encodes the query and returns results", async () => {
      mockApi({ ok: true, status: 200, data: { items: [{ title: "Dune" }] } });
      await call("search_books", { query: "dune frank herbert" });
      expect(apiFetch).toHaveBeenCalledWith(
        `${API}/v1/books/search?q=dune%20frank%20herbert`,
        TOKEN,
      );
    });

    it("surfaces an upstream failure as isError", async () => {
      mockApi({ ok: false, status: 502, data: { error: "Bad upstream" } });
      const res = await call("search_books", { query: "x" });
      expect(res.isError).toBe(true);
    });
  });

  describe("lookup_book_isbn", () => {
    it("encodes the ISBN into the path", async () => {
      mockApi({ ok: true, status: 200, data: { title: "Dune" } });
      await call("lookup_book_isbn", { isbn: "978-0-441-01359-3" });
      expect(apiFetch).toHaveBeenCalledWith(`${API}/v1/books/isbn/978-0-441-01359-3`, TOKEN);
    });
  });

  describe("lookup_book_asin", () => {
    it("encodes the ASIN into the path", async () => {
      mockApi({ ok: true, status: 200, data: { title: "Dune" } });
      await call("lookup_book_asin", { asin: "B000FC0SIM" });
      expect(apiFetch).toHaveBeenCalledWith(`${API}/v1/books/asin/B000FC0SIM`, TOKEN);
    });
  });
});
