import type { ShelfEntry } from "./api-client";

// ── Sort model (BOOKSHELF-57, Phase 1) ───────────────────────────────────────
//
// Sort keys pair a field with a direction so the whole choice is a single
// serializable token — persisted in localStorage (see `useLocalStorage`) and
// applied client-side via `sortEntries`. Every rendered library grid runs
// through the same helper, so sort composes with facet/tag filters, the reading
// list, and free-text search.

export type SortKey =
  | "added-desc"
  | "added-asc"
  | "title-asc"
  | "author-asc"
  | "release-desc"
  | "release-asc";

/** Server order is ISBN-arbitrary, so "recently added" is the sensible default. */
export const DEFAULT_SORT: SortKey = "added-desc";

export interface SortOption {
  value: SortKey;
  label: string;
  /** optgroup heading, so related directions cluster in the menu. */
  group: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { value: "added-desc", label: "Recently added", group: "Date added" },
  { value: "added-asc", label: "Oldest added", group: "Date added" },
  { value: "title-asc", label: "Title (A–Z)", group: "Title" },
  { value: "author-asc", label: "Author (A–Z)", group: "Author" },
  { value: "release-desc", label: "Newest release", group: "Release date" },
  { value: "release-asc", label: "Oldest release", group: "Release date" },
];

export function sortLabel(key: SortKey): string {
  return SORT_OPTIONS.find((o) => o.value === key)?.label ?? key;
}

/** Narrow an untrusted string (stored pref) to a known SortKey, or null. */
export function parseSortKey(raw: string | null | undefined): SortKey | null {
  return raw && SORT_OPTIONS.some((o) => o.value === raw) ? (raw as SortKey) : null;
}

// ── Comparators ──────────────────────────────────────────────────────────────

function titleKey(e: ShelfEntry): string {
  return (e.book?.title ?? "").trim();
}

// Sort by the first author's name exactly as displayed ("Frank Herbert"), not by
// surname — reliably parsing a last name from free-form names ("bell hooks",
// "J.R.R. Tolkien", suffixes, non-Western order) is fragile and would surprise
// more than it helps.
function authorKey(e: ShelfEntry): string {
  return (e.book?.authors?.[0] ?? "").trim();
}

/** Locale-aware string compare; empties (missing metadata) always sort last. */
function compareText(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/** Title tiebreaker keeps equal primary keys in a stable, sensible order. */
function byTitle(a: ShelfEntry, b: ShelfEntry): number {
  return compareText(titleKey(a), titleKey(b));
}

/** Missing years always sort last, regardless of direction. */
function compareYear(a: ShelfEntry, b: ShelfEntry, dir: "asc" | "desc"): number {
  const ya = a.book?.publishedYear ?? null;
  const yb = b.book?.publishedYear ?? null;
  if (ya === null && yb === null) return 0;
  if (ya === null) return 1;
  if (yb === null) return -1;
  return dir === "asc" ? ya - yb : yb - ya;
}

/** addedAt is an ISO timestamp, so lexical compare is chronological. */
function compareAdded(a: ShelfEntry, b: ShelfEntry, dir: "asc" | "desc"): number {
  const cmp = a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0;
  return dir === "desc" ? -cmp : cmp;
}

const COMPARATORS: Record<SortKey, (a: ShelfEntry, b: ShelfEntry) => number> = {
  "added-desc": (a, b) => compareAdded(a, b, "desc") || byTitle(a, b),
  "added-asc": (a, b) => compareAdded(a, b, "asc") || byTitle(a, b),
  "title-asc": (a, b) => compareText(titleKey(a), titleKey(b)) || compareAdded(a, b, "desc"),
  "author-asc": (a, b) => compareText(authorKey(a), authorKey(b)) || byTitle(a, b),
  "release-desc": (a, b) => compareYear(a, b, "desc") || byTitle(a, b),
  "release-asc": (a, b) => compareYear(a, b, "asc") || byTitle(a, b),
};

/**
 * Return a new array of `entries` sorted by `key`. Pure and non-mutating, so it's
 * safe to call inside a `useMemo` over query data.
 */
export function sortEntries(entries: ShelfEntry[], key: SortKey): ShelfEntry[] {
  return [...entries].sort(COMPARATORS[key]);
}
