import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { inputClass } from "../lib/form-styles";
import {
  useShelf,
  useFilteredShelf,
  useAddToShelf,
  useMoveShelfEntry,
  useRemoveFromShelf,
  flattenShelf,
} from "../hooks/useShelf";
import { useTags } from "../hooks/useBookEntry";
import {
  useSmartShelves,
  useCreateSmartShelf,
  useDeleteSmartShelf,
} from "../hooks/useSmartShelves";
import {
  FacetBar,
  TagBrowsePanel,
  ActiveFilterBar,
  SmartShelvesGroup,
  buildFilter,
  ruleToActive,
  facetLabel,
  type SystemFacet,
} from "../components/shelf/ShelfFilterControls";
import type { SmartShelfWithCount } from "../lib/api-client";
import {
  useShelves,
  useCreateShelf,
  useAddBookToShelf,
  useRemoveBookFromShelf,
  useReorderShelves,
} from "../hooks/useShelves";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { ShelfEmptyState } from "../components/shelf/ShelfEmptyState";
import { MobileScanHint } from "../components/shelf/MobileScanHint";
import { useHorizontalScrollOnWheel } from "../hooks/useHorizontalScrollOnWheel";
import { BookSearch } from "../components/BookSearch";
import { Button } from "../components/ui/Button";
import { ScanModal } from "../components/scanner/ScanModal";
import { supportsCameraScan } from "../lib/device";
import { getRuntimeConfig } from "../lib/runtime-config";
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

