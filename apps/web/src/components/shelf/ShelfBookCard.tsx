import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { BookCover } from "../BookCover";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type { ShelfEntry, ShelfStatus, ReadingStatus, Shelf } from "../../lib/api-client";

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

// ── State pill icons (icon + label, never color alone — WCAG 1.4.1) ─────────

function PillCheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-2.5 h-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.5 8.5l1.75 1.75L11 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PillBookmarkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-2.5 h-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        d="M4 2.5h8a.5.5 0 01.5.5v10.25l-4.5-3-4.5 3V3a.5.5 0 01.5-.5z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PillBookIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-2.5 h-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M2.5 3.5h4a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 00-1.5-1.5h-4z" strokeLinejoin="round" />
      <path d="M13.5 3.5h-4A1.5 1.5 0 008 5v8a1.5 1.5 0 011.5-1.5h4z" strokeLinejoin="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-2.5 h-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2.5 2.5h4.8l6.2 6.2-4.8 4.8L2.5 7.3z" strokeLinejoin="round" />
      <circle cx="5.2" cy="5.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Icon + label chip over the cover. State is conveyed by icon+text, not color. */
function StatePill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
      {icon}
      {label}
    </span>
  );
}

const READING_LABEL: Record<ReadingStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Read",
};

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
            className="fixed z-[200] min-w-[160px] bg-paper-50 dark:bg-slate-800 border border-paper-400 dark:border-slate-700 rounded-lg shadow-lg py-1"
            style={{ top: pos.top, left: pos.left }}
          >
            {shelves.map((shelf) => {
              const checked = shelf.bookIds.includes(isbn);
              return (
                <label
                  key={shelf.shelfId}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-paper-200 dark:hover:bg-slate-700/60"
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
  const { isbn, owned, want, readingStatus, tags, book } = entry;
  const title = book?.title ?? isbn;
  const authors = book?.authors ?? [];

  const staggerStyle =
    staggerIndex !== undefined
      ? { animationDelay: `${Math.min(staggerIndex, MAX_STAGGER_INDEX) * STAGGER_STEP_MS}ms` }
      : undefined;

  const navigate = useNavigate();

  // The cover is a convenience click-target for the title link: every pointer type
  // goes to the book-detail view. The action overlay reveals on hover or keyboard
  // focus only — on touch, those actions (and remove) live in the detail view, so
  // a stray tap on a card can never fire a destructive action.
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div
      // Fixed-width column: covers vary in width (they share a height, not a width), so a
      // content-sized card made long titles widen the card and knock the metadata rows out
      // of alignment. A fixed width gives the row an even rhythm; the cover is centered
      // within it and the title slot below is height-reserved for two lines.
      className="group/card flex flex-col gap-2 shrink-0 w-[136px] animate-fade-up"
      style={staggerStyle}
    >
      {/* Cover + hover overlay — w-fit + mx-auto so the rounded corners and overlay hug the
          image exactly (not the wider column), and the cover sits centered in the column. */}
      <div
        className="relative rounded-lg overflow-hidden shadow-sm group-hover/card:shadow-xl transition-shadow duration-200 w-fit max-w-full mx-auto cursor-pointer"
        onClick={() => navigate(`/book/${isbn}`)}
      >
        <BookCover
          key={book?.coverUrl ?? "no-cover"}
          coverUrl={book?.coverUrl ?? null}
          title={title}
          authors={authors}
          className="h-[195px]"
        />

        {/* Action overlay — hover (mouse) or focus-within (keyboard) only.
            pointer-events follow visibility so the buttons can't be blind-tapped while hidden. */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-end pb-2
                     bg-gradient-to-t from-black/75 via-black/20 to-transparent
                     transition-opacity duration-200 opacity-0 pointer-events-none
                     group-hover/card:opacity-100 group-hover/card:pointer-events-auto
                     focus-within:opacity-100 focus-within:pointer-events-auto"
        >
          {/* Stop button clicks from bubbling to the cover's navigate handler. */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {/* One-directional quick action: wishlist → owned ("Mark as Owned").
                Wishlisting an owned book is the confusing direction — that lives in
                the book-detail view, not a card hover button. */}
            {want && (
              <OverlayButton
                onClick={() => onMove(isbn, "owned")}
                {...(!!(isMoving || isRemoving) ? { disabled: true } : {})}
                title={isMoving ? "Moving…" : "Mark as Owned"}
              >
                {isMoving ? <SpinIcon /> : <MoveIcon toStatus="owned" />}
              </OverlayButton>
            )}

            <ShelfPicker
              isbn={isbn}
              shelves={shelves}
              onAdd={(shelfId) => onAddToShelf(shelfId, isbn)}
              onRemove={(shelfId) => onRemoveFromShelf(shelfId, isbn)}
              disabled={isUpdatingShelves === true}
            />

            <OverlayButton
              onClick={() => setConfirmRemove(true)}
              {...(!!(isMoving || isRemoving) ? { disabled: true } : {})}
              title={isRemoving ? "Removing…" : "Remove from library"}
              danger
            >
              {isRemoving ? <SpinIcon /> : <TrashIcon />}
            </OverlayButton>
          </div>
        </div>

        {/* State pills — always visible, rendered above the overlay so the reveal
            doesn't hide them. Non-interactive: taps pass through to the cover. */}
        <div className="pointer-events-none absolute inset-0">
          {(owned || want) && (
            <div className="absolute top-1.5 left-1.5">
              {/* Owned/Wishlist are mutually exclusive — exactly one renders. Icon color
                  (green/red) reinforces the label; the text keeps it WCAG-safe. */}
              {owned ? (
                <StatePill
                  icon={
                    <span className="text-emerald-400">
                      <PillCheckIcon />
                    </span>
                  }
                  label="Owned"
                />
              ) : (
                <StatePill
                  icon={
                    <span className="text-red-400">
                      <PillBookmarkIcon />
                    </span>
                  }
                  label="Wishlist"
                />
              )}
            </div>
          )}
          {readingStatus && (
            <div className="absolute bottom-1.5 left-1.5">
              <StatePill icon={<PillBookIcon />} label={READING_LABEL[readingStatus]} />
            </div>
          )}
        </div>
      </div>

      {/* Book info */}
      <div className="px-0.5">
        <Link
          to={`/book/${isbn}`}
          className="block text-xs font-medium leading-snug line-clamp-2 min-h-[2.1rem] dark:text-white text-slate-900 hover:underline"
        >
          {title}
        </Link>
        {authors.length > 0 && (
          <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 truncate leading-tight">
            {authors.join(", ")}
          </p>
        )}
        <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 truncate">
          {isbn}
        </p>
        {tags.length > 0 && (
          <div className="mt-1 flex items-center gap-1">
            <span className="inline-flex min-w-0 items-center gap-0.5 rounded-full border border-paper-400 px-1.5 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <TagIcon />
              <span className="truncate">{tags[0]}</span>
            </span>
            {tags.length > 1 && (
              <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                +{tags.length - 1}
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-[10px] text-red-500 dark:text-red-400 leading-tight px-0.5">{error}</p>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove book?"
        message={`"${title}" will be removed from your library.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          setConfirmRemove(false);
          onRemove(isbn);
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}
