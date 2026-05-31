import { BookCover } from "../BookCover";
import type { ShelfEntry, ShelfStatus } from "../../lib/api-client";

interface ShelfBookCardProps {
  entry: ShelfEntry;
  onMove: (isbn: string, status: ShelfStatus) => void;
  onRemove: (isbn: string) => void;
  isMoving?: boolean;
  isRemoving?: boolean;
}

export function ShelfBookCard({ entry, onMove, onRemove, isMoving, isRemoving }: ShelfBookCardProps) {
  const { isbn, status, book } = entry;
  const title = book?.title ?? isbn;
  const authors = book?.authors ?? [];
  const targetStatus: ShelfStatus = status === "owned" ? "want" : "owned";
  const moveLabel = status === "owned" ? "Move to Wishlist" : "Mark as Owned";

  return (
    <div className="flex gap-3 group">
      <BookCover
        coverUrl={book?.coverUrl ?? null}
        title={title}
        className="w-12 h-[72px] flex-shrink-0 rounded shadow-sm"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight truncate">{title}</p>
        {authors.length > 0 && (
          <p className="text-xs text-gray-500 truncate">{authors.join(", ")}</p>
        )}
        <div className="flex gap-3 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onMove(isbn, targetStatus)}
            disabled={isMoving || isRemoving}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
          >
            {isMoving ? "Moving…" : moveLabel}
          </button>
          <button
            onClick={() => onRemove(isbn)}
            disabled={isMoving || isRemoving}
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
          >
            {isRemoving ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
