import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { BookCover } from "../components/BookCover";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ShelfSkeleton } from "../components/shelf/ShelfSkeleton";
import { ShelfErrorState } from "../components/shelf/ShelfErrorState";
import { inputClass, labelClass } from "../lib/form-styles";
import {
  useBookEntry,
  useTags,
  useUpdateBookAttributes,
  useUpdateBookCopies,
  useUpdateBookTags,
  useUpdateBookNotes,
} from "../hooks/useBookEntry";
import { useRemoveFromShelf } from "../hooks/useShelf";
import { useShelves, useAddBookToShelf, useRemoveBookFromShelf } from "../hooks/useShelves";
import {
  ApiError,
  COPIES_MAX,
  type ReadingStatus,
  type Shelf,
  type ShelfEntry,
} from "../lib/api-client";

const NOTES_MAX_LENGTH = 2000;
const TAGS_MAX_COUNT = 25;
const MAX_SUGGESTIONS = 6;

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

// ── Copies stepper (BOOKSHELF-60) ────────────────────────────────────────────

const COPIES_MIN = 1;

function MinusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3.5 8h9" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
    </svg>
  );
}

/** −/+ stepper for the copies count. Sends the absolute new value on each tap
    (no atomic ADD — see docs/specs/multiple-copies-system-design.md §5). */
function CopiesStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-paper-400 dark:border-slate-700 bg-paper-200 dark:bg-slate-800 p-0.5">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= COPIES_MIN}
        title="Remove a copy"
        aria-label="Remove a copy"
        className="grid h-11 w-11 place-items-center rounded-md text-slate-700 dark:text-slate-200 hover:bg-paper-50 dark:hover:bg-slate-900 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        <MinusIcon />
      </button>
      <span className="min-w-[28px] text-center text-sm font-medium text-slate-900 dark:text-white">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= COPIES_MAX}
        title="Add a copy"
        aria-label="Add a copy"
        className="grid h-11 w-11 place-items-center rounded-md text-slate-700 dark:text-slate-200 hover:bg-paper-50 dark:hover:bg-slate-900 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

// ── Your-copy panel ──────────────────────────────────────────────────────────

