import { useState } from "react";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { inputClass } from "../../lib/form-styles";
import type { Shelf, ShelfStatus } from "../../lib/api-client";
import type { BulkResult } from "../../hooks/useBulkShelfActions";

const OP_LABEL: Record<BulkResult["op"], string> = {
  delete: "Deleted",
  "move-owned": "Moved to Owned",
  "move-want": "Moved to Wishlist",
  "add-tag": "Tagged",
  "add-to-shelf": "Added to shelf",
};

function AddToShelfPicker({
  shelves,
  disabled,
  onPick,
}: {
  shelves: Shelf[];
  disabled: boolean;
  onPick: (shelfId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (shelves.length === 0) return null;
  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        Add to shelf…
      </Button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-[180px] rounded-lg border border-paper-400 bg-paper-50 py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {shelves.map((shelf) => (
            <button
              key={shelf.shelfId}
              type="button"
              onClick={() => {
                onPick(shelf.shelfId);
                setOpen(false);
              }}
              className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-paper-200 dark:text-white dark:hover:bg-slate-700/60"
            >
              {shelf.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddTagField({ disabled, onAdd }: { disabled: boolean; onAdd: (tag: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const tag = value.trim();
        if (!tag) return;
        onAdd(tag);
        setValue("");
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add tag…"
        maxLength={50}
        disabled={disabled}
        aria-label="Tag to add to selected books"
        className={`w-28 text-sm ${inputClass}`}
      />
      <Button type="submit" variant="secondary" size="sm" disabled={disabled || !value.trim()}>
        Add tag
      </Button>
    </form>
  );
}

interface BulkActionBarProps {
  selectedCount: number;
  visibleCount: number;
  shelves: Shelf[];
  pending: boolean;
  result: BulkResult | null;
  onSelectAll: () => void;
  onClear: () => void;
  onConfirmDelete: () => void;
  onMove: (status: ShelfStatus) => void;
  onAddToShelf: (shelfId: string) => void;
  onAddTag: (tag: string) => void;
  onRetry: () => void;
  onDismissResult: () => void;
}

/** Sticky bulk-action toolbar shown while the shelf page is in Manage mode (BOOKSHELF-59). */
export function BulkActionBar({
  selectedCount,
  visibleCount,
  shelves,
  pending,
  result,
  onSelectAll,
  onClear,
  onConfirmDelete,
  onMove,
  onAddToShelf,
  onAddTag,
  onRetry,
  onDismissResult,
}: BulkActionBarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasSelection = selectedCount > 0;

  return (
    <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-paper-300 bg-paper-100/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-slate-700 dark:bg-slate-900/95">
      <div role="group" aria-label="Manage library" className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium dark:text-white">{selectedCount} selected</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={visibleCount === 0 || selectedCount === visibleCount}
        >
          Select all
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={!hasSelection}>
          Clear
        </Button>

        <span
          className="mx-1 hidden h-5 w-px bg-paper-400 dark:bg-slate-700 sm:block"
          aria-hidden="true"
        />

        <Button
          variant="secondary"
          size="sm"
          disabled={!hasSelection || pending}
          onClick={() => onMove("owned")}
        >
          Move to Owned
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasSelection || pending}
          onClick={() => onMove("want")}
        >
          Move to Wishlist
        </Button>
        <AddToShelfPicker
          shelves={shelves}
          disabled={!hasSelection || pending}
          onPick={onAddToShelf}
        />
        <AddTagField disabled={!hasSelection || pending} onAdd={onAddTag} />

        <div className="ml-auto">
          <Button
            variant="danger"
            size="sm"
            disabled={!hasSelection || pending}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {result && (
        // aria-live so the result — including a failure — reaches screen-reader
        // users too, not just the visual Callout.
        <div aria-live="polite" role="status">
          <Callout
            title={
              result.failed.length === 0
                ? `${OP_LABEL[result.op]} ${result.total} of ${result.total} books`
                : `${OP_LABEL[result.op]} ${result.total - result.failed.length} of ${result.total} books`
            }
            onDismiss={onDismissResult}
            dismissLabel="Dismiss result"
            {...(result.failed.length > 0
              ? {
                  actions: (
                    <Button variant="secondary" size="sm" onClick={onRetry} disabled={pending}>
                      Retry {result.failed.length} failed
                    </Button>
                  ),
                }
              : {})}
          >
            {result.failed.length > 0
              ? `${result.failed.length} book${result.failed.length === 1 ? "" : "s"} couldn't be updated.`
              : "All done."}
          </Callout>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${selectedCount} book${selectedCount === 1 ? "" : "s"}?`}
        message="This removes the selected books from your library. This can't be undone."
        confirmLabel="Delete"
        destructive
        pending={pending}
        onConfirm={() => {
          setConfirmDelete(false);
          onConfirmDelete();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
