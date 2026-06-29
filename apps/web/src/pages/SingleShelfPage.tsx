import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { ShelfEmptyState } from "../components/shelf/ShelfEmptyState";
import { ShelfNameEditor } from "../components/shelf/ShelfNameEditor";
import { DeleteShelfDialog } from "../components/shelf/DeleteShelfDialog";
import { Button } from "../components/ui/Button";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import {
  useShelves,
  useSingleShelfBooks,
  useAddBookToShelf,
  useRemoveBookFromShelf,
} from "../hooks/useShelves";
import { useMoveShelfEntry, useRemoveFromShelf } from "../hooks/useShelf";
import { track } from "../lib/analytics";
import type { ShelfStatus } from "../lib/api-client";

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 12L6 8l4-4" />
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
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" />
    </svg>
  );
}

export function SingleShelfPage() {
  const { shelfId } = useParams<{ shelfId: string }>();
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);

  const shelvesQuery = useShelves();
  const booksQuery = useSingleShelfBooks(shelfId ?? "");

  const moveMutation = useMoveShelfEntry();
  const removeMutation = useRemoveFromShelf();
  const addToShelfMutation = useAddBookToShelf();
  const removeFromShelfMutation = useRemoveBookFromShelf();

  const shelf = shelvesQuery.data?.find((s) => s.shelfId === shelfId);
  const books = booksQuery.data ?? [];

  const isLoading = shelvesQuery.isLoading || booksQuery.isLoading;
  const isError = shelvesQuery.isError || booksQuery.isError;
  const shelves = shelvesQuery.data ?? [];

  // Track page view once shelf is known.
  useEffect(() => {
    if (shelfId) track("shelf_opened", { shelfId });
  }, [shelfId]);

  // Update document title when shelf name is available.
  useEffect(() => {
    if (shelf) document.title = `${shelf.name} — Bookshelf`;
    return () => {
      document.title = "Bookshelf";
    };
  }, [shelf]);

  const bookCount = books.length;
  const bookLabel = bookCount === 1 ? "1 book" : `${bookCount} books`;

  // Reset to the first page when the shelf or page size changes.
  useEffect(() => {
    setPage(0);
  }, [shelfId, pageSize]);

  const pageCount = Math.max(1, Math.ceil(bookCount / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * pageSize;
  const pageBooks = books.slice(pageStart, pageStart + pageSize);
  const rangeStart = bookCount === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, bookCount);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <AppHeader />

      {/* Breadcrumb */}
      <div className="border-b border-slate-100 dark:border-slate-800 px-4 sm:px-6 py-3">
        <Link
          to="/shelf"
          className="text-sm text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white flex items-center gap-1.5 w-fit"
        >
          <ChevronLeftIcon />
          My Library
        </Link>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-8">
        {isLoading && (
          <div className="pt-8">
            <ShelfSkeleton sections={1} />
          </div>
        )}

        {isError && !isLoading && (
          <div className="pt-8">
            <ShelfErrorState
              message="Couldn't load this shelf."
              onRetry={() => {
                void shelvesQuery.refetch();
                void booksQuery.refetch();
              }}
              isRetrying={shelvesQuery.isFetching || booksQuery.isFetching}
            />
          </div>
        )}

        {/* Shelf not found */}
        {!isLoading && !isError && !shelf && (
          <div className="pt-16 text-center">
            <p className="text-slate-500 dark:text-zinc-400 mb-4">This shelf doesn&apos;t exist.</p>
            <Link to="/shelf" className="text-sm text-slate-900 dark:text-white underline">
              Back to My Library
            </Link>
          </div>
        )}

        {!isLoading && !isError && shelf && (
          <>
            {/* Page header */}
            <div className="flex items-center gap-3 pt-6 pb-4">
              <ShelfNameEditor
                shelfId={shelf.shelfId}
                name={shelf.name}
                className="text-xl font-semibold text-slate-900 dark:text-white"
              />
              <span className="shrink-0 text-xs text-slate-500 dark:text-zinc-400 bg-slate-200 dark:bg-slate-800 rounded-full px-2 py-0.5">
                {bookLabel}
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                aria-label={`Delete shelf ${shelf.name}`}
                className="shrink-0 flex items-center gap-1.5"
              >
                <TrashIcon />
                Delete shelf
              </Button>
            </div>

            {bookCount === 0 ? (
              <ShelfEmptyState
                onAdd={() => navigate("/shelf")}
                heading="This shelf is empty."
                body="Add books from your library to get started."
                cta="Go to library →"
              />
            ) : (
              <>
                {/* Sticky pagination toolbar — stays in view while the grid scrolls. */}
                <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-slate-100 bg-white/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Show</span>
                  <SegmentedControl<string>
                    label="Books per page"
                    value={String(pageSize)}
                    options={[
                      { value: "20", label: "20" },
                      { value: "50", label: "50" },
                      { value: "100", label: "100" },
                    ]}
                    onChange={(v) => setPageSize(Number(v))}
                  />
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                    {rangeStart}–{rangeEnd} of {bookCount}
                  </span>
                  {pageCount > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={safePage === 0}
                      >
                        Prev
                      </Button>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {safePage + 1} / {pageCount}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                        disabled={safePage >= pageCount - 1}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-4">
                  {pageBooks.map((entry, index) => (
                    <ShelfBookCard
                      key={entry.isbn}
                      entry={entry}
                      shelves={shelves}
                      staggerIndex={index}
                      onMove={(isbn, status: ShelfStatus) => moveMutation.mutate({ isbn, status })}
                      onRemove={(isbn) => removeMutation.mutate(isbn)}
                      onAddToShelf={(sid, isbn) =>
                        addToShelfMutation.mutate({ shelfId: sid, isbn })
                      }
                      onRemoveFromShelf={(sid, isbn) =>
                        removeFromShelfMutation.mutate({ shelfId: sid, isbn })
                      }
                      isMoving={
                        moveMutation.isPending && moveMutation.variables?.isbn === entry.isbn
                      }
                      isRemoving={
                        removeMutation.isPending && removeMutation.variables === entry.isbn
                      }
                      isUpdatingShelves={
                        (addToShelfMutation.isPending || removeFromShelfMutation.isPending) &&
                        (addToShelfMutation.variables?.isbn === entry.isbn ||
                          removeFromShelfMutation.variables?.isbn === entry.isbn)
                      }
                      error={
                        moveMutation.isError && moveMutation.variables?.isbn === entry.isbn
                          ? "Couldn't move book — please try again."
                          : removeMutation.isError && removeMutation.variables === entry.isbn
                            ? "Couldn't remove book — please try again."
                            : null
                      }
                    />
                  ))}
                </div>
              </>
            )}

            <DeleteShelfDialog
              shelf={shelf}
              open={showDeleteDialog}
              onClose={() => setShowDeleteDialog(false)}
              onDeleted={() => navigate("/shelf", { replace: true })}
            />
          </>
        )}
      </main>
    </div>
  );
}
