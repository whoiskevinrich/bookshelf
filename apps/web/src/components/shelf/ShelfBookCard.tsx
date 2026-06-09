import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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

// Move-action icon: wishlist bookmark (owned→want) or owned checkmark (want→owned)
function MoveIcon({ toStatus }: { toStatus: ShelfStatus }) {
  if (toStatus === "want") {
    // Move to Wishlist — bookmark outline
    return (
      <svg
        viewBox="0 0 16 16"
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path
          d="M4 2.5h8a.5.5 0 01.5.5v10.25l-4.5-3-4.5 3V3a.5.5 0 01.5-.5z"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // Mark as Owned — checkmark circle
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.5 8.5l1.75 1.75L11 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * ShelfPicker dropdown rendered as a portal so it escapes the card's stacking
 * context (created by the fade-up animation) and renders above all sibling cards.
 */
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
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  }

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (
        dropdownRef.current?.contains(e.target as Node) ||
        containerRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Close on scroll so the fixed dropdown doesn't drift from its anchor
  useEffect(() => {
    if (!open) return;
    function onScroll() {
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [open]);

  if (shelves.length === 0) return null;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <Button variant="ghost" size="sm" onClick={toggle}>
        Shelves
      </Button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[200] min-w-[160px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1"
            style={{ top: pos.top, left: pos.left }}
          >
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
          </div>,
          document.body,
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
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
            {isbn}
          </p>
          <div className="mt-1">
            <StatusBadge status={status} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* Move-to icon button */}
            <button
              type="button"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white disabled:opacity-40 transition-colors"
              onClick={() => onMove(isbn, targetStatus)}
              disabled={isMoving || isRemoving}
              aria-label={isMoving ? "Moving…" : moveLabel}
              title={isMoving ? "Moving…" : moveLabel}
            >
              {isMoving ? (
                <svg
                  viewBox="0 0 16 16"
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  role="status"
                  aria-label="Moving…"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    strokeDasharray="28"
                    strokeDashoffset="10"
                    strokeOpacity="0.3"
                  />
                  <path d="M14 8a6 6 0 00-6-6" strokeLinecap="round" />
                </svg>
              ) : (
                <MoveIcon toStatus={targetStatus} />
              )}
            </button>

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
