import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  fetchShelf,
  addToShelf,
  updateShelfStatus,
  removeFromShelf,
  type BookMetadata,
  type ShelfEntry,
  type ShelfFilter,
  type ShelfPage,
  type ShelfStatus,
} from "../lib/api-client";

function shelfKey(status?: ShelfStatus) {
  return status ? (["shelf", { status }] as const) : (["shelf"] as const);
}

export function useShelf(opts?: { status?: ShelfStatus }) {
  const key = shelfKey(opts?.status);
  return useInfiniteQuery<ShelfPage, Error, InfiniteData<ShelfPage>, typeof key, string | null>({
    queryKey: key,
    queryFn: ({ pageParam }) => {
      const params: { status?: ShelfStatus; cursor?: string; limit: number } = { limit: 40 };
      if (opts?.status) params.status = opts.status;
      if (pageParam) params.cursor = pageParam;
      return fetchShelf(params);
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/**
 * Fetch all entries matching a filter (system facet and/or tag). The server's
 * filtered query returns the full match set in one page (no cursor), so a plain
 * query is enough. Disabled until a filter is active.
 */
export function useFilteredShelf(filter: ShelfFilter | null) {
  return useQuery<ShelfPage>({
    queryKey: ["shelf", "filtered", filter],
    queryFn: () => fetchShelf({ ...(filter ?? {}), limit: 100 }),
    enabled: !!filter,
  });
}

export function useAddToShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      isbn,
      status,
      book,
    }: {
      isbn: string;
      status: ShelfStatus;
      book?: BookMetadata;
    }) => addToShelf(isbn, status, book),
    onSuccess: () => qc.invalidateQueries({ queryKey: shelfKey() }),
  });
}

export function useMoveShelfEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ isbn, status }: { isbn: string; status: ShelfStatus }) =>
      updateShelfStatus(isbn, status),
    onMutate: async ({ isbn, status }) => {
      await qc.cancelQueries({ queryKey: shelfKey() });
      const prev = qc.getQueryData<InfiniteData<ShelfPage>>(shelfKey());
      qc.setQueryData<InfiniteData<ShelfPage>>(shelfKey(), (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            // Keep the derived booleans in sync so the card's state pills update
            // optimistically too (status auto-clears want on owned — ADR-019 Q1).
            entries: page.entries.map((e) =>
              e.isbn === isbn
                ? { ...e, status, owned: status === "owned", want: status === "want" }
                : e,
            ),
          })),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(shelfKey(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: shelfKey() }),
  });
}

export function useRemoveFromShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isbn: string) => removeFromShelf(isbn),
    onMutate: async (isbn) => {
      await qc.cancelQueries({ queryKey: shelfKey() });
      const prev = qc.getQueryData<InfiniteData<ShelfPage>>(shelfKey());
      qc.setQueryData<InfiniteData<ShelfPage>>(shelfKey(), (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            entries: page.entries.filter((e) => e.isbn !== isbn),
            total: page.total - 1,
          })),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(shelfKey(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: shelfKey() }),
  });
}

/** Flatten all pages into a single entries array. */
export function flattenShelf(data: InfiniteData<ShelfPage> | undefined): ShelfEntry[] {
  return data?.pages.flatMap((p) => p.entries) ?? [];
}
