import { useState, useMemo } from "react";
import { AppHeader } from "../components/AppHeader";
import { inputClass } from "../lib/form-styles";
import {
  useShelf,
  useAddToShelf,
  useMoveShelfEntry,
  useRemoveFromShelf,
  flattenShelf,
} from "../hooks/useShelf";
import {
  useShelves,
  useCreateShelf,
  useDeleteShelf,
  useAddBookToShelf,
  useRemoveBookFromShelf,
} from "../hooks/useShelves";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { ShelfEmptyState } from "../components/shelf/ShelfEmptyState";
import { BookSearch } from "../components/BookSearch";
import { Button } from "../components/ui/Button";
import type { ShelfEntry, ShelfStatus, BookSearchResult, Shelf } from "../lib/api-client";

// ── Section header ─────────────────────────────────────────────────────────

function SectionHeader({
  title,
  count,
  onDelete,
}: {
  title: string;
  count: number;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400 shrink-0">
        {title}
      </h2>
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
      <span className="text-xs text-slate-500 dark:text-zinc-400 bg-slate-200 dark:bg-slate-800 rounded-full px-2 py-0.5">
        {count}
      </span>
      {onDelete && (
        <Button variant="destructive" size="sm" onClick={onDelete} aria-label={`Delete shelf ${title}`}>
          Delete shelf
        </Button>
      )}
    </div>
  );
}

// ── Create shelf inline form ───────────────────────────────────────────────

function CreateShelfForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const createMutation = useCreateShelf();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim(), { onSuccess: onClose });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Shelf name…"
        maxLength={100}
        className={`flex-1 text-sm ${inputClass}`}
      />
      <Button
        type="submit"
        variant="app"
        size="sm"
        disabled={!name.trim() || createMutation.isPending}
      >
        {createMutation.isPending ? "Creating…" : "Create"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
    </form>
  );
}

// ── Shelf section ──────────────────────────────────────────────────────────

interface ShelfSectionProps {
  title: string;
  entries: ShelfEntry[];
  emptyMessage: string;
  shelves: Shelf[];
  moveMutation: ReturnType<typeof useMoveShelfEntry>;
  removeMutation: ReturnType<typeof useRemoveFromShelf>;
  addToShelfMutation: ReturnType<typeof useAddBookToShelf>;
  removeFromShelfMutation: ReturnType<typeof useRemoveBookFromShelf>;
  onDelete?: () => void;
}

function ShelfSection({
  title,
  entries,
  emptyMessage,
  shelves,
  moveMutation,
  removeMutation,
  addToShelfMutation,
  removeFromShelfMutation,
  onDelete,
}: ShelfSectionProps) {
  return (
    <section>
      <SectionHeader title={title} count={entries.length} {...(onDelete ? { onDelete } : {})} />
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {entries.map((entry, index) => (
            <ShelfBookCard
              key={entry.isbn}
              entry={entry}
              shelves={shelves}
              staggerIndex={index}
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
    </section>
  );
}

// ── ShelfPage ──────────────────────────────────────────────────────────────

export function ShelfPage() {
  const [showSearch, setShowSearch] = useState(false);
  const [showCreateShelf, setShowCreateShelf] = useState(false);

  const shelfQuery = useShelf();
  const shelvesQuery = useShelves();
  const addMutation = useAddToShelf();
  const moveMutation = useMoveShelfEntry();
  const removeMutation = useRemoveFromShelf();
  const addToShelfMutation = useAddBookToShelf();
  const removeFromShelfMutation = useRemoveBookFromShelf();
  const deleteShelfMutation = useDeleteShelf();

  const isLoading = shelfQuery.isLoading || shelvesQuery.isLoading;
  const isError = shelfQuery.isError || shelvesQuery.isError;
  const isFetching = shelfQuery.isFetching || shelvesQuery.isFetching;

  const shelves = shelvesQuery.data ?? [];
  const allEntries = useMemo(() => flattenShelf(shelfQuery.data), [shelfQuery.data]);

  const { namedShelfEntries, unshelved } = useMemo(() => {
    const allShelvedIsbns = new Set(shelves.flatMap((s) => s.bookIds));
    return {
      namedShelfEntries: shelves.map((shelf) => ({
        shelf,
        entries: allEntries.filter((e) => shelf.bookIds.includes(e.isbn)),
      })),
      unshelved: allEntries.filter((e) => !allShelvedIsbns.has(e.isbn)),
    };
  }, [allEntries, shelves]);

  function handleAdd(isbn: string, status: ShelfStatus, book: BookSearchResult) {
    addMutation.mutate({ isbn, status, book });
    setShowSearch(false);
  }

  const isEmpty = allEntries.length === 0;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold dark:text-white">My Shelf</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setShowCreateShelf((v) => !v);
                setShowSearch(false);
              }}
            >
              {showCreateShelf ? "Cancel" : "+ New shelf"}
            </Button>
            <Button
              variant="app"
              onClick={() => {
                setShowSearch((v) => !v);
                setShowCreateShelf(false);
              }}
            >
              {showSearch ? "Cancel" : "Add a book"}
            </Button>
          </div>
        </div>

        {showCreateShelf && (
          <div className="mb-8 p-4 border border-slate-100 dark:border-slate-700 rounded-xl">
            <CreateShelfForm onClose={() => setShowCreateShelf(false)} />
          </div>
        )}

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
          <ShelfErrorState
            onRetry={() => {
              void shelfQuery.refetch();
              void shelvesQuery.refetch();
            }}
            isRetrying={isFetching}
          />
        )}

        {!isLoading && !isError && (
          <>
            {isEmpty ? (
              <ShelfEmptyState onAdd={() => setShowSearch(true)} />
            ) : (
              <div className="space-y-10">
                {namedShelfEntries.map(({ shelf, entries }) => (
                  <ShelfSection
                    key={shelf.shelfId}
                    title={shelf.name}
                    entries={entries}
                    emptyMessage="No books on this shelf yet — add books and use the Shelves button to assign them."
                    shelves={shelves}
                    moveMutation={moveMutation}
                    removeMutation={removeMutation}
                    addToShelfMutation={addToShelfMutation}
                    removeFromShelfMutation={removeFromShelfMutation}
                    onDelete={() => deleteShelfMutation.mutate(shelf.shelfId)}
                  />
                ))}

                {(unshelved.length > 0 || namedShelfEntries.length === 0) && (
                  <ShelfSection
                    title={namedShelfEntries.length > 0 ? "Unshelved" : "All books"}
                    entries={unshelved.length > 0 ? unshelved : allEntries}
                    emptyMessage="No books yet — add one above!"
                    shelves={shelves}
                    moveMutation={moveMutation}
                    removeMutation={removeMutation}
                    addToShelfMutation={addToShelfMutation}
                    removeFromShelfMutation={removeFromShelfMutation}
                  />
                )}

                {shelfQuery.hasNextPage && (
                  <div className="text-center">
                    <Button
                      variant="ghost"
                      onClick={() => void shelfQuery.fetchNextPage()}
                      disabled={shelfQuery.isFetchingNextPage}
                    >
                      {shelfQuery.isFetchingNextPage ? "Loading more…" : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
