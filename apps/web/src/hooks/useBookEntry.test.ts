import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper, makeEntry } from "../test/utils";
import type { ShelfEntry } from "../lib/api-client";

vi.mock("../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api-client")>();
  return {
    ...actual,
    fetchShelfEntry: vi.fn(),
    fetchTags: vi.fn(),
    updateShelfAttributes: vi.fn(),
    updateShelfTags: vi.fn(),
    updateShelfNotes: vi.fn(),
  };
});

import {
  fetchShelfEntry,
  fetchTags,
  updateShelfAttributes,
  updateShelfTags,
  updateShelfNotes,
} from "../lib/api-client";
import {
  useBookEntry,
  useTags,
  useUpdateBookAttributes,
  useUpdateBookCopies,
  useUpdateBookTags,
  useUpdateBookNotes,
} from "./useBookEntry";

const ISBN = "9780441013593";
const mockFetchEntry = vi.mocked(fetchShelfEntry);
const mockFetchTags = vi.mocked(fetchTags);
const mockUpdateAttrs = vi.mocked(updateShelfAttributes);
const mockUpdateTags = vi.mocked(updateShelfTags);
const mockUpdateNotes = vi.mocked(updateShelfNotes);

function seedEntry(client: ReturnType<typeof createQueryWrapper>["client"], entry: ShelfEntry) {
  client.setQueryData(["book", entry.isbn], entry);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useBookEntry", () => {
  it("fetches the entry by isbn", async () => {
    mockFetchEntry.mockResolvedValue(makeEntry({ isbn: ISBN }));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBookEntry(ISBN), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetchEntry).toHaveBeenCalledWith(ISBN);
    expect(result.current.data?.isbn).toBe(ISBN);
  });

  it("is disabled (does not fetch) for an empty isbn", () => {
    const { Wrapper } = createQueryWrapper();
    renderHook(() => useBookEntry(""), { wrapper: Wrapper });
    expect(mockFetchEntry).not.toHaveBeenCalled();
  });
});

describe("useTags", () => {
  it("does not fetch when disabled", () => {
    const { Wrapper } = createQueryWrapper();
    renderHook(() => useTags(false), { wrapper: Wrapper });
    expect(mockFetchTags).not.toHaveBeenCalled();
  });
});

describe("useUpdateBookAttributes — optimistic mutual exclusivity", () => {
  it("setting owned=true optimistically clears want", async () => {
    const entry = makeEntry({ isbn: ISBN, owned: false, want: true });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);

    let resolve!: () => void;
    mockUpdateAttrs.mockReturnValue(
      new Promise((r) => {
        resolve = () => r(makeEntry({ isbn: ISBN, owned: true, want: false }));
      }),
    );

    const { result } = renderHook(() => useUpdateBookAttributes(ISBN), { wrapper: Wrapper });
    result.current.mutate({ owned: true });

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.owned).toBe(true);
      expect(cached?.want).toBe(false);
    });

    resolve();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateAttrs).toHaveBeenCalledWith(ISBN, { owned: true });
  });

  it("setting want=true optimistically clears owned", async () => {
    const entry = makeEntry({ isbn: ISBN, owned: true, want: false });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: ISBN, owned: false, want: true }));

    const { result } = renderHook(() => useUpdateBookAttributes(ISBN), { wrapper: Wrapper });
    result.current.mutate({ want: true });

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.want).toBe(true);
      expect(cached?.owned).toBe(false);
    });
  });

  it("updates readingStatus without touching owned/want", async () => {
    const entry = makeEntry({ isbn: ISBN, owned: true, want: false, readingStatus: null });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: ISBN, readingStatus: "reading" }));

    const { result } = renderHook(() => useUpdateBookAttributes(ISBN), { wrapper: Wrapper });
    result.current.mutate({ readingStatus: "reading" });

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.readingStatus).toBe("reading");
      expect(cached?.owned).toBe(true);
    });
  });

  it("rolls back to the previous entry when the request fails", async () => {
    const entry = makeEntry({ isbn: ISBN, owned: false, want: true });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateAttrs.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() => useUpdateBookAttributes(ISBN), { wrapper: Wrapper });
    result.current.mutate({ owned: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
    expect(cached?.owned).toBe(false);
    expect(cached?.want).toBe(true);
  });

  it("setting want=true optimistically resets copies to 1 (BOOKSHELF-60)", async () => {
    const entry = makeEntry({ isbn: ISBN, owned: true, want: false, copies: 3 });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateAttrs.mockResolvedValue(
      makeEntry({ isbn: ISBN, owned: false, want: true, copies: 1 }),
    );

    const { result } = renderHook(() => useUpdateBookAttributes(ISBN), { wrapper: Wrapper });
    result.current.mutate({ want: true });

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.want).toBe(true);
      expect(cached?.copies).toBe(1);
    });
  });
});

