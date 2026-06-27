import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useDeleteShelf } from "../../hooks/useShelves";
import { track } from "../../lib/analytics";
import { Button } from "../ui/Button";
import type { Shelf } from "../../lib/api-client";

interface DeleteShelfDialogProps {
  shelf: Shelf;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteShelfDialog({ shelf, open, onClose, onDeleted }: DeleteShelfDialogProps) {
  const deleteMutation = useDeleteShelf();
  const bookCount = shelf.bookIds.length;

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleDelete() {
    deleteMutation.mutate(shelf.shelfId, {
      onSuccess: () => {
        track("shelf_deleted", { shelfId: shelf.shelfId, bookCount });
        onDeleted();
      },
      onError: () => {
        onClose();
      },
    });
  }

  const bookLabel =
    bookCount === 0 ? "no books" : bookCount === 1 ? "1 book" : `${bookCount} books`;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-shelf-title"
        aria-describedby="delete-shelf-body"
        className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-sm p-6"
      >
        <h2
          id="delete-shelf-title"
          className="text-base font-semibold text-slate-900 dark:text-white mb-3 truncate"
        >
          Delete &ldquo;{shelf.name}&rdquo;?
        </h2>
        <p id="delete-shelf-body" className="text-sm text-slate-500 dark:text-zinc-400 mb-6">
          This shelf has <strong>{bookLabel}</strong>. The books will remain in your library — only
          the shelf is removed.
        </p>
        <div className="flex justify-end gap-2">
          <Button autoFocus variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Deleting…" : "Delete shelf"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
