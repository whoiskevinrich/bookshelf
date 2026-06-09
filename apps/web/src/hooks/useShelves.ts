import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchShelves,
  createShelf,
  updateShelf,
  deleteShelf,
  addBookToShelf,
  removeBookFromShelf,
  type Shelf,
} from "../lib/api-client";

const SHELVES_KEY = ["shelves"] as const;

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

export function useCreateShelf() {
  return useShelfMutation((name: string) => createShelf(name));
}

export function useUpdateShelf() {
  return useShelfMutation(({ shelfId, name }: { shelfId: string; name: string }) =>
    updateShelf(shelfId, name),
  );
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
