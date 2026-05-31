import { useState, useMemo } from "react";
import { AppHeader } from "../components/AppHeader";
import { useShelf, useAddToShelf, useMoveShelfEntry, useRemoveFromShelf, flattenShelf } from "../hooks/useShelf";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { BookSearch } from "../components/BookSearch";
import type { ShelfEntry, ShelfStatus } from "../lib/api-client";

interface ShelfSectionProps {
  title: string;
  entries: ShelfEntry[];
  emptyMessage: string;
  moveMutation: ReturnType<typeof useMoveShelfEntry>;
  removeMutation: ReturnType<typeof useRemoveFromShelf>;
}

function ShelfSection({ title, entries, emptyMessage, moveMutation, removeMutation }: ShelfSectionProps) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-4">
        {title} ({entries.length})
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyMessage}</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {entries.map((entry) => (
            <ShelfBookCard
              key={entry.isbn}
              entry={entry}
              onMove={(isbn, status) => moveMutation.mutate({ isbn, status })}
              onRemove={(isbn) => removeMutation.mutate(isbn)}
              isMoving={moveMutation.isPending && moveMutation.variables?.isbn === entry.isbn}
              isRemoving={removeMutation.isPending && removeMutation.variables === entry.isbn}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ShelfPage() {
  const [showSearch, setShowSearch] = useState(false);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useShelf();
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

  function handleAdd(isbn: string, status: ShelfStatus) {
    addMutation.mutate({ isbn, status });
    setShowSearch(false);
  }

  return (
    <div className="min-h-screen bg-white">
      <AppHeader activePage="shelf" />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">My Shelf</h1>
          <button
            onClick={() => setShowSearch((s) => !s)}
            className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            {showSearch ? "Cancel" : "Add a book"}
          </button>
        </div>

        {showSearch && (
          <div className="mb-8 p-4 border border-gray-100 rounded-xl">
            <BookSearch onAdd={handleAdd} isAdding={addMutation.isPending} />
          </div>
        )}

        {addMutation.isError && (
          <p className="text-sm text-red-500 mb-4">{addMutation.error.message}</p>
        )}

        {isLoading && <p className="text-sm text-gray-400">Loading your shelf…</p>}
        {isError && <p className="text-sm text-red-500">Failed to load shelf. Please refresh.</p>}

        {!isLoading && !isError && (
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
                <button
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-40"
                >
                  {isFetchingNextPage ? "Loading more…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
