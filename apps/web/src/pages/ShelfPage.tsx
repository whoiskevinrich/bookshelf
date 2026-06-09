import { useState, useMemo, useEffect } from "react";
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
  useReorderShelves,
} from "../hooks/useShelves";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { ShelfEmptyState } from "../components/shelf/ShelfEmptyState";
import { BookSearch } from "../components/BookSearch";
import { Button } from "../components/ui/Button";
import type { ShelfEntry, ShelfStatus, BookSearchResult, Shelf } from "../lib/api-client";

// ── Section header ─────────────────────────────────────────────────────────

function DragHandle(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0 select-none"
      aria-label="Drag to reorder shelf"
      {...props}
    >
      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor" aria-hidden="true">
        <circle cx="5.5" cy="4" r="1.2" />
        <circle cx="5.5" cy="8" r="1.2" />
        <circle cx="5.5" cy="12" r="1.2" />
        <circle cx="10.5" cy="4" r="1.2" />
        <circle cx="10.5" cy="8" r="1.2" />
        <circle cx="10.5" cy="12" r="1.2" />
      </svg>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  title: string;
  count: number;
  onDelete?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {onDragStart && <DragHandle draggable onDragStart={onDragStart} onDragEnd={onDragEnd} />}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400 shrink-0">
        {title}
      </h2>
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
      <span className="text-xs text-slate-500 dark:text-zinc-400 bg-slate-200 dark:bg-slate-800 rounded-full px-2 py-0.5">
        {count}
      </span>
      {onDelete && (
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          aria-label={`Delete shelf ${title}`}
        >
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
  // Drag-and-drop
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
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
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget,
}: ShelfSectionProps) {
  return (
    <section
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={[
        "transition-opacity duration-150",
        isDragging ? "opacity-40" : "",
        isDropTarget
          ? "outline outline-2 outline-slate-400 dark:outline-slate-500 rounded-xl -m-2 p-2"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <SectionHeader
        title={title}
        count={entries.length}
        {...(onDelete ? { onDelete } : {})}
        {...(onDragStart ? { onDragStart } : {})}
        {...(onDragEnd ? { onDragEnd } : {})}
      />
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <div
          className="overflow-x-auto -mx-6 px-6"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgb(148 163 184 / 0.4) transparent" }}
        >
          <div className="flex gap-4 pb-3">
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
  const reorderMutation = useReorderShelves();

  const isLoading = shelfQuery.isLoading || shelvesQuery.isLoading;
  const isError = shelfQuery.isError || shelvesQuery.isError;
  const isFetching = shelfQuery.isFetching || shelvesQuery.isFetching;

  // Local shelf order for optimistic drag-and-drop reordering.
  // Stays in sync with server data unless a reorder is in flight.
  const [shelfOrder, setShelfOrder] = useState<string[] | null>(null);
  useEffect(() => {
    if (!reorderMutation.isPending && shelvesQuery.data) {
      setShelfOrder(shelvesQuery.data.map((s) => s.shelfId));
    }
  }, [shelvesQuery.data, reorderMutation.isPending]);

  // Drag state
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  const serverShelves = shelvesQuery.data ?? [];

  // Apply local order to the shelves array
  const orderedShelves = useMemo(() => {
    if (!shelfOrder) return serverShelves;
    const map = new Map(serverShelves.map((s) => [s.shelfId, s]));
    return shelfOrder.flatMap((id) => {
      const s = map.get(id);
      return s ? [s] : [];
    });
  }, [serverShelves, shelfOrder]);

  const allEntries = useMemo(() => flattenShelf(shelfQuery.data), [shelfQuery.data]);

  const { namedShelfEntries, unshelved } = useMemo(() => {
    const allShelvedIsbns = new Set(orderedShelves.flatMap((s) => s.bookIds));
    return {
      namedShelfEntries: orderedShelves.map((shelf) => {
        const shelfSet = new Set(shelf.bookIds);
        return { shelf, entries: allEntries.filter((e) => shelfSet.has(e.isbn)) };
      }),
      unshelved: allEntries.filter((e) => !allShelvedIsbns.has(e.isbn)),
    };
  }, [allEntries, orderedShelves]);

  function handleAdd(isbn: string, status: ShelfStatus, book: BookSearchResult) {
    addMutation.mutate({ isbn, status, book });
    setShowSearch(false);
  }

  function handleDragStart(idx: number) {
    setDraggingIdx(idx);
    setDropTargetIdx(null);
  }

  function handleDragOver(idx: number, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetIdx !== idx) setDropTargetIdx(idx);
  }

  function handleDrop(targetIdx: number) {
    if (draggingIdx === null || draggingIdx === targetIdx) {
      setDraggingIdx(null);
      setDropTargetIdx(null);
      return;
    }
    const current = shelfOrder ?? orderedShelves.map((s) => s.shelfId);
    const reordered = [...current];
    const moved = reordered.splice(draggingIdx, 1)[0]!;
    reordered.splice(targetIdx, 0, moved);
    setShelfOrder(reordered);
    setDraggingIdx(null);
    setDropTargetIdx(null);
    reorderMutation.mutate(reordered);
  }

  function handleDragEnd() {
    setDraggingIdx(null);
    setDropTargetIdx(null);
  }

  const isEmpty = allEntries.length === 0;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <AppHeader />

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold dark:text-white">My Library</h1>
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
                {namedShelfEntries.map(({ shelf, entries }, idx) => (
                  <ShelfSection
                    key={shelf.shelfId}
                    title={shelf.name}
                    entries={entries}
                    emptyMessage="No books on this shelf yet — add books and use the Shelves button to assign them."
                    shelves={orderedShelves}
                    moveMutation={moveMutation}
                    removeMutation={removeMutation}
                    addToShelfMutation={addToShelfMutation}
                    removeFromShelfMutation={removeFromShelfMutation}
                    onDelete={() => deleteShelfMutation.mutate(shelf.shelfId)}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      handleDragStart(idx);
                    }}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(idx, e)}
                    onDrop={() => handleDrop(idx)}
                    isDragging={draggingIdx === idx}
                    isDropTarget={dropTargetIdx === idx && draggingIdx !== idx}
                  />
                ))}

                {(unshelved.length > 0 || namedShelfEntries.length === 0) && (
                  <ShelfSection
                    title={namedShelfEntries.length > 0 ? "Unshelved" : "All books"}
                    entries={unshelved}
                    emptyMessage="No books yet — add one above!"
                    shelves={orderedShelves}
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
