import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchShelfEntry,
  updateShelfAttributes,
  updateShelfTags,
  updateShelfNotes,
  fetchTags,
  type EditionFormat,
  type EntryAttributes,
  type ShelfEntry,
  type ShelfEntryDetail,
  type TagCount,
} from "../lib/api-client";

function bookKey(isbn: string) {
  return ["book", isbn] as const;
}

const TAGS_KEY = ["tags"] as const;

export function useBookEntry(isbn: string) {
  return useQuery<ShelfEntryDetail>({
    queryKey: bookKey(isbn),
    queryFn: () => fetchShelfEntry(isbn),
    enabled: !!isbn,
  });
}

export function useTags(enabled = true) {
  return useQuery<TagCount[]>({ queryKey: TAGS_KEY, queryFn: fetchTags, enabled });
}

/**
 * Optimistically patch the cached book entry, run the mutation, then invalidate
 * the entry + the shelf list (and tags, when relevant) so everything reconciles.
 */
function useEntryMutation<TVars>(
  isbn: string,
  mutationFn: (vars: TVars) => Promise<ShelfEntry>,
  applyOptimistic: (prev: ShelfEntry, vars: TVars) => ShelfEntry,
  alsoInvalidateTags = false,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars) => {
      await qc.cancelQueries({ queryKey: bookKey(isbn) });
      const prev = qc.getQueryData<ShelfEntry>(bookKey(isbn));
      if (prev) qc.setQueryData<ShelfEntry>(bookKey(isbn), applyOptimistic(prev, vars));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(bookKey(isbn), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: bookKey(isbn) });
      void qc.invalidateQueries({ queryKey: ["shelf"] });
      if (alsoInvalidateTags) void qc.invalidateQueries({ queryKey: TAGS_KEY });
    },
  });
}

export function useUpdateBookAttributes(isbn: string) {
  return useEntryMutation<EntryAttributes>(
    isbn,
    (attrs) => updateShelfAttributes(isbn, attrs),
    (prev, attrs) => {
      // Mirror the server's mutual-exclusivity rule so the UI doesn't flash a bad state.
      const next = { ...prev, ...attrs };
      if (attrs.owned === true) next.want = false;
      if (attrs.want === true) {
        next.owned = false;
        // Mirror the server's copies reset on owned→want (BOOKSHELF-60).
        next.copies = 1;
      }
      return next;
    },
  );
}

export function useUpdateBookCopies(isbn: string) {
  return useEntryMutation<number>(
    isbn,
    (copies) => updateShelfAttributes(isbn, { copies }),
    (prev, copies) => ({ ...prev, copies }),
  );
}

/** Set or clear this edition's format label (BOOKSHELF-91); null clears it. */
export function useUpdateBookFormat(isbn: string) {
  return useEntryMutation<EditionFormat | null>(
    isbn,
    (format) => updateShelfAttributes(isbn, { format }),
    (prev, format) => ({ ...prev, format }),
  );
}

/**
 * Ungroup (`grouped:false`) / regroup (`grouped:true`) this edition (BOOKSHELF-91).
 * Membership of the edition set is server-derived, so there's no meaningful
 * optimistic patch to the current entry — `onSettled` refetches the detail (with
 * its `editions`) to reconcile.
 */
export function useUpdateBookGrouping(isbn: string) {
  return useEntryMutation<boolean>(
    isbn,
    (grouped) => updateShelfAttributes(isbn, { grouped }),
    (prev) => prev,
  );
}

/** Mirror the server's tag normalization so the optimistic UI doesn't flash a raw value. */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (t) seen.add(t);
  }
  return [...seen].sort();
}

export function useUpdateBookTags(isbn: string) {
  return useEntryMutation<string[]>(
    isbn,
    (tags) => updateShelfTags(isbn, tags),
    (prev, tags) => ({ ...prev, tags: normalizeTags(tags) }),
    true,
  );
}

export function useUpdateBookNotes(isbn: string) {
  return useEntryMutation<string | null>(
    isbn,
    (notes) => updateShelfNotes(isbn, notes),
    (prev, notes) => ({ ...prev, notes }),
  );
}
