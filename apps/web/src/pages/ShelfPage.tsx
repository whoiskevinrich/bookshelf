import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { inputClass } from "../lib/form-styles";
import {
  useShelf,
  useFilteredShelf,
  useAddToShelf,
  useKeepEditionSeparate,
  useAddAnotherCopy,
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
  AuthorBrowsePanel,
  ActiveFilterBar,
  ActiveAuthorBar,
  ReadingListBar,
  LibrarySearchInput,
  SortControl,
  SmartShelvesGroup,
  buildFilter,
  ruleToActive,
  parseFacet,
  isReadingListEntry,
  facetLabel,
  type SystemFacet,
} from "../components/shelf/ShelfFilterControls";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { sortEntries, parseSortKey, DEFAULT_SORT, type SortKey } from "../lib/sort";
import { deriveAuthors, entryHasAuthor } from "../lib/authors";
import type { SmartShelfWithCount } from "../lib/api-client";
import {
  useShelves,
  useCreateShelf,
  useAddBookToShelf,
  useRemoveBookFromShelf,
  useReorderShelves,
} from "../hooks/useShelves";
import { ShelfBookCard } from "../components/shelf/ShelfBookCard";
import { BulkActionBar } from "../components/shelf/BulkActionBar";
import { useBulkShelfActions } from "../hooks/useBulkShelfActions";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { ShelfEmptyState } from "../components/shelf/ShelfEmptyState";
import { MobileScanHint } from "../components/shelf/MobileScanHint";
import { useHorizontalScrollOnWheel } from "../hooks/useHorizontalScrollOnWheel";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { entryMatchesQuery } from "../lib/search";
import { BookSearch } from "../components/BookSearch";
import { Button } from "../components/ui/Button";
import { Callout } from "../components/ui/Callout";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ScanModal } from "../components/scanner/ScanModal";
import { supportsCameraScan } from "../lib/device";
import { getRuntimeConfig } from "../lib/runtime-config";
import { isConflictError, fetchShelfEntry } from "../lib/api-client";
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
    "text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-zinc-400 shrink-0";
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
      <span className="flex-1 h-px bg-paper-300 dark:bg-slate-700" aria-hidden="true" />
      <span className="text-xs text-slate-600 dark:text-zinc-400 bg-paper-300 dark:bg-slate-800 rounded-full px-2 py-0.5">
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
      className="space-y-2 rounded-xl border border-paper-300 dark:border-slate-700 p-4"
    >
      <label htmlFor="smart-shelf-name" className="text-xs text-slate-600 dark:text-slate-400">
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
  // Manage mode (BOOKSHELF-59)
  manageMode?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (isbn: string) => void;
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
  manageMode = false,
  selected,
  onToggleSelect,
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
        <p className="text-sm text-slate-600 dark:text-slate-400">{emptyMessage}</p>
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
                manageMode={manageMode}
                selected={selected?.has(entry.isbn) ?? false}
                {...(onToggleSelect ? { onToggleSelect } : {})}
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
  const keepSeparateMutation = useKeepEditionSeparate();
  const addAnotherCopyMutation = useAddAnotherCopy();
  const moveMutation = useMoveShelfEntry();
  const removeMutation = useRemoveFromShelf();
  const addToShelfMutation = useAddBookToShelf();
  const removeFromShelfMutation = useRemoveBookFromShelf();
  const reorderMutation = useReorderShelves();

  // Manage mode (BOOKSHELF-59) — explicit bulk-select mode, off by default. Selection
  // is cleared on exit so re-entering always starts from a clean slate.
  const [manageMode, setManageMode] = useState(false);
  const [selectedIsbns, setSelectedIsbns] = useState<Set<string>>(new Set());
  const bulk = useBulkShelfActions();

  function toggleManageMode() {
    setManageMode((v) => !v);
    setSelectedIsbns(new Set());
    bulk.dismiss();
  }

  function toggleSelect(isbn: string) {
    setSelectedIsbns((prev) => {
      const next = new Set(prev);
      if (next.has(isbn)) next.delete(isbn);
      else next.add(isbn);
      return next;
    });
  }

  // Phase 3 — system-facet/tag filtering + smart shelves (ADR-019).
  // Filter/view state lives in the URL so views are deep-linkable and shareable
  // (ADR-021): `?facet=want`, `?tag=sci-fi`, `?view=reading-list`. Facet/tag drive
  // the server-side filter; `reading-list` is a client-computed composite.
  const [searchParams, setSearchParams] = useSearchParams();
  const facet = parseFacet(searchParams.get("facet"));
  const tag = searchParams.get("tag");
  const view = searchParams.get("view") === "reading-list" ? "reading-list" : null;
  // Author filter (BOOKSHELF-57) — client-side, derived from loaded library data.
  // Deep-linkable like facet/tag; composes with them rather than replacing them.
  const author = searchParams.get("author");

  const [showBrowse, setShowBrowse] = useState(false);
  const [showAuthorBrowse, setShowAuthorBrowse] = useState(false);
  const [showSaveSmart, setShowSaveSmart] = useState(false);
  const [smartShelfToDelete, setSmartShelfToDelete] = useState<SmartShelfWithCount | null>(null);
  // Duplicate-add "add another copy" prompt (BOOKSHELF-60) — set only once the
  // duplicate is confirmed to be an owned book (see handleAdd).
  const [copyPrompt, setCopyPrompt] = useState<{ isbn: string; title: string } | null>(null);
  // Add-time edition-grouping notice (BOOKSHELF-91): set when an add auto-joins an
  // existing edition, cleared on dismiss or "Keep separate".
  const [groupPrompt, setGroupPrompt] = useState<{
    isbn: string;
    title: string;
    count: number;
  } | null>(null);

  // Free-text search over the loaded library (BOOKSHELF-52). Client-side and
  // debounced so filtering the whole library stays off the typing hot path; it
  // composes on top of the active facet/tag/reading-list base set.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const searchActive = debouncedSearch.trim().length > 0;

  // Sort preference (BOOKSHELF-57). Persisted per browser via localStorage so it
  // survives reloads; applied client-side to every rendered grid via sortEntries,
  // so it composes with the facet/tag filter, reading list, and search views.
  const [sort, setSort] = useLocalStorage<SortKey>(
    "bookshelf:library-sort",
    DEFAULT_SORT,
    parseSortKey,
  );

  // Manage-mode selection (BOOKSHELF-59) is scoped to whichever view is active —
  // switching facet/tag/author/view/search resets it. Without this, a selection
  // made in one view could carry ISBNs the next view never loaded, and a bulk tag
  // add would then merge against an empty tag list instead of the book's real one.
  useEffect(() => {
    setSelectedIsbns(new Set());
  }, [facet, tag, author, view, debouncedSearch]);

  // Replace history (not push) so tweaking filters doesn't stack up back-nav.
  const updateParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Selecting a facet or tag exits any named view (they're mutually exclusive).
  const setFacet = useCallback(
    (f: SystemFacet | null) =>
      updateParams((p) => {
        p.delete("view");
        if (f) p.set("facet", f);
        else p.delete("facet");
      }),
    [updateParams],
  );
  const setTag = useCallback(
    (t: string | null) =>
      updateParams((p) => {
        p.delete("view");
        if (t) p.set("tag", t);
        else p.delete("tag");
      }),
    [updateParams],
  );
  // Author composes with facet/tag/view (it's an extra client-side narrowing),
  // so it never clears them — only itself.
  const setAuthor = useCallback(
    (a: string | null) =>
      updateParams((p) => {
        if (a) p.set("author", a);
        else p.delete("author");
      }),
    [updateParams],
  );

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

  // Reading List is a client-computed composite over the loaded library (ADR-021),
  // not a server filter — its union (reading OR owned-and-unread) isn't expressible
  // as a single ShelfFilter.
  const readingListEntries = useMemo(
    () => (view === "reading-list" ? sortEntries(allEntries.filter(isReadingListEntry), sort) : []),
    [view, allEntries, sort],
  );

  // Search composes on top of whichever view is active: the reading-list
  // composite, the server-filtered facet/tag set, or the full library. Empty
  // query leaves every view untouched (searchResults is unused then).
  const searchBaseEntries = useMemo(() => {
    if (view === "reading-list") return readingListEntries;
    if (isFiltered) return filteredQuery.data?.entries ?? [];
    return allEntries;
  }, [view, isFiltered, readingListEntries, filteredQuery.data, allEntries]);

  // Author narrows whatever base is active (reading-list / facet-tag / all), and
  // search narrows further — so search composes on top of the author filter.
  const authorActive = author !== null && author.length > 0;
  const authorScopedBase = useMemo(
    () =>
      authorActive
        ? searchBaseEntries.filter((e) => entryHasAuthor(e, author!))
        : searchBaseEntries,
    [authorActive, searchBaseEntries, author],
  );

  // Author options come from the whole loaded library, derived only while the
  // browse panel is open (like the tag list) to avoid scanning on every render.
  const authorOptions = useMemo(
    () => (showAuthorBrowse ? deriveAuthors(allEntries) : []),
    [showAuthorBrowse, allEntries],
  );

  // Author active without a search query → its own flat, sorted grid.
  const authorEntries = useMemo(
    () => (authorActive && !searchActive ? sortEntries(authorScopedBase, sort) : []),
    [authorActive, searchActive, authorScopedBase, sort],
  );

  const searchResults = useMemo(
    () =>
      searchActive
        ? sortEntries(
            authorScopedBase.filter((e) => entryMatchesQuery(e, debouncedSearch)),
            sort,
          )
        : [],
    [searchActive, authorScopedBase, debouncedSearch, sort],
  );

  // Server-filtered (facet/tag) entries, re-sorted client-side to match the pref.
  const filteredEntries = useMemo(
    () => sortEntries(filteredQuery.data?.entries ?? [], sort),
    [filteredQuery.data, sort],
  );

  const { namedShelfEntries, unshelved } = useMemo(() => {
    const allShelvedIsbns = new Set(orderedShelves.flatMap((s) => s.bookIds));
    return {
      namedShelfEntries: orderedShelves.map((shelf) => {
        const shelfSet = new Set(shelf.bookIds);
        return {
          shelf,
          entries: sortEntries(
            allEntries.filter((e) => shelfSet.has(e.isbn)),
            sort,
          ),
        };
      }),
      unshelved: sortEntries(
        allEntries.filter((e) => !allShelvedIsbns.has(e.isbn)),
        sort,
      ),
    };
  }, [allEntries, orderedShelves, sort]);

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
    setShowSearch(false);
    setGroupPrompt(null);
    addMutation.mutate(
      { isbn, status, book },
      {
        onSuccess: (result) => {
          // Auto-joined an existing edition (BOOKSHELF-91): surface a visible,
          // reversible notice. The group metric is fired centrally in useAddToShelf.
          if (result.groupedWith.length > 0) {
            setGroupPrompt({ isbn, title: book.title, count: result.groupedWith.length + 1 });
          }
        },
        onError: (err) => {
          // Duplicate add (BOOKSHELF-60): a 409 means the book is already on the
          // shelf. Offer "add another copy" only when it's actually *owned* — copies
          // is owned-only, and the 409 alone doesn't distinguish owned from wishlist,
          // so confirm ownership with a lookup before prompting.
          if (isConflictError(err) && status === "owned") {
            void fetchShelfEntry(isbn)
              .then((entry) => {
                if (entry.owned) setCopyPrompt({ isbn, title: book.title });
              })
              .catch(() => {});
          }
        },
      },
    );
  }

  function closeCopyPrompt() {
    setCopyPrompt(null);
    addMutation.reset();
    addAnotherCopyMutation.reset();
  }

  function clearFilter() {
    updateParams((p) => {
      p.delete("facet");
      p.delete("tag");
      p.delete("view");
      p.delete("author");
    });
    setShowSaveSmart(false);
  }

  function applySmartShelf(shelf: SmartShelfWithCount) {
    const a = ruleToActive(shelf.rule);
    updateParams((p) => {
      p.delete("view");
      p.delete("author");
      if (a.facet) p.set("facet", a.facet);
      else p.delete("facet");
      if (a.tag) p.set("tag", a.tag);
      else p.delete("tag");
    });
    setShowBrowse(false);
    setShowAuthorBrowse(false);
    setShowSaveSmart(false);
  }

  function handleDeleteSmartShelf(shelf: SmartShelfWithCount) {
    setSmartShelfToDelete(shelf);
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

  // The entry set "Select all" should select — whichever view is currently active,
  // mirroring the branch order the body renders below. Selection only ever covers
  // loaded entries, same as the existing client-side search/author filters.
  const visibleEntries = useMemo(() => {
    if (searchActive) return searchResults;
    if (authorActive) return authorEntries;
    if (view === "reading-list") return readingListEntries;
    if (isFiltered) return filteredEntries;
    return allEntries;
  }, [
    searchActive,
    searchResults,
    authorActive,
    authorEntries,
    view,
    readingListEntries,
    isFiltered,
    filteredEntries,
    allEntries,
  ]);

  function selectAllVisible() {
    setSelectedIsbns(new Set(visibleEntries.map((e) => e.isbn)));
  }

  function clearSelection() {
    setSelectedIsbns(new Set());
  }

  return (
    <div className="min-h-screen bg-paper-100 dark:bg-slate-900 transition-colors">
      <AppHeader />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold dark:text-white">My Library</h1>
          {/* Manage mode (BOOKSHELF-59) swaps out the add/scan/new-shelf actions for a
              single "Done" button — a clear visual state change that keeps adding
              books and bulk-editing them from happening at the same time. */}
          <div className="flex items-center gap-2">
            {manageMode ? (
              <Button variant="app" onClick={toggleManageMode}>
                Done
              </Button>
            ) : (
              <>
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
                <Button variant="secondary" onClick={toggleManageMode} disabled={isEmpty}>
                  Manage
                </Button>
              </>
            )}
          </div>
        </div>

        {manageMode && (
          <div className="mb-8">
            <BulkActionBar
              selectedCount={selectedIsbns.size}
              visibleCount={visibleEntries.length}
              shelves={orderedShelves}
              pending={bulk.pending}
              result={bulk.result}
              onSelectAll={selectAllVisible}
              onClear={clearSelection}
              onConfirmDelete={() => {
                void bulk.bulkDelete(Array.from(selectedIsbns)).then(clearSelection);
              }}
              onMove={(status) => void bulk.bulkMove(Array.from(selectedIsbns), status)}
              onAddToShelf={(shelfId) =>
                void bulk.bulkAddToShelf(Array.from(selectedIsbns), shelfId)
              }
              onAddTag={(tag) =>
                void bulk.bulkAddTag(Array.from(selectedIsbns), tag, visibleEntries)
              }
              onRetry={bulk.retry}
              onDismissResult={bulk.dismiss}
            />
          </div>
        )}

        {showScanner && <ScanModal onClose={() => setShowScanner(false)} />}

        <MobileScanHint page="shelf" />

        {showCreateShelf && (
          <div className="mb-8 p-4 border border-paper-300 dark:border-slate-700 rounded-xl">
            <CreateShelfForm onClose={() => setShowCreateShelf(false)} />
          </div>
        )}

        {showSearch && (
          <div
            ref={searchPanelRef}
            className="mb-8 p-4 border border-paper-300 dark:border-slate-700 rounded-xl"
          >
            <BookSearch onAdd={handleAdd} isAdding={addMutation.isPending} />
          </div>
        )}

        {/* A duplicate add surfaces the plain message here; an owned duplicate is
            handled by the "add another copy" dialog below instead (BOOKSHELF-60). */}
        {addMutation.isError && !copyPrompt && (
          <p className="text-sm text-red-500 mb-4">
            {isConflictError(addMutation.error)
              ? "That book is already on your shelf."
              : `Couldn't add book — ${addMutation.error.message}`}
          </p>
        )}

        {/* Add-time edition-grouping notice (BOOKSHELF-91) — visible + reversible. */}
        {groupPrompt && (
          <div className="mb-4">
            <Callout
              title={`Grouped as one of ${groupPrompt.count} editions`}
              onDismiss={() => setGroupPrompt(null)}
              dismissLabel="Dismiss grouping notice"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={keepSeparateMutation.isPending}
                  onClick={() =>
                    keepSeparateMutation.mutate(groupPrompt.isbn, {
                      onSuccess: () => setGroupPrompt(null),
                    })
                  }
                >
                  Keep separate
                </Button>
              }
            >
              <span className="font-medium">{groupPrompt.title}</span> was grouped with your other
              edition{groupPrompt.count > 2 ? "s" : ""} of this work. You can switch between
              editions from the book&apos;s page.
            </Callout>
          </div>
        )}

        <ConfirmDialog
          open={copyPrompt !== null}
          title="Add another copy?"
          message={`You already own "${copyPrompt?.title}" — add another copy?`}
          confirmLabel="Add another copy"
          pending={addAnotherCopyMutation.isPending}
          error={
            addAnotherCopyMutation.isError ? "Couldn't add another copy — please try again." : null
          }
          onConfirm={() => {
            if (!copyPrompt) return;
            addAnotherCopyMutation.mutate(copyPrompt.isbn, { onSuccess: closeCopyPrompt });
          }}
          onClose={closeCopyPrompt}
        />

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
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowAuthorBrowse((v) => !v);
                          setShowBrowse(false);
                        }}
                      >
                        {showAuthorBrowse ? "Close" : "Browse authors"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowBrowse((v) => !v);
                          setShowAuthorBrowse(false);
                        }}
                      >
                        {showBrowse ? "Close" : "Browse tags"}
                      </Button>
                    </div>
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
                  {showAuthorBrowse && (
                    <AuthorBrowsePanel
                      authors={authorOptions}
                      activeAuthor={author}
                      onPick={(a) => {
                        setAuthor(a);
                        setShowAuthorBrowse(false);
                      }}
                    />
                  )}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[16rem] flex-1">
                      <LibrarySearchInput
                        value={search}
                        onChange={setSearch}
                        matchCount={searchActive ? searchResults.length : null}
                      />
                    </div>
                    <SortControl value={sort} onChange={setSort} />
                  </div>
                </div>

                {searchActive ? (
                  <div className="space-y-4">
                    {searchResults.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {searchResults.map((entry, index) => (
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
                            manageMode={manageMode}
                            selected={selectedIsbns.has(entry.isbn)}
                            onToggleSelect={toggleSelect}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          No books match “{debouncedSearch.trim()}”.
                        </p>
                        <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                          Clear search
                        </Button>
                      </div>
                    )}
                    {/* Search only covers loaded books; more pages exist client-side (v1). */}
                    {!isFiltered && shelfQuery.hasNextPage && (
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Searching loaded books only.{" "}
                        <button
                          type="button"
                          onClick={() => void shelfQuery.fetchNextPage()}
                          disabled={shelfQuery.isFetchingNextPage}
                          className="underline hover:text-slate-900 dark:hover:text-white disabled:opacity-60"
                        >
                          {shelfQuery.isFetchingNextPage
                            ? "Loading more…"
                            : "Load more to search everything"}
                        </button>
                      </p>
                    )}
                  </div>
                ) : authorActive ? (
                  <div className="space-y-4">
                    <ActiveAuthorBar
                      author={author!}
                      count={authorEntries.length}
                      onClear={() => setAuthor(null)}
                    />
                    {authorEntries.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {authorEntries.map((entry, index) => (
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
                            manageMode={manageMode}
                            selected={selectedIsbns.has(entry.isbn)}
                            onToggleSelect={toggleSelect}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        No loaded books by {author} match the current filters.
                      </p>
                    )}
                    {/* Author options come from loaded books only (like search). */}
                    {shelfQuery.hasNextPage && (
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Filtering loaded books only.{" "}
                        <button
                          type="button"
                          onClick={() => void shelfQuery.fetchNextPage()}
                          disabled={shelfQuery.isFetchingNextPage}
                          className="underline hover:text-slate-900 dark:hover:text-white disabled:opacity-60"
                        >
                          {shelfQuery.isFetchingNextPage
                            ? "Loading more…"
                            : "Load more to cover everything"}
                        </button>
                      </p>
                    )}
                  </div>
                ) : view === "reading-list" ? (
                  <div className="space-y-4">
                    <ReadingListBar count={readingListEntries.length} onClear={clearFilter} />
                    {readingListEntries.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {readingListEntries.map((entry, index) => (
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
                            manageMode={manageMode}
                            selected={selectedIsbns.has(entry.isbn)}
                            onToggleSelect={toggleSelect}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Your reading list is empty — books you&apos;re reading, or own but
                        haven&apos;t finished, show up here.
                      </p>
                    )}
                  </div>
                ) : isFiltered ? (
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
                    ) : filteredEntries.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {filteredEntries.map((entry, index) => (
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
                            manageMode={manageMode}
                            selected={selectedIsbns.has(entry.isbn)}
                            onToggleSelect={toggleSelect}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
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
                        manageMode={manageMode}
                        selected={selectedIsbns}
                        onToggleSelect={toggleSelect}
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
                        manageMode={manageMode}
                        selected={selectedIsbns}
                        onToggleSelect={toggleSelect}
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

      <ConfirmDialog
        open={smartShelfToDelete !== null}
        title={`Delete “${smartShelfToDelete?.name ?? ""}”?`}
        message="This removes the saved smart shelf (the filter rule). Your books are untouched."
        confirmLabel="Delete smart shelf"
        destructive
        pending={deleteSmartShelf.isPending}
        onConfirm={() => {
          if (!smartShelfToDelete) return;
          deleteSmartShelf.mutate(smartShelfToDelete.smartShelfId, {
            onSettled: () => setSmartShelfToDelete(null),
          });
        }}
        onClose={() => setSmartShelfToDelete(null)}
      />
    </div>
  );
}
