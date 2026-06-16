import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useShelf, useMoveShelfEntry, useRemoveFromShelf, flattenShelf } from "../hooks/useShelf";
import { useShelves, useAddBookToShelf, useRemoveBookFromShelf } from "../hooks/useShelves";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { MobileScanHint } from "../components/shelf/MobileScanHint";
import { Button } from "../components/ui/Button";

export function WishlistPage() {
  const shelfQuery = useShelf({ status: "want" });
  const shelvesQuery = useShelves();
  const moveMutation = useMoveShelfEntry();
  const removeMutation = useRemoveFromShelf();
  const addToShelfMutation = useAddBookToShelf();
  const removeFromShelfMutation = useRemoveBookFromShelf();

  const want = useMemo(() => flattenShelf(shelfQuery.data), [shelfQuery.data]);
  const shelves = shelvesQuery.data ?? [];

  const isLoading = shelfQuery.isLoading;
  const isError = shelfQuery.isError;
  const isFetching = shelfQuery.isFetching;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold dark:text-white mb-8">Wishlist</h1>

        <MobileScanHint page="wishlist" />

        {isLoading && <ShelfSkeleton sections={1} />}

        {isError && !isLoading && (
          <ShelfErrorState
            message="Couldn't load your wishlist."
            onRetry={() => void shelfQuery.refetch()}
            isRetrying={isFetching}
          />
        )}

        {!isLoading && !isError && (
          <>
            {want.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-slate-500 dark:text-slate-400 mb-4">Your wishlist is empty.</p>
                <Link
                  to="/shelf"
                  className="text-sm text-slate-900 dark:text-white underline underline-offset-2"
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
                    shelves={shelves}
                    onMove={(isbn, status) => moveMutation.mutate({ isbn, status })}
                    onRemove={(isbn) => removeMutation.mutate(isbn)}
                    onAddToShelf={(shelfId, isbn) => addToShelfMutation.mutate({ shelfId, isbn })}
                    onRemoveFromShelf={(shelfId, isbn) =>
                      removeFromShelfMutation.mutate({ shelfId, isbn })
                    }
                    isMoving={moveMutation.isPending && moveMutation.variables?.isbn === entry.isbn}
                    isRemoving={removeMutation.isPending && removeMutation.variables === entry.isbn}
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
            )}

            {shelfQuery.hasNextPage && (
              <div className="text-center mt-8">
                <Button
                  variant="ghost"
                  onClick={() => void shelfQuery.fetchNextPage()}
                  disabled={shelfQuery.isFetchingNextPage}
                >
                  {shelfQuery.isFetchingNextPage ? "Loading more…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
