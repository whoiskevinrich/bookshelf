import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGoogleBooksProvider } from "../../../src/lib/books/providers/google-books.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeVolume(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    volumeInfo: {
      title: "Test Book",
      authors: ["Test Author"],
      publishedDate: "2020-01-01",
      description: "A test book.",
      imageLinks: {
        thumbnail: "http://books.google.com/thumbnail.jpg",
      },
      industryIdentifiers: [{ type: "ISBN_13", identifier: "9780441013593" }],
      ...overrides,
    },
  };
}

function mockResponse(items: unknown[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ totalItems: items.length, items }),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("createGoogleBooksProvider.search", () => {
  it("returns mapped results", async () => {
    mockResponse([makeVolume()]);
    const provider = createGoogleBooksProvider("test-key");
    const results = await provider.search("dune");
    expect(results).toHaveLength(1);
    expect(results[0]?.isbn).toBe("9780441013593");
    expect(results[0]?.title).toBe("Test Book");
    expect(results[0]?.coverUrl).toBe("https://books.google.com/thumbnail.jpg");
  });

  it("returns empty array when no items", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ totalItems: 0 }),
    });
    const provider = createGoogleBooksProvider("test-key");
    const results = await provider.search("nothing");
    expect(results).toHaveLength(0);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden" });
    const provider = createGoogleBooksProvider("bad-key");
    await expect(provider.search("anything")).rejects.toThrow("403");
  });

  it("does not retry a non-retryable status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden" });
    const provider = createGoogleBooksProvider("bad-key");
    await expect(provider.search("anything")).rejects.toThrow("403");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("createGoogleBooksProvider retry (BOOKSHELF-95)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Fires the request, then fast-forwards every pending backoff timer (rather than waiting
  // out real wall-clock delays) before resolving/rejecting the outcome.
  async function runToCompletion<T>(promise: Promise<T>): Promise<T> {
    const timers = vi.runAllTimersAsync();
    const [result] = await Promise.all([promise, timers]);
    return result;
  }

  it("retries a transient 503 and succeeds", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    mockResponse([makeVolume()]);
    const provider = createGoogleBooksProvider("key");
    const results = await runToCompletion(provider.search("dune"));
    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries each retryable status code (429, 502, 503, 504)", async () => {
    for (const status of [429, 502, 503, 504]) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({ ok: false, status, statusText: "retryable" });
      mockResponse([makeVolume()]);
      const provider = createGoogleBooksProvider("key");
      const results = await runToCompletion(provider.search("dune"));
      expect(results).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }
  });

  it("succeeds on the final allowed attempt (2 failures then success)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    mockResponse([makeVolume()]);
    const provider = createGoogleBooksProvider("key");
    const results = await runToCompletion(provider.search("dune"));
    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after the max attempts and throws the last attempt's error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway" });
    const provider = createGoogleBooksProvider("key");
    await expect(runToCompletion(provider.search("dune"))).rejects.toThrow("502");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retries a thrown network error and succeeds", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockResponse([makeVolume()]);
    const provider = createGoogleBooksProvider("key");
    const results = await runToCompletion(provider.search("dune"));
    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up and rethrows after exhausting attempts on a persistent network error", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    const provider = createGoogleBooksProvider("key");
    await expect(runToCompletion(provider.search("dune"))).rejects.toThrow("fetch failed");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("actually waits out the backoff delay between retries", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    mockResponse([makeVolume()]);
    const provider = createGoogleBooksProvider("key");
    const promise = provider.search("dune");

    // Only the first attempt should have fired before the backoff delay elapses.
    await vi.advanceTimersByTimeAsync(100);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    await promise;
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("createGoogleBooksProvider.getByIsbn", () => {
  it("returns first result for isbn query", async () => {
    mockResponse([makeVolume()]);
    const provider = createGoogleBooksProvider("key");
    const result = await provider.getByIsbn("9780441013593");
    expect(result?.isbn).toBe("9780441013593");
  });

  it("returns null when no items", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ totalItems: 0 }) });
    const provider = createGoogleBooksProvider("key");
    const result = await provider.getByIsbn("9999999999999");
    expect(result).toBeNull();
  });

  it("returns the queried isbn, not the volume id, when the record has no industryIdentifiers", async () => {
    mockResponse([makeVolume({ industryIdentifiers: [] })]);
    const provider = createGoogleBooksProvider("key");
    const result = await provider.getByIsbn("9780441569595");
    expect(result?.isbn).toBe("9780441569595");
  });
});

describe("format hint (BOOKSHELF-92)", () => {
  it("hints ebook from saleInfo.isEbook", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalItems: 1,
        items: [{ ...makeVolume(), saleInfo: { isEbook: true } }],
      }),
    });
    const provider = createGoogleBooksProvider("key");
    const result = await provider.getByIsbn("9780441013593");
    expect(result?.formatHint).toBe("ebook");
  });

  it("hints audiobook from explicit title wording", async () => {
    mockResponse([makeVolume({ title: "Dune (Audiobook)" })]);
    const provider = createGoogleBooksProvider("key");
    const results = await provider.search("dune audiobook");
    expect(results[0]?.formatHint).toBe("audiobook");
  });

  it("hints audiobook from 'Unabridged' in the title", async () => {
    mockResponse([makeVolume({ title: "Dune: Unabridged" })]);
    const provider = createGoogleBooksProvider("key");
    const results = await provider.search("dune unabridged");
    expect(results[0]?.formatHint).toBe("audiobook");
  });

  it("prefers the audiobook title signal over saleInfo.isEbook", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalItems: 1,
        items: [{ ...makeVolume({ title: "Dune (Audiobook)" }), saleInfo: { isEbook: true } }],
      }),
    });
    const provider = createGoogleBooksProvider("key");
    const result = await provider.getByIsbn("9780441013593");
    expect(result?.formatHint).toBe("audiobook");
  });

  it("returns null when there is no unambiguous signal (never guesses hardcover/paperback)", async () => {
    mockResponse([makeVolume()]);
    const provider = createGoogleBooksProvider("key");
    const results = await provider.search("dune");
    expect(results[0]?.formatHint).toBeNull();
  });
});
