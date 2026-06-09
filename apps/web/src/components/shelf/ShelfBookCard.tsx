import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { BookCover } from "../BookCover";
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

// ── Icons ──────────────────────────────────────────────────────────────────

function MoveIcon({ toStatus }: { toStatus: ShelfStatus }) {
  if (toStatus === "want") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="w-3.5 h-3.5"
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
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
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

function LayersIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2 5.5l6-3 6 3-6 3-6-3z" strokeLinejoin="round" />
      <path d="M2 8.5l6 3 6-3M2 11.5l6 3 6-3" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        d="M2.5 4h11M6 4V2.5h4V4M5 4l.5 9h5l.5-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      role="status"
      aria-label="Working…"
    >
      <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10" strokeOpacity="0.3" />
      <path d="M14 8a6 6 0 00-6-6" strokeLinecap="round" />
    </svg>
  );
}

// ── Overlay action button ──────────────────────────────────────────────────

function OverlayButton({
  onClick,
  disabled,
  title,
  danger = false,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded-full transition-colors disabled:opacity-40 ${
        danger
          ? "bg-black/30 hover:bg-red-500/80 text-white"
          : "bg-black/30 hover:bg-white/25 text-white"
      }`}
    >
      {children}
    </button>
  );
}

// ── ShelfPicker — portal dropdown with icon trigger ────────────────────────

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

  // Flip dropdown above the trigger if it overflows the viewport bottom.
  useEffect(() => {
    if (!open || !dropdownRef.current || !containerRef.current) return;
    const dropRect = dropdownRef.current.getBoundingClientRect();
    if (dropRect.bottom > window.innerHeight) {
      const triggerRect = containerRef.current.getBoundingClientRect();
      setPos({ top: triggerRect.top - dropRect.height - 4, left: triggerRect.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (
        dropdownRef.current?.contains(e.target as Node) ||
        containerRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

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
    <div ref={containerRef} className="inline-flex">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        title="Manage shelves"
        aria-label="Manage shelves"
        className="p-1.5 rounded-full bg-black/30 hover:bg-white/25 text-white transition-colors disabled:opacity-40"
      >
        <LayersIcon />
      </button>
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

// ── ShelfBookCard ──────────────────────────────────────────────────────────

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
      className="group/card flex flex-col gap-2 shrink-0 w-[130px] animate-fade-up"
      style={staggerStyle}
    >
      {/* Cover + hover overlay */}
      <div className="relative rounded-lg overflow-hidden shadow-sm group-hover/card:shadow-xl transition-shadow duration-200">
        <BookCover
          key={book?.coverUrl ?? "no-cover"}
          coverUrl={book?.coverUrl ?? null}
          title={title}
          authors={authors}
          className="w-full aspect-[2/3]"
        />

        {/* Status dot — always visible */}
        <div
          className={`absolute top-1.5 left-1.5 w-2 h-2 rounded-full ring-1 ring-black/20 ${
            status === "owned" ? "bg-emerald-400" : "bg-sky-400"
          }`}
          title={status === "owned" ? "Owned" : "Wishlist"}
          aria-label={status === "owned" ? "Owned" : "Wishlist"}
        />

        {/* Action overlay — hover (mouse) or focus-within (keyboard/touch) */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-end pb-2
                     bg-gradient-to-t from-black/75 via-black/20 to-transparent
                     opacity-0 group-hover/card:opacity-100 focus-within:opacity-100
                     transition-opacity duration-200"
        >
          <div className="flex items-center gap-1">
            <OverlayButton
              onClick={() => onMove(isbn, targetStatus)}
              {...(!!(isMoving || isRemoving) ? { disabled: true } : {})}
              title={isMoving ? "Moving…" : moveLabel}
            >
              {isMoving ? <SpinIcon /> : <MoveIcon toStatus={targetStatus} />}
            </OverlayButton>

            <ShelfPicker
              isbn={isbn}
              shelves={shelves}
              onAdd={(shelfId) => onAddToShelf(shelfId, isbn)}
              onRemove={(shelfId) => onRemoveFromShelf(shelfId, isbn)}
              disabled={isUpdatingShelves === true}
            />

            <OverlayButton
              onClick={() => onRemove(isbn)}
              {...(!!(isMoving || isRemoving) ? { disabled: true } : {})}
              title={isRemoving ? "Removing…" : "Remove from library"}
              danger
            >
              {isRemoving ? <SpinIcon /> : <TrashIcon />}
            </OverlayButton>
          </div>
        </div>
      </div>

      {/* Book info */}
      <div className="px-0.5">
        <p className="text-xs font-medium leading-snug line-clamp-2 dark:text-white text-slate-900">
          {title}
        </p>
        {authors.length > 0 && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate leading-tight">
            {authors.join(", ")}
          </p>
        )}
        <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 truncate">
          {isbn}
        </p>
      </div>

      {error && (
        <p className="text-[10px] text-red-500 dark:text-red-400 leading-tight px-0.5">{error}</p>
      )}
    </div>
  );
}
