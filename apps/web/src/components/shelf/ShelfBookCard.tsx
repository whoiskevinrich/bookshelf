import { useState, useRef, useEffect } from "react";
import { BookCover } from "../BookCover";
import { Button } from "../ui/Button";
import type { ShelfEntry, ShelfStatus, Shelf } from "../../lib/api-client";

const MAX_STAGGER_INDEX = 9;
const STAGGER_STEP_MS = 50;

interface ShelfBookCardProps {
  entry: ShelfEntry;
  shelves: Shelf[];
  onMove: (isbn: string, status: ShelfStatus) => void;
  onRemove: (isbn: string) => void;
  onAddToShelf: (shelfId: string, isbn: string) => void;
  onRemoveFromShelf: (shelfId: string, isbn: string) => void;
  isMoving?: boolean;
  isRemoving?: boolean;
  isUpdatingShelves?: boolean;
  error?: string | null;
  staggerIndex?: number;
}

function StatusBadge({ status }: { status: ShelfStatus }) {
  return status === "owned" ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
      <span
        className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400"
        aria-hidden="true"
      />
      Owned
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400" aria-hidden="true" />
      Wishlist
    </span>
  );
}

function ShelfPicker({
  isbn,
  shelves,
  onAdd,
  onRemove,
  disabled,
}: {
  isbn: string;
  shelves: Shelf[];
  onAdd: (shelfId: string) => void;
  onRemove: (shelfId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (shelves.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        Shelves
      </Button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 min-w-[160px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md py-1">
          {shelves.map((shelf) => {
            const checked = shelf.bookIds.includes(isbn);
            return (
              <label
                key={shelf.shelfId}
                className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/60"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => (checked ? onRemove(shelf.shelfId) : onAdd(shelf.shelfId))}
                  className="accent-slate-700 dark:accent-slate-300 disabled:opacity-50"
                />
                <span className="truncate dark:text-white">{shelf.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ShelfBookCard({
  entry,
  shelves,
  onMove,
  onRemove,
  onAddToShelf,
  onRemoveFromShelf,
  isMoving,
  isRemoving,
  isUpdatingShelves,
  error,
  staggerIndex,
}: ShelfBookCardProps) {
  const { isbn, status, book } = entry;
  const title = book?.title ?? isbn;
  const authors = book?.authors ?? [];
  const targetStatus: ShelfStatus = status === "owned" ? "want" : "owned";
  const moveLabel = status === "owned" ? "Move to Wishlist" : "Mark as Owned";

  const staggerStyle =
    staggerIndex !== undefined
      ? { animationDelay: `${Math.min(staggerIndex, MAX_STAGGER_INDEX) * STAGGER_STEP_MS}ms` }
      : undefined;

  return (
    <div
      className="group flex flex-col gap-1 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200 animate-fade-up"
      style={staggerStyle}
    >
      <div className="flex gap-3">
        <BookCover
          key={book?.coverUrl ?? "no-cover"}
          coverUrl={book?.coverUrl ?? null}
          title={title}
          authors={authors}
          className="w-12 h-[72px] flex-shrink-0 rounded shadow-sm group-hover:scale-105 group-hover:shadow-md transition-all duration-200 ease-out"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight truncate dark:text-white">{title}</p>
          {authors.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {authors.join(", ")}
            </p>
          )}
          <div className="mt-1">
            <StatusBadge status={status} />
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMove(isbn, targetStatus)}
              disabled={isMoving || isRemoving}
            >
              {isMoving ? "Moving…" : moveLabel}
            </Button>
            <ShelfPicker
              isbn={isbn}
              shelves={shelves}
              onAdd={(shelfId) => onAddToShelf(shelfId, isbn)}
              onRemove={(shelfId) => onRemoveFromShelf(shelfId, isbn)}
              disabled={isUpdatingShelves === true}
            />
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onRemove(isbn)}
              disabled={isMoving || isRemoving}
            >
              {isRemoving ? "Removing…" : "Remove"}
            </Button>
          </div>
        </div>
      </div>
      {error && <p className="text-xs text-red-500 dark:text-red-400 pl-[60px]">{error}</p>}
    </div>
  );
}
