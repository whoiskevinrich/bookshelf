import { useState, useMemo } from "react";
import { AppHeader } from "../components/AppHeader";
import {
  useShelf,
  useAddToShelf,
  useMoveShelfEntry,
  useRemoveFromShelf,
  flattenShelf,
} from "../hooks/useShelf";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { ShelfEmptyState } from "../components/shelf/ShelfEmptyState";
import { BookSearch } from "../components/BookSearch";
import { Button } from "../components/ui/Button";
import type { ShelfEntry, ShelfStatus, BookSearchResult } from "../lib/api-client";

interface ShelfSectionProps {
  title: string;
  entries: ShelfEntry[];
  emptyMessage: string;
  moveMutation: ReturnType<typeof useMoveShelfEntry>;
  removeMutation: ReturnType<typeof useRemoveFromShelf>;
}

function ShelfSection({
  title,
  entries,
  emptyMessage,
  moveMutation,
  removeMutation,
}: ShelfSectionProps) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0">
          {title}
        </h2>
        <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-800 rounded-full px-2 py-0.5">
          {entries.length}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {entries.map((entry, index) => (
            <ShelfBookCard
              key={entry.isbn}
              entry={entry}
              staggerIndex={index}
              onMove={(isbn, status) => moveMutation.mutate({ isbn, status })}
              onRemove={(isbn) => removeMutation.mutate(isbn)}
              isMoving={moveMutation.isPending && moveMutation.variables?.isbn === entry.isbn}
              isRemoving={removeMutation.isPending && removeMutation.variables === entry.isbn}
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
      )}
    </section>
  );
}

export function ShelfPage() {
  const [showSearch, setShowSearch] = useState(false);

  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useShelf();
  const addMutation = useAddToShelf();
  const moveMutation = useMoveShelfEntry();
  const removeMutation = useRemoveFromShelf();

  const { owned, want } = useMemo(() => {
    const entries = flattenShelf(data);
    return entries.reduce(
      (acc, e) => {
        acc[e.status === "owned" ? "owned" : "want"].push(e);
        return acc;
      },
      { owned: [] as ShelfEntry[], want: [] as ShelfEntry[] },
    );
  }, [data]);

  function handleOpenSearch() {
    setShowSearch(true);
  }

  function handleAdd(isbn: string, status: ShelfStatus, book: BookSearchResult) {
    addMutation.mutate({ isbn, status, book });
    setShowSearch(false);
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold dark:text-white">My Shelf</h1>
          <Button
            variant="app"
            onClick={() => (showSearch ? setShowSearch(false) : handleOpenSearch())}
          >
            {showSearch ? "Cancel" : "Add a book"}
          </Button>
        </div>

        {showSearch && (
          <div className="mb-8 p-4 border border-slate-100 dark:border-slate-700 rounded-xl">
            <BookSearch onAdd={handleAdd} isAdding={addMutation.isPending} />
          </div>
        )}

        {addMutation.isError && (
          <p className="text-sm text-red-500 mb-4">
            Couldn't add book — {addMutation.error.message}
          </p>
        )}

        {isLoading && <ShelfSkeleton />}

        {isError && !isLoading && (
          <ShelfErrorState onRetry={() => void refetch()} isRetrying={isFetching} />
        )}

        {!isLoading &&
          !isError &&
          (owned.length === 0 && want.length === 0 ? (
            <ShelfEmptyState onAdd={handleOpenSearch} />
          ) : (
            <div className="space-y-10">
              <ShelfSection
                title="Owned"
                entries={owned}
                emptyMessage="No books owned yet. Add one above!"
                moveMutation={moveMutation}
                removeMutation={removeMutation}
              />
              <ShelfSection
                title="Want to Read"
                entries={want}
                emptyMessage="No books on your wishlist. Add one above!"
                moveMutation={moveMutation}
                removeMutation={removeMutation}
              />

              {hasNextPage && (
                <div className="text-center">
                  <Button
                    variant="ghost"
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? "Loading more…" : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          ))}
      </main>
    </div>
  );
}
