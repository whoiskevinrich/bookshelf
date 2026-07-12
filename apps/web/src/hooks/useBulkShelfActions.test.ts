import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper, makeEntry } from "../test/utils";

vi.mock("../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api-client")>();
  return {
    ...actual,
    removeFromShelf: vi.fn(),
    updateShelfStatus: vi.fn(),
    updateShelfTags: vi.fn(),
    addBookToShelf: vi.fn(),
  };
});

import {
  removeFromShelf,
  updateShelfStatus,
  updateShelfTags,
  addBookToShelf,
} from "../lib/api-client";
import { useBulkShelfActions } from "./useBulkShelfActions";

const mockRemove = vi.mocked(removeFromShelf);
const mockUpdateStatus = vi.mocked(updateShelfStatus);
const mockUpdateTags = vi.mocked(updateShelfTags);
const mockAddToShelf = vi.mocked(addBookToShelf);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useBulkShelfActions — bulkDelete", () => {
  it("fans out a delete call per ISBN and reports zero failures on full success", async () => {
    mockRemove.mockResolvedValue(undefined);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBulkShelfActions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.bulkDelete(["1", "2", "3"]);
    });

    expect(mockRemove).toHaveBeenCalledTimes(3);
    expect(result.current.result).toEqual({ op: "delete", total: 3, failed: [] });
  });

  it("reports only the failed ISBNs when some calls reject (partial failure)", async () => {
    mockRemove.mockImplementation((isbn: string) =>
      isbn === "bad" ? Promise.reject(new Error("boom")) : Promise.resolve(undefined),
    );
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBulkShelfActions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.bulkDelete(["good", "bad"]);
    });

    expect(result.current.result).toEqual({ op: "delete", total: 2, failed: ["bad"] });
  });
});

describe("useBulkShelfActions — retry", () => {
  it("retries only the previously-failed ISBNs", async () => {
    mockRemove
      .mockResolvedValueOnce(undefined) // "good"
      .mockRejectedValueOnce(new Error("boom")) // "bad" (first attempt)
      .mockResolvedValueOnce(undefined); // "bad" (retry)
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBulkShelfActions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.bulkDelete(["good", "bad"]);
    });
    expect(result.current.result?.failed).toEqual(["bad"]);

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.result?.failed).toEqual([]));

    expect(mockRemove).toHaveBeenCalledTimes(3);
    expect(mockRemove).toHaveBeenLastCalledWith("bad");
  });
});

describe("useBulkShelfActions — bulkMove", () => {
  it("calls updateShelfStatus per ISBN with the target status", async () => {
    mockUpdateStatus.mockResolvedValue(makeEntry());
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBulkShelfActions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.bulkMove(["1", "2"], "owned");
    });

    expect(mockUpdateStatus).toHaveBeenCalledWith("1", "owned");
    expect(mockUpdateStatus).toHaveBeenCalledWith("2", "owned");
    expect(result.current.result?.op).toBe("move-owned");
  });
});

describe("useBulkShelfActions — bulkAddTag", () => {
  it("merges the new tag into each entry's existing tags (additive, not a replace)", async () => {
    mockUpdateTags.mockResolvedValue(makeEntry());
    const entries = [
      makeEntry({ isbn: "1", tags: ["fiction"] }),
      makeEntry({ isbn: "2", tags: ["sci-fi", "read-again"] }),
    ];
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBulkShelfActions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.bulkAddTag(["1", "2"], "read-again", entries);
    });

    expect(mockUpdateTags).toHaveBeenCalledWith("1", ["fiction", "read-again"]);
    // Already had the tag — sent unchanged, not duplicated.
    expect(mockUpdateTags).toHaveBeenCalledWith("2", ["sci-fi", "read-again"]);
  });
});

describe("useBulkShelfActions — bulkAddToShelf", () => {
  it("calls addBookToShelf per ISBN for the target shelf", async () => {
    mockAddToShelf.mockResolvedValue(undefined);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBulkShelfActions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.bulkAddToShelf(["1", "2"], "shelf-1");
    });

    expect(mockAddToShelf).toHaveBeenCalledWith("shelf-1", "1");
    expect(mockAddToShelf).toHaveBeenCalledWith("shelf-1", "2");
  });
});