function ChevronRightIcon() {
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
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function SectionHeader({
  title,
  count,
  onNavigate,
  onDragStart,
  onDragEnd,
}: {
  title: string;
  count: number;
  onNavigate?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const titleClass =
    "text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400 shrink-0";
  return (
    <div className="flex items-center gap-3 mb-4">
      {onDragStart && <DragHandle draggable onDragStart={onDragStart} onDragEnd={onDragEnd} />}
      {/* The title itself navigates to the shelf detail — users reach for it before
          a chevron (QA feedback); rename/delete live on the detail page. */}
      {onNavigate ? (
        <button
          type="button"
          onClick={onNavigate}
          aria-label={`Open shelf ${title}`}
          className={`group/sh flex items-center gap-1 rounded ${titleClass} hover:text-slate-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300 transition-colors`}
        >
          <span className="group-hover/sh:underline">{title}</span>
          <ChevronRightIcon />
        </button>
      ) : (
        <h2 className={titleClass}>{title}</h2>
      )}
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
      <span className="text-xs text-slate-500 dark:text-zinc-400 bg-slate-200 dark:bg-slate-800 rounded-full px-2 py-0.5">
        {count}
      </span>
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

// ── Save smart shelf inline form ────────────────────────────────────────────

function SaveSmartShelfForm({
  defaultName,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  defaultName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
      className="space-y-2 rounded-xl border border-slate-100 dark:border-slate-700 p-4"
    >
      <label htmlFor="smart-shelf-name" className="text-xs text-slate-500 dark:text-slate-400">
        Name this smart shelf — it updates automatically as your books change.
      </label>
      <div className="flex items-center gap-2">
        <input
          id="smart-shelf-name"
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className={`flex-1 text-sm ${inputClass}`}
        />
        <Button type="submit" variant="app" size="sm" disabled={!name.trim() || isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
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
  onNavigate?: () => void;
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
  onNavigate,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget,
}: ShelfSectionProps) {
  const scrollRef = useHorizontalScrollOnWheel();
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
        {...(onNavigate ? { onNavigate } : {})}
        {...(onDragStart ? { onDragStart } : {})}
        {...(onDragEnd ? { onDragEnd } : {})}
      />
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <div
          ref={scrollRef}
          className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6"
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
            {/* Trailing gutter — flex padding-right collapses at scroll-end, so a
                real spacer guarantees the last card isn't clipped flush to the edge. */}
            <div aria-hidden="true" className="shrink-0 w-2" />
          </div>
        </div>
      )}
    </section>
  );
}

// ── ShelfPage ──────────────────────────────────────────────────────────────

export function ShelfPage() {
  const navigate = useNavigate();
  const [showSearch, setShowSearch] = useState(false);
  const [showCreateShelf, setShowCreateShelf] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const searchPanelRef = useRef<HTMLDivElement>(null);

  // Show the Scan button only where it makes sense: the feature is enabled for
  // this environment AND the device has a touch screen + camera.
  const canScan = useMemo(() => getRuntimeConfig().features.scanner && supportsCameraScan(), []);

  const shelfQuery = useShelf();
  const shelvesQuery = useShelves();
  const addMutation = useAddToShelf();
  const moveMutation = useMoveShelfEntry();
  const removeMutation = useRemoveFromShelf();
  const addToShelfMutation = useAddBookToShelf();
  const removeFromShelfMutation = useRemoveBookFromShelf();
  const reorderMutation = useReorderShelves();

  // Phase 3 — system-facet/tag filtering + smart shelves (ADR-019).
  const [facet, setFacet] = useState<SystemFacet | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showSaveSmart, setShowSaveSmart] = useState(false);

  const activeFilter = useMemo(() => buildFilter(facet, tag), [facet, tag]);
  const isFiltered = activeFilter !== null;

  const filteredQuery = useFilteredShelf(activeFilter);
  // Only fetch the tag list once the browse panel is opened (it's the sole consumer
  // here) — avoids a full entry scan on every shelf load.
  const tagsQuery = useTags(showBrowse);
  const smartShelvesQuery = useSmartShelves();
  const createSmartShelf = useCreateSmartShelf();
  const deleteSmartShelf = useDeleteSmartShelf();

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

  // "a" shortcut — open the add-book panel (ignored when focus is in a field).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "a" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      setShowSearch(true);
      setShowCreateShelf(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Scroll search panel into view whenever it opens.
  useEffect(() => {
    if (showSearch) {
      searchPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showSearch]);

  function handleAdd(isbn: string, status: ShelfStatus, book: BookSearchResult) {
    addMutation.mutate({ isbn, status, book });
    setShowSearch(false);
  }

  function clearFilter() {
    setFacet(null);
    setTag(null);
    setShowSaveSmart(false);
  }

  function applySmartShelf(shelf: SmartShelfWithCount) {
    const a = ruleToActive(shelf.rule);
    setFacet(a.facet);
    setTag(a.tag);
    setShowBrowse(false);
    setShowSaveSmart(false);
  }

  function handleDeleteSmartShelf(shelf: SmartShelfWithCount) {
    if (window.confirm(`Delete smart shelf “${shelf.name}”? This only removes the saved view.`)) {
      deleteSmartShelf.mutate(shelf.smartShelfId);
    }
  }

  const smartShelfDefaultName = [facet ? facetLabel(facet) : null, tag ? `#${tag}` : null]
    .filter(Boolean)
    .join(" · ");

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

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
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
            {canScan && (
              <Button
                variant="secondary"
                onClick={() => {
                  setShowScanner(true);
                  setShowSearch(false);
                  setShowCreateShelf(false);
                }}
              >
                Scan
              </Button>
            )}
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

        {showScanner && <ScanModal onClose={() => setShowScanner(false)} />}

        <MobileScanHint page="shelf" />

        {showCreateShelf && (
          <div className="mb-8 p-4 border border-slate-100 dark:border-slate-700 rounded-xl">
            <CreateShelfForm onClose={() => setShowCreateShelf(false)} />
          </div>
        )}

        {showSearch && (
          <div
            ref={searchPanelRef}
            className="mb-8 p-4 border border-slate-100 dark:border-slate-700 rounded-xl"
          >
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
              <div className="space-y-6">
                {/* Filter controls (Phase 3) */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FacetBar facet={facet} onSelect={setFacet} />
                    <Button variant="ghost" size="sm" onClick={() => setShowBrowse((v) => !v)}>
                      {showBrowse ? "Close" : "Browse tags"}
                    </Button>
                  </div>
                  {showBrowse && (
                    <TagBrowsePanel
                      tags={tagsQuery.data ?? []}
                      activeTag={tag}
                      onPick={(t) => {
                        setTag(t);
                        setShowBrowse(false);
                      }}
                    />
                  )}
                </div>

                {isFiltered ? (
                  <div className="space-y-4">
                    <ActiveFilterBar
                      facet={facet}
                      tag={tag}
                      count={filteredQuery.data?.total ?? filteredQuery.data?.entries.length ?? 0}
                      onRemoveFacet={() => setFacet(null)}
                      onRemoveTag={() => setTag(null)}
                      onClear={clearFilter}
                      onSave={() => setShowSaveSmart(true)}
                      canSave={!showSaveSmart}
                    />
                    {showSaveSmart && (
                      <SaveSmartShelfForm
                        defaultName={smartShelfDefaultName}
                        isPending={createSmartShelf.isPending}
                        error={
                          createSmartShelf.isError
                            ? (createSmartShelf.error as Error).message
                            : null
                        }
                        onCancel={() => setShowSaveSmart(false)}
                        onSave={(name) => {
                          if (!activeFilter) return;
                          createSmartShelf.mutate(
                            { name, rule: activeFilter },
                            { onSuccess: () => setShowSaveSmart(false) },
                          );
                        }}
                      />
                    )}
                    {filteredQuery.isLoading ? (
                      <ShelfSkeleton sections={1} />
                    ) : (filteredQuery.data?.entries.length ?? 0) > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {filteredQuery.data!.entries.map((entry, index) => (
                          <ShelfBookCard
                            key={entry.isbn}
                            entry={entry}
                            shelves={orderedShelves}
                            staggerIndex={index}
                            onMove={(isbn, status) => moveMutation.mutate({ isbn, status })}
                            onRemove={(isbn) => removeMutation.mutate(isbn)}
                            onAddToShelf={(shelfId, isbn) =>
                              addToShelfMutation.mutate({ shelfId, isbn })
                            }
                            onRemoveFromShelf={(shelfId, isbn) =>
                              removeFromShelfMutation.mutate({ shelfId, isbn })
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No books match this filter.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-10">
                    <SmartShelvesGroup
                      shelves={smartShelvesQuery.data ?? []}
                      onApply={applySmartShelf}
                      onDelete={handleDeleteSmartShelf}
                    />

                    {namedShelfEntries.map(({ shelf, entries }, idx) => (
                      <ShelfSection
                        key={shelf.shelfId}
                        title={shelf.name}
                        entries={entries}
                        emptyMessage="No books on this shelf yet — add books from your library and use the Shelves button to assign them."
                        shelves={orderedShelves}
                        moveMutation={moveMutation}
                        removeMutation={removeMutation}
                        addToShelfMutation={addToShelfMutation}
                        removeFromShelfMutation={removeFromShelfMutation}
                        onNavigate={() => navigate(`/shelves/${shelf.shelfId}`)}
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
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
