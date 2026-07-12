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
  updateShelfAttributes,
  fetchShelfEntry,
  removeFromShelf,
  COPIES_MAX,
  type BookMetadata,
  type ShelfEntry,
  type ShelfFilter,
  type ShelfPage,
  type ShelfStatus,
} from "../lib/api-client";
import { track } from "../lib/analytics";

function shelfKey() {
  return ["shelf"] as const;
}

export function useShelf() {
  const key = shelfKey();
  return useInfiniteQuery<ShelfPage, Error, InfiniteData<ShelfPage>, typeof key, string | null>({
    queryKey: key,
    queryFn: ({ pageParam }) => {
      const params: { cursor?: string; limit: number } = { limit: 40 };
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
    onSuccess: (result) => {
      // Edition grouping (BOOKSHELF-91): fire the group metric here so it's counted
      // regardless of add surface (search or scanner). Surfaces render their own
      // "grouped with …" notice from the returned `groupedWith`.
      if (result.groupedWith.length > 0) {
        track("edition_grouped", { editions: result.groupedWith.length + 1 });
      }
      return qc.invalidateQueries({ queryKey: shelfKey() });
    },
  });
}

/**
 * "Keep separate" from the add-time grouping notice (BOOKSHELF-91): detach a
 * just-added edition from the work it auto-joined. Not bound to a single isbn (the
 * add surface knows the isbn only at notice time), unlike the Book Details grouping
 * hook.
 */
export function useKeepEditionSeparate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isbn: string) => updateShelfAttributes(isbn, { grouped: false }),
    onSuccess: (_result, isbn) => {
      track("edition_ungrouped");
      void qc.invalidateQueries({ queryKey: shelfKey() });
      void qc.invalidateQueries({ queryKey: ["book", isbn] });
    },
  });
}

/**
 * The web-client side of the duplicate-add offer (BOOKSHELF-60). A 409 on `POST
 * /v1/shelf` means the book is already on the shelf; callers gate this to a
 * duplicate *owned* add (copies is owned-only), then this looks up the current
 * count and PATCHes the absolute incremented value — never a silent auto-increment.
 * Clamped at COPIES_MAX so a book already at the ceiling is a no-op, not a 400.
 */
export function useAddAnotherCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (isbn: string) => {
      const entry = await fetchShelfEntry(isbn);
      return updateShelfAttributes(isbn, { copies: Math.min(entry.copies + 1, COPIES_MAX) });
    },
    onSuccess: (_entry, isbn) => {
      void qc.invalidateQueries({ queryKey: shelfKey() });
      void qc.invalidateQueries({ queryKey: ["book", isbn] });
    },
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
              e.isbn === isbn ? { ...e, owned: status === "owned", want: status === "want" } : e,
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
