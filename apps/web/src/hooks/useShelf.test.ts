import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { InfiniteData } from "@tanstack/react-query";
import { createQueryWrapper, makeEntry, makeEntryDetail, makeShelfPage } from "../test/utils";
import type { ShelfPage } from "../lib/api-client";

// Mock the api-client module the hooks call into.
vi.mock("../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api-client")>();
  return {
    ...actual,
    fetchShelf: vi.fn(),
    addToShelf: vi.fn(),
    updateShelfStatus: vi.fn(),
    removeFromShelf: vi.fn(),
    fetchShelfEntry: vi.fn(),
    updateShelfAttributes: vi.fn(),
  };
});

import {
  fetchShelf,
  updateShelfStatus,
  removeFromShelf,
  fetchShelfEntry,
  updateShelfAttributes,
} from "../lib/api-client";
import {
  useShelf,
  useMoveShelfEntry,
  useRemoveFromShelf,
  useAddAnotherCopy,
  flattenShelf,
} from "./useShelf";

const mockFetchShelf = vi.mocked(fetchShelf);
const mockUpdateStatus = vi.mocked(updateShelfStatus);
const mockRemove = vi.mocked(removeFromShelf);
const mockFetchEntry = vi.mocked(fetchShelfEntry);
const mockUpdateAttrs = vi.mocked(updateShelfAttributes);

function seedShelf(client: ReturnType<typeof createQueryWrapper>["client"], page: ShelfPage) {
  const data: InfiniteData<ShelfPage> = { pages: [page], pageParams: [null] };
  client.setQueryData(["shelf"], data);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("flattenShelf", () => {
  it("returns [] for undefined data", () => {
    expect(flattenShelf(undefined)).toEqual([]);
  });

  it("flattens entries across pages in order", () => {
    const a = makeEntry({ isbn: "1" });
    const b = makeEntry({ isbn: "2" });
    const c = makeEntry({ isbn: "3" });
    const data: InfiniteData<ShelfPage> = {
      pages: [makeShelfPage([a, b]), makeShelfPage([c])],
      pageParams: [null, "cursor-1"],
    };
    expect(flattenShelf(data).map((e) => e.isbn)).toEqual(["1", "2", "3"]);
  });
});

describe("useShelf", () => {
  it("requests the first page with limit 40", async () => {
    mockFetchShelf.mockResolvedValue(makeShelfPage([makeEntry()]));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useShelf(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetchShelf).toHaveBeenCalledWith({ limit: 40 });
  });
});

describe("useMoveShelfEntry — optimistic owned/want sync", () => {
  it("flips the cached entry to owned and clears want before the request resolves", async () => {
    const entry = makeEntry({ isbn: "9780441013593", owned: false, want: true });
    const { Wrapper, client } = createQueryWrapper();
    seedShelf(client, makeShelfPage([entry]));

    // Hold the request open so we can observe the optimistic cache state.
    let resolve!: () => void;
    mockUpdateStatus.mockReturnValue(
      new Promise((r) => {
        resolve = () => r(makeEntry({ isbn: "9780441013593", owned: true, want: false }));
      }),
    );

    const { result } = renderHook(() => useMoveShelfEntry(), { wrapper: Wrapper });
    result.current.mutate({ isbn: "9780441013593", status: "owned" });

    await waitFor(() => {
      const cached = client.getQueryData<InfiniteData<ShelfPage>>(["shelf"]);
      const e = cached?.pages[0]?.entries[0];
      expect(e?.owned).toBe(true);
      expect(e?.want).toBe(false);
    });

    resolve();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateStatus).toHaveBeenCalledWith("9780441013593", "owned");
  });

  it("rolls the cache back to the previous state when the request fails", async () => {
    const entry = makeEntry({ isbn: "9780441013593", owned: false, want: true });
    const { Wrapper, client } = createQueryWrapper();
    seedShelf(client, makeShelfPage([entry]));

    mockUpdateStatus.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useMoveShelfEntry(), { wrapper: Wrapper });
    result.current.mutate({ isbn: "9780441013593", status: "owned" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = client.getQueryData<InfiniteData<ShelfPage>>(["shelf"]);
    const e = cached?.pages[0]?.entries[0];
    expect(e?.owned).toBe(false);
    expect(e?.want).toBe(true);
  });
});

describe("useAddAnotherCopy (BOOKSHELF-60)", () => {
  it("reads the current count and PATCHes the incremented absolute value", async () => {
    mockFetchEntry.mockResolvedValue(makeEntryDetail({ isbn: "1", owned: true, copies: 2 }));
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: "1", owned: true, copies: 3 }));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAddAnotherCopy(), { wrapper: Wrapper });

    result.current.mutate("1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetchEntry).toHaveBeenCalledWith("1");
    expect(mockUpdateAttrs).toHaveBeenCalledWith("1", { copies: 3 });
  });

  it("clamps at the 99 ceiling so a maxed-out book is a no-op, not a 400", async () => {
    mockFetchEntry.mockResolvedValue(makeEntryDetail({ isbn: "1", owned: true, copies: 99 }));
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: "1", owned: true, copies: 99 }));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAddAnotherCopy(), { wrapper: Wrapper });

    result.current.mutate("1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateAttrs).toHaveBeenCalledWith("1", { copies: 99 });
  });

  it("surfaces an error when the lookup fails (no silent success)", async () => {
    mockFetchEntry.mockRejectedValue(new Error("network"));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAddAnotherCopy(), { wrapper: Wrapper });

    result.current.mutate("1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockUpdateAttrs).not.toHaveBeenCalled();
  });
});

describe("useRemoveFromShelf — optimistic removal", () => {
  it("removes the entry and decrements total before the request resolves", async () => {
    const a = makeEntry({ isbn: "1" });
    const b = makeEntry({ isbn: "2" });
    const { Wrapper, client } = createQueryWrapper();
    seedShelf(client, makeShelfPage([a, b]));

    let resolve!: () => void;
    mockRemove.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const { result } = renderHook(() => useRemoveFromShelf(), { wrapper: Wrapper });
    result.current.mutate("1");

    await waitFor(() => {
      const cached = client.getQueryData<InfiniteData<ShelfPage>>(["shelf"]);
      expect(cached?.pages[0]?.entries.map((e) => e.isbn)).toEqual(["2"]);
      expect(cached?.pages[0]?.total).toBe(1);
    });

    resolve();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores the removed entry when the request fails", async () => {
    const a = makeEntry({ isbn: "1" });
    const b = makeEntry({ isbn: "2" });
    const { Wrapper, client } = createQueryWrapper();
    seedShelf(client, makeShelfPage([a, b]));

    mockRemove.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRemoveFromShelf(), { wrapper: Wrapper });
    result.current.mutate("1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = client.getQueryData<InfiniteData<ShelfPage>>(["shelf"]);
    expect(cached?.pages[0]?.entries.map((e) => e.isbn)).toEqual(["1", "2"]);
    expect(cached?.pages[0]?.total).toBe(2);
  });
});
