import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  removeFromShelf,
  updateShelfStatus,
  updateShelfTags,
  addBookToShelf,
  type ShelfEntry,
  type ShelfStatus,
} from "../lib/api-client";

export type BulkOp = "delete" | "move-owned" | "move-want" | "add-tag" | "add-to-shelf";

export interface BulkResult {
  op: BulkOp;
  total: number;
  failed: string[];
}

/**
 * Client-side fan-out over the existing single-item shelf routes (BOOKSHELF-59,
 * docs/decisions.md) — Promise.allSettled per ISBN so a batch reports per-item
 * results instead of failing (or silently dropping) the whole selection. One cache
 * invalidation per batch on settle, not per item — simpler than per-item optimistic
 * rollback and still surfaces partial failures via `result`.
 */
export function useBulkShelfActions() {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  // A ref (not just the `pending` state) guards re-entrancy: two `run()` calls close
  // together would otherwise both pass the check before either state update lands.
  const pendingRef = useRef(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const lastFnRef = useRef<((isbn: string) => Promise<unknown>) | null>(null);

  const run = useCallback(
    async (op: BulkOp, isbns: string[], fn: (isbn: string) => Promise<unknown>) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      lastFnRef.current = fn;
      try {
        const settled = await Promise.allSettled(isbns.map((isbn) => fn(isbn)));
        const failed: string[] = [];
        settled.forEach((s, i) => {
          if (s.status === "rejected") {
            failed.push(isbns[i]!);
            console.error(`[useBulkShelfActions] ${op} failed for ${isbns[i]}`, s.reason);
          }
        });
        setResult({ op, total: isbns.length, failed });
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["shelf"] }),
          qc.invalidateQueries({ queryKey: ["shelves"] }),
        ]);
      } catch (err) {
        console.error(`[useBulkShelfActions] ${op} batch failed unexpectedly`, err);
      } finally {
        // Cleared after invalidation settles (not right after the fan-out) so the
        // action bar's buttons stay disabled until the refreshed data has landed.
        pendingRef.current = false;
        setPending(false);
      }
    },
    [qc],
  );

  const retry = useCallback(() => {
    if (!result || result.failed.length === 0 || !lastFnRef.current) return;
    void run(result.op, result.failed, lastFnRef.current);
  }, [result, run]);

  const dismiss = useCallback(() => setResult(null), []);

  const bulkDelete = useCallback((isbns: string[]) => run("delete", isbns, removeFromShelf), [run]);

  const bulkMove = useCallback(
    (isbns: string[], status: ShelfStatus) =>
      run(status === "owned" ? "move-owned" : "move-want", isbns, (isbn) =>
        updateShelfStatus(isbn, status),
      ),
    [run],
  );

  const bulkAddTag = useCallback(
    (isbns: string[], tag: string, entries: ShelfEntry[]) => {
      const byIsbn = new Map(entries.map((e) => [e.isbn, e]));
      return run("add-tag", isbns, (isbn) => {
        const entry = byIsbn.get(isbn);
        // No local copy of this book's current tags — refuse instead of merging
        // against an empty list, which would replace (not append to) its real
        // tags once sent (updateShelfTags is a full replace, not additive).
        if (!entry) return Promise.reject(new Error(`No cached entry for ${isbn}`));
        const next = entry.tags.includes(tag) ? entry.tags : [...entry.tags, tag];
        return updateShelfTags(isbn, next);
      });
    },
    [run],
  );

  const bulkAddToShelf = useCallback(
    (isbns: string[], shelfId: string) =>
      run("add-to-shelf", isbns, (isbn) => addBookToShelf(shelfId, isbn)),
    [run],
  );

  return { pending, result, retry, dismiss, bulkDelete, bulkMove, bulkAddTag, bulkAddToShelf };
}