describe("useUpdateBookCopies — optimistic copies (BOOKSHELF-60)", () => {
  it("applies the new copies value optimistically", async () => {
    const entry = makeEntry({ isbn: ISBN, copies: 1 });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: ISBN, copies: 2 }));

    const { result } = renderHook(() => useUpdateBookCopies(ISBN), { wrapper: Wrapper });
    result.current.mutate(2);

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.copies).toBe(2);
    });
    expect(mockUpdateAttrs).toHaveBeenCalledWith(ISBN, { copies: 2 });
  });

  it("rolls back copies when the request fails", async () => {
    const entry = makeEntry({ isbn: ISBN, copies: 2 });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateAttrs.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() => useUpdateBookCopies(ISBN), { wrapper: Wrapper });
    result.current.mutate(3);

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
    expect(cached?.copies).toBe(2);
  });
});

describe("useUpdateBookTags — optimistic normalization", () => {
  it("trims, lowercases, dedupes, and sorts tags optimistically", async () => {
    const entry = makeEntry({ isbn: ISBN, tags: [] });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateTags.mockResolvedValue(makeEntry({ isbn: ISBN, tags: ["fiction", "sci-fi"] }));

    const { result } = renderHook(() => useUpdateBookTags(ISBN), { wrapper: Wrapper });
    result.current.mutate(["  Sci-Fi ", "FICTION", "fiction", "sci-fi"]);

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.tags).toEqual(["fiction", "sci-fi"]);
    });
    expect(mockUpdateTags).toHaveBeenCalledWith(ISBN, [
      "  Sci-Fi ",
      "FICTION",
      "fiction",
      "sci-fi",
    ]);
  });

  it("collapses internal whitespace in a tag", async () => {
    const entry = makeEntry({ isbn: ISBN, tags: [] });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateTags.mockResolvedValue(makeEntry({ isbn: ISBN, tags: ["space opera"] }));

    const { result } = renderHook(() => useUpdateBookTags(ISBN), { wrapper: Wrapper });
    result.current.mutate(["space    opera"]);

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.tags).toEqual(["space opera"]);
    });
  });
});

describe("useUpdateBookNotes — optimistic notes", () => {
  it("applies the new notes value optimistically", async () => {
    const entry = makeEntry({ isbn: ISBN, notes: null });
    const { Wrapper, client } = createQueryWrapper();
    seedEntry(client, entry);
    mockUpdateNotes.mockResolvedValue(makeEntry({ isbn: ISBN, notes: "Loved it" }));

    const { result } = renderHook(() => useUpdateBookNotes(ISBN), { wrapper: Wrapper });
    result.current.mutate("Loved it");

    await waitFor(() => {
      const cached = client.getQueryData<ShelfEntry>(["book", ISBN]);
      expect(cached?.notes).toBe("Loved it");
    });
    expect(mockUpdateNotes).toHaveBeenCalledWith(ISBN, "Loved it");
  });
});
