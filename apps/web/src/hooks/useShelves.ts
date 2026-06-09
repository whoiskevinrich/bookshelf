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

export function useShelves() {
  return useQuery<Shelf[]>({
    queryKey: SHELVES_KEY,
    queryFn: fetchShelves,
  });
}

export function useCreateShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createShelf(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHELVES_KEY }),
  });
}

export function useUpdateShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shelfId, name }: { shelfId: string; name: string }) =>
      updateShelf(shelfId, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHELVES_KEY }),
  });
}

export function useDeleteShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shelfId: string) => deleteShelf(shelfId),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHELVES_KEY }),
  });
}

export function useAddBookToShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shelfId, isbn }: { shelfId: string; isbn: string }) =>
      addBookToShelf(shelfId, isbn),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHELVES_KEY }),
  });
}

export function useRemoveBookFromShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shelfId, isbn }: { shelfId: string; isbn: string }) =>
      removeBookFromShelf(shelfId, isbn),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHELVES_KEY }),
  });
}
