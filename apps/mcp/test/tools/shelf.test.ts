import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api.js")>();
  // Mock only the network call; keep the real okResult/errResult formatting.
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../src/lib/api.js";
import { registerShelfTools } from "../../src/tools/shelf.js";
import { captureTools, type CapturedTool } from "../helpers.js";

const TOKEN = "tok";
const API = "http://api.test";

let tools: Map<string, CapturedTool>;

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  const captured = captureTools();
  registerShelfTools(captured.server, TOKEN, API);
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

describe("registerShelfTools", () => {
  it("registers the expected tool set", () => {
    expect([...tools.keys()].sort()).toEqual(
      ["add_book", "list_shelf", "remove_book", "set_notes", "update_book_status"].sort(),
    );
  });

  describe("list_shelf", () => {
    it("calls the shelf endpoint with no query string when no filters", async () => {
      mockApi({ ok: true, status: 200, data: { items: [] } });
      const res = await call("list_shelf", {});
      expect(apiFetch).toHaveBeenCalledWith(`${API}/v1/shelf`, TOKEN);
      expect(res.content[0].text).toBe(JSON.stringify({ items: [] }, null, 2));
    });

    it("builds a query string from status, limit, and cursor", async () => {
      mockApi({ ok: true, status: 200, data: { items: [] } });
      await call("list_shelf", { status: "owned", limit: 50, cursor: "abc" });
      const [url] = vi.mocked(apiFetch).mock.calls[0] as [string];
      expect(url).toBe(`${API}/v1/shelf?owned=true&limit=50&cursor=abc`);
    });

    it("surfaces an API error as an isError result", async () => {
      mockApi({ ok: false, status: 502, data: { error: "Bad upstream" } });
      const res = await call("list_shelf", {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("502");
    });
  });

  describe("add_book", () => {
    it("POSTs isbn + status and returns the created entry", async () => {
      mockApi({ ok: true, status: 201, data: { isbn: "9780441013593", status: "owned" } });
      await call("add_book", { isbn: "9780441013593", status: "owned" });
      expect(apiFetch).toHaveBeenCalledWith(`${API}/v1/shelf`, TOKEN, {
        method: "POST",
        body: { isbn: "9780441013593", owned: true, want: false },
      });
    });

    it("returns a friendly (non-error) message on a 409 duplicate", async () => {
      mockApi({ ok: false, status: 409, data: { error: "duplicate" } });
      const res = await call("add_book", { isbn: "9780441013593", status: "want" });
      expect(res.isError).toBeUndefined();
      expect(res.content[0].text).toMatch(/already on your shelf/i);
    });

    it("surfaces other failures as isError", async () => {
      mockApi({ ok: false, status: 400, data: { error: "Invalid ISBN" } });
      const res = await call("add_book", { isbn: "bad", status: "owned" });
      expect(res.isError).toBe(true);
    });
  });

  describe("update_book_status", () => {
    it("strips hyphens from the ISBN and PATCHes the new status", async () => {
      mockApi({ ok: true, status: 200, data: { status: "owned" } });
      await call("update_book_status", { isbn: "978-0-441-01359-3", status: "owned" });
      expect(apiFetch).toHaveBeenCalledWith(`${API}/v1/shelf/9780441013593`, TOKEN, {
        method: "PATCH",
        body: { owned: true, want: false },
      });
    });
  });

  describe("remove_book", () => {
    it("DELETEs the shelf entry and confirms removal", async () => {
      mockApi({ ok: true, status: 204, data: null });
      const res = await call("remove_book", { isbn: "978-0-441-01359-3" });
      expect(apiFetch).toHaveBeenCalledWith(`${API}/v1/shelf/9780441013593`, TOKEN, {
        method: "DELETE",
      });
      expect(res.content[0].text).toMatch(/removed/i);
    });
  });

  describe("set_notes", () => {
    it("PATCHes a note to the notes sub-resource", async () => {
      mockApi({ ok: true, status: 200, data: { notes: "loved it" } });
      await call("set_notes", { isbn: "9780441013593", notes: "loved it" });
      expect(apiFetch).toHaveBeenCalledWith(`${API}/v1/shelf/9780441013593/notes`, TOKEN, {
        method: "PATCH",
        body: { notes: "loved it" },
      });
    });

    it("forwards null to clear an existing note", async () => {
      mockApi({ ok: true, status: 200, data: { notes: null } });
      await call("set_notes", { isbn: "9780441013593", notes: null });
      const [, , options] = vi.mocked(apiFetch).mock.calls[0] as [
        string,
        string,
        { body: unknown },
      ];
      expect(options.body).toEqual({ notes: null });
    });
  });
});
