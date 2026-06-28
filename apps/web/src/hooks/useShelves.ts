import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchShelves,
  fetchShelfBooks,
  createShelf,
  updateShelf,
  deleteShelf,
  reorderShelves,
  addBookToShelf,
  removeBookFromShelf,
  type Shelf,
  type ShelfEntry,
} from "../lib/api-client";

const SHELVES_KEY = ["shelves"] as const;

function shelfBooksKey(shelfId: string) {
  return ["shelves", shelfId, "books"] as const;
}

function useShelfMutation<TVariables>(mutationFn: (v: TVariables) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: SHELVES_KEY }),
  });
}

export function useShelves() {
  return useQuery<Shelf[]>({
    queryKey: SHELVES_KEY,
    queryFn: fetchShelves,
  });
}

export function useSingleShelfBooks(shelfId: string) {
  return useQuery<ShelfEntry[]>({
    queryKey: shelfBooksKey(shelfId),
    queryFn: () => fetchShelfBooks(shelfId),
    enabled: !!shelfId,
  });
}

export function useCreateShelf() {
  return useShelfMutation((name: string) => createShelf(name));
}

export function useUpdateShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shelfId, name }: { shelfId: string; name: string }) =>
      updateShelf(shelfId, name),
    onMutate: async ({ shelfId, name }) => {
      await qc.cancelQueries({ queryKey: SHELVES_KEY });
      const prev = qc.getQueryData<Shelf[]>(SHELVES_KEY);
      qc.setQueryData<Shelf[]>(SHELVES_KEY, (old) =>
        old?.map((s) => (s.shelfId === shelfId ? { ...s, name } : s)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(SHELVES_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SHELVES_KEY }),
  });
}

export function useDeleteShelf() {
  return useShelfMutation((shelfId: string) => deleteShelf(shelfId));
}

export function useAddBookToShelf() {
  return useShelfMutation(({ shelfId, isbn }: { shelfId: string; isbn: string }) =>
    addBookToShelf(shelfId, isbn),
  );
}

export function useRemoveBookFromShelf() {
  return useShelfMutation(({ shelfId, isbn }: { shelfId: string; isbn: string }) =>
    removeBookFromShelf(shelfId, isbn),
  );
}

export function useReorderShelves() {
  return useShelfMutation((order: string[]) => reorderShelves(order));
}
