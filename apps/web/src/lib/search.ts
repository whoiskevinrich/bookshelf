import type { ShelfEntry } from "./api-client";

// Unicode combining diacritical marks (U+0300–U+036F), left behind by NFD
// decomposition — stripping them folds "é" → "e", "ñ" → "n", etc.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Fold a string for accent-insensitive substring matching: decompose combining
 * marks (NFD), strip them, lowercase, and trim. So "Émile" and "emile" match,
 * and "Márquez" is found by typing "marquez".
 */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().trim();
}

/**
 * Does a library entry match a free-text query? Matches on the book's title and
 * author names, case- and diacritic-insensitive. The query is tokenized on
 * whitespace and every token must appear (order-independent), so "tolkien hobbit"
 * finds "The Hobbit" by "J.R.R. Tolkien". An empty/whitespace query matches all.
 */
export function entryMatchesQuery(entry: ShelfEntry, query: string): boolean {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeForSearch(
    [entry.book?.title ?? "", ...(entry.book?.authors ?? [])].join(" "),
  );
  return normalizedQuery.split(/\s+/).every((token) => haystack.includes(token));
}
