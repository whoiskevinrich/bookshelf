import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useShelf, useMoveShelfEntry, useRemoveFromShelf, flattenShelf } from "../hooks/useShelf";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";

export function WishlistPage() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useShelf({
    status: "want",
  });
  const moveMutation = useMoveShelfEntry();
  const removeMutation = useRemoveFromShelf();

  const want = useMemo(() => flattenShelf(data), [data]);

  return (
    <div className="min-h-screen bg-white">
      <AppHeader activePage="wishlist" />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-8">Wishlist</h1>

        {isLoading && <p className="text-sm text-gray-400">Loading wishlist…</p>}
        {isError && <p className="text-sm text-red-500">Failed to load wishlist. Please refresh.</p>}

        {!isLoading && !isError && (
          <>
            {want.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400 mb-4">Your wishlist is empty.</p>
                <Link
                  to="/shelf"
                  className="text-sm text-gray-900 underline underline-offset-2"
                >
                  Go to your shelf to add books
                </Link>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {want.map((entry) => (
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

            {hasNextPage && (
              <div className="text-center mt-8">
                <button
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-40"
                >
                  {isFetchingNextPage ? "Loading more…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
