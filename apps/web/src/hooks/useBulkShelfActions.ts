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
  const [result, setResult] = useState<BulkResult | null>(null);
  const lastFnRef = useRef<((isbn: string) => Promise<unknown>) | null>(null);

  const run = useCallback(
    async (op: BulkOp, isbns: string[], fn: (isbn: string) => Promise<unknown>) => {
      setPending(true);
      lastFnRef.current = fn;
      const settled = await Promise.allSettled(isbns.map((isbn) => fn(isbn)));
      const failed = isbns.filter((_, i) => settled[i]!.status === "rejected");
      setResult({ op, total: isbns.length, failed });
      setPending(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["shelf"] }),
        qc.invalidateQueries({ queryKey: ["shelves"] }),
      ]);
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
        const existing = byIsbn.get(isbn)?.tags ?? [];
        const next = existing.includes(tag) ? existing : [...existing, tag];
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
