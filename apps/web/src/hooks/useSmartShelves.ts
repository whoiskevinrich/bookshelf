import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchSmartShelves,
  createSmartShelf,
  renameSmartShelf,
  deleteSmartShelf,
  type SmartShelfRule,
  type SmartShelfWithCount,
} from "../lib/api-client";

const SMART_SHELVES_KEY = ["smart-shelves"] as const;

export function useSmartShelves() {
  return useQuery<SmartShelfWithCount[]>({
    queryKey: SMART_SHELVES_KEY,
    queryFn: fetchSmartShelves,
  });
}

function useSmartShelfMutation<TVars>(mutationFn: (v: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: SMART_SHELVES_KEY }),
  });
}

export function useCreateSmartShelf() {
  return useSmartShelfMutation(({ name, rule }: { name: string; rule: SmartShelfRule }) =>
    createSmartShelf(name, rule),
  );
}

export function useRenameSmartShelf() {
  return useSmartShelfMutation(({ smartShelfId, name }: { smartShelfId: string; name: string }) =>
    renameSmartShelf(smartShelfId, name),
  );
}

export function useDeleteSmartShelf() {
  return useSmartShelfMutation((smartShelfId: string) => deleteSmartShelf(smartShelfId));
}
