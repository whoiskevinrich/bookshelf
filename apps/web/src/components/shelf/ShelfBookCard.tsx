import { BookCover } from "../BookCover";
import { Button } from "../ui/Button";
import type { ShelfEntry, ShelfStatus } from "../../lib/api-client";

// Stagger: cards animate in sequentially up to MAX_STAGGER_INDEX, then all share the same delay.
const MAX_STAGGER_INDEX = 9;
const STAGGER_STEP_MS = 50;

interface ShelfBookCardProps {
  entry: ShelfEntry;
  onMove: (isbn: string, status: ShelfStatus) => void;
  onRemove: (isbn: string) => void;
  isMoving?: boolean;
  isRemoving?: boolean;
  error?: string | null;
  /** Position in the list — drives the mount stagger animation. */
  staggerIndex?: number;
}

export function ShelfBookCard({
  entry,
  onMove,
  onRemove,
  isMoving,
  isRemoving,
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
    // animate-fade-up fires on mount only — stable isbn keys prevent remount on re-renders.
    // An entry leaving and re-entering (e.g. move mutation) will re-animate, which is desirable.
    <div
      className="group flex flex-col gap-1 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200 animate-fade-up"
      style={staggerStyle}
    >
      <div className="flex gap-3">
        <BookCover
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
          <div className="flex gap-3 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMove(isbn, targetStatus)}
              disabled={isMoving || isRemoving}
            >
              {isMoving ? "Moving…" : moveLabel}
            </Button>
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