function YourCopyPanel({ entry, isbn }: { entry: ShelfEntry; isbn: string }) {
  const attrMutation = useUpdateBookAttributes(isbn);
  const copiesMutation = useUpdateBookCopies(isbn);
  const tagsMutation = useUpdateBookTags(isbn);
  const notesMutation = useUpdateBookNotes(isbn);
  const tagsQuery = useTags();

  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState(entry.notes ?? "");

  // Keep the notes field in sync if the entry refetches (e.g. after another edit).
  useEffect(() => {
    setNotes(entry.notes ?? "");
  }, [entry.notes]);

  const atTagLimit = entry.tags.length >= TAGS_MAX_COUNT;

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t || atTagLimit) return;
    // Server normalizes + dedupes; sending the raw set is enough.
    tagsMutation.mutate([...entry.tags, t]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    tagsMutation.mutate(entry.tags.filter((t) => t !== tag));
  }

  function saveNotes() {
    const next = notes.trim() === "" ? null : notes;
    if (next !== entry.notes) notesMutation.mutate(next);
  }

  const suggestions = (tagsQuery.data ?? [])
    .map((t) => t.tag)
    .filter((t) => !entry.tags.includes(t))
    .filter((t) => (tagInput.trim() ? t.includes(tagInput.trim().toLowerCase()) : true))
    .slice(0, MAX_SUGGESTIONS);

  return (
    <section className="border-t border-paper-400 dark:border-slate-700 pt-6 mt-6 space-y-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        Your copy
      </h2>

      {/* Owned / Wishlist — mutually exclusive (wire value stays `want`, ADR-021) */}
      <div className="space-y-2">
        <span className={labelClass}>Status</span>
        <div>
          <SegmentedControl<"owned" | "want">
            label="Owned or wishlist"
            value={entry.owned ? "owned" : "want"}
            options={[
              { value: "owned", label: "Owned" },
              { value: "want", label: "Wishlist" },
            ]}
            onChange={(v) => attrMutation.mutate(v === "owned" ? { owned: true } : { want: true })}
          />
        </div>
      </div>

      {/* Copies (BOOKSHELF-60) — owned-only; hidden (not disabled) on wishlist books
          so there's no orphaned control with no explanation. */}
      {entry.owned && (
        <div className="space-y-2">
          <span className={labelClass}>Copies</span>
          <div>
            <CopiesStepper
              value={entry.copies}
              disabled={copiesMutation.isPending}
              onChange={(next) => copiesMutation.mutate(next)}
            />
          </div>
          {copiesMutation.isError && (
            <p className="text-xs text-red-500 dark:text-red-400">
              Couldn&apos;t update copies — {(copiesMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Reading status — may be unset */}
      <div className="space-y-2">
        <span className={labelClass}>Reading status</span>
        <div>
          <SegmentedControl<string>
            label="Reading status"
            value={entry.readingStatus ?? ""}
            options={[
              { value: "unread", label: "Unread" },
              { value: "reading", label: "Reading" },
              { value: "finished", label: "Read" },
            ]}
            onChange={(v) => attrMutation.mutate({ readingStatus: v as ReadingStatus })}
          />
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <span className={labelClass}>Tags</span>
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-paper-500 dark:border-slate-600 bg-paper-200 dark:bg-slate-800 py-1 pl-3 pr-1 text-sm text-slate-700 dark:text-slate-200"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                  className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-paper-300 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {!atTagLimit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTag(tagInput);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add a tag…"
              maxLength={50}
              className={`flex-1 text-sm ${inputClass}`}
              aria-label="Add a tag"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!tagInput.trim()}>
              Add
            </Button>
          </form>
        )}
        {atTagLimit && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            You&apos;ve reached the {TAGS_MAX_COUNT}-tag limit for this book.
          </p>
        )}
        {tagsMutation.isError && (
          <p className="text-xs text-red-500 dark:text-red-400">
            Couldn&apos;t update tags — {(tagsMutation.error as Error).message}
          </p>
        )}

        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-slate-600 dark:text-slate-400">Suggested:</span>
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                className="rounded-full bg-paper-200 dark:bg-slate-800 px-3 py-1 text-xs text-slate-700 dark:text-slate-200 hover:bg-paper-300 dark:hover:bg-slate-700 transition-colors"
              >
                + {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <label htmlFor="book-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="book-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Private notes…"
          maxLength={NOTES_MAX_LENGTH}
          rows={3}
          className={`w-full text-sm ${inputClass}`}
        />
      </div>
    </section>
  );
}

// ── Shelves panel ────────────────────────────────────────────────────────────

/** Shelf membership checkboxes — the card's ShelfPicker equivalent for this page,
    and the only shelf-management surface reachable on touch devices. */
function ShelvesPanel({ isbn, shelves }: { isbn: string; shelves: Shelf[] }) {
  const addMutation = useAddBookToShelf();
  const removeMutation = useRemoveBookFromShelf();
  const busy = addMutation.isPending || removeMutation.isPending;

  if (shelves.length === 0) return null;

  return (
    <section className="border-t border-paper-400 dark:border-slate-700 pt-6 mt-6 space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        Shelves
      </h2>
      <div className="space-y-1">
        {shelves.map((shelf) => {
          const checked = shelf.bookIds.includes(isbn);
          return (
            <label
              key={shelf.shelfId}
              className="flex w-fit cursor-pointer items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={busy}
                onChange={() =>
                  checked
                    ? removeMutation.mutate({ shelfId: shelf.shelfId, isbn })
                    : addMutation.mutate({ shelfId: shelf.shelfId, isbn })
                }
                className="accent-slate-700 dark:accent-slate-300 disabled:opacity-50"
              />
              <span className="truncate">{shelf.name}</span>
            </label>
          );
        })}
      </div>
      {(addMutation.isError || removeMutation.isError) && (
        <p className="text-xs text-red-500 dark:text-red-400">
          Couldn&apos;t update shelves — please try again.
        </p>
      )}
    </section>
  );
}

// ── Remove panel ─────────────────────────────────────────────────────────────

/** Confirmed removal — the safe home for deletion now that cards navigate on tap. */
function RemovePanel({ isbn, title }: { isbn: string; title: string }) {
  const navigate = useNavigate();
  const removeMutation = useRemoveFromShelf();
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="border-t border-paper-400 dark:border-slate-700 pt-6 mt-6">
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={removeMutation.isPending}
      >
        {removeMutation.isPending ? "Removing…" : "Remove from library"}
      </Button>
      {removeMutation.isError && (
        <p className="mt-2 text-xs text-red-500 dark:text-red-400">
          Couldn&apos;t remove this book — please try again.
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title="Remove book?"
        message={`"${title}" will be removed from your library, along with its tags and notes.`}
        confirmLabel="Remove"
        destructive
        pending={removeMutation.isPending}
        onConfirm={() =>
          removeMutation.mutate(isbn, {
            onSuccess: () => navigate("/shelf"),
            onSettled: () => setConfirming(false),
          })
        }
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function BookDetailPage() {
  const { isbn = "" } = useParams<{ isbn: string }>();
  const navigate = useNavigate();
  const entryQuery = useBookEntry(isbn);
  const shelvesQuery = useShelves();

  const entry = entryQuery.data;
  const title = entry?.book?.title ?? isbn;

  useEffect(() => {
    document.title = entry?.book?.title ? `${entry.book.title} — Bookshelf` : "Bookshelf";
    return () => {
      document.title = "Bookshelf";
    };
  }, [entry?.book?.title]);

  const onShelves = (shelvesQuery.data ?? []).filter((s) => s.bookIds.includes(isbn));
  // Any 4xx (missing book / invalid ISBN) means we can't show this book — retrying
  // won't help, so offer a way back rather than ShelfErrorState's "Try again".
  const cannotShow =
    entryQuery.error instanceof ApiError &&
    entryQuery.error.status >= 400 &&
    entryQuery.error.status < 500;

  return (
    <div className="min-h-screen bg-paper-100 dark:bg-slate-900 transition-colors">
      <AppHeader />

      <div className="border-b border-paper-300 dark:border-slate-800 px-4 sm:px-6 py-3">
        <Link
          to="/shelf"
          className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white flex items-center gap-1.5 w-fit"
        >
          <ChevronLeftIcon />
          My Library
        </Link>
      </div>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {entryQuery.isLoading && <ShelfSkeleton sections={1} />}

        {cannotShow && !entryQuery.isLoading && (
          <div className="pt-12 text-center">
            <p className="mb-1 text-slate-600 dark:text-slate-400">
              We couldn&apos;t find this book on your shelf.
            </p>
            <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
              It may have been removed.
            </p>
            <Button variant="app" onClick={() => navigate("/shelf")}>
              Back to My Library
            </Button>
          </div>
        )}

        {entryQuery.isError && !cannotShow && !entryQuery.isLoading && (
          <ShelfErrorState
            message="Couldn't load this book."
            onRetry={() => void entryQuery.refetch()}
            isRetrying={entryQuery.isFetching}
          />
        )}

        {entry && (
          <>
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="shrink-0 mx-auto sm:mx-0">
                <BookCover
                  coverUrl={entry.book?.coverUrl ?? null}
                  title={title}
                  authors={entry.book?.authors ?? []}
                  className="h-[240px]"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
                {(entry.book?.authors?.length ?? 0) > 0 && (
                  <p className="mt-1 text-slate-600 dark:text-slate-300">
                    {entry.book?.authors.join(", ")}
                    {entry.book?.publishedYear ? ` · ${entry.book.publishedYear}` : ""}
                  </p>
                )}
                {entry.book?.description && (
                  <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {entry.book.description}
                  </p>
                )}
                <p className="mt-3 font-mono text-xs text-slate-400 dark:text-slate-500">{isbn}</p>
                {onShelves.length > 0 && (
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                    On shelves:{" "}
                    {onShelves.map((s, i) => (
                      <span key={s.shelfId}>
                        {i > 0 && ", "}
                        <Link
                          to={`/shelves/${s.shelfId}`}
                          className="text-slate-900 dark:text-white underline underline-offset-2"
                        >
                          {s.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>

            <YourCopyPanel entry={entry} isbn={isbn} />
            <ShelvesPanel isbn={isbn} shelves={shelvesQuery.data ?? []} />
            <RemovePanel isbn={isbn} title={title} />
          </>
        )}
      </main>
    </div>
  );
}
