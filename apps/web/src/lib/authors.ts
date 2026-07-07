import type { ShelfEntry } from "./api-client";

// ── Author derivation (BOOKSHELF-57, Phase 1) ────────────────────────────────
//
// The author filter is derived entirely from loaded library data — no endpoint.
// Options come from the authors present on loaded entries (same "loaded books
// only" scope as free-text search and tag browse), and filtering matches a book
// if *any* of its authors equals the picked name (so co-authored books surface
// under each contributor).

export interface AuthorCount {
  author: string;
  count: number;
}

/**
 * Distinct author names across `entries`, each with how many books they appear
 * on. Sorted by count (desc) then name, so the most-represented authors lead —
 * mirrors how tag browse ranks tags.
 */
export function deriveAuthors(entries: ShelfEntry[]): AuthorCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const raw of entry.book?.authors ?? []) {
      const name = raw.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
}

/** Does the book have `author` among its authors? Exact match on the trimmed name. */
export function entryHasAuthor(entry: ShelfEntry, author: string): boolean {
  return (entry.book?.authors ?? []).some((a) => a.trim() === author);
}
