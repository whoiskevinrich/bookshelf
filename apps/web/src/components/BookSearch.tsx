import { useState, useEffect, useRef, useCallback } from "react";
import { searchBooks, getBookByIsbn, type BookSearchResult } from "../lib/api-client";
import { isValidIsbn } from "../lib/isbn";
import { BookCover } from "./BookCover";
import type { ShelfStatus } from "../lib/api-client";

interface BookSearchProps {
  onAdd: (isbn: string, status: ShelfStatus, book: BookSearchResult) => void;
  isAdding?: boolean;
}

export function BookSearch({ onAdd, isAdding }: BookSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      if (isValidIsbn(q)) {
        const book = await getBookByIsbn(q);
        setResults(book ? [book] : []);
      } else {
        const books = await searchBooks(q);
        setResults(books);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError(null);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runSearch(q), 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch]);

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title, author, or paste an ISBN…"
        className="w-full border border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-zinc-500"
      />

      {loading && <p className="text-sm text-gray-500 dark:text-zinc-400">Searching…</p>}
      {error && (
        <p className="text-sm text-red-500 dark:text-red-400">
          {error}{" "}
          <button
            onClick={() => void runSearch(query.trim())}
            className="underline hover:no-underline"
          >
            Try again
          </button>
        </p>
      )}

      {results.length === 0 && !loading && !error && query.trim().length > 0 && (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No results found.</p>
      )}

      <div className="space-y-3">
        {results.map((book) => (
          <div
            key={book.isbn}
            className="flex gap-3 items-start border border-gray-100 dark:border-zinc-700 rounded-lg p-3"
          >
            <BookCover
              coverUrl={book.coverUrl}
              title={book.title}
              className="w-10 h-14 flex-shrink-0 rounded"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight dark:text-white">{book.title}</p>
              {book.authors.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  {book.authors.join(", ")}
                </p>
              )}
              {book.publishedYear && (
                <p className="text-xs text-gray-500 dark:text-zinc-400">{book.publishedYear}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <button
                onClick={() => onAdd(book.isbn, "owned", book)}
                disabled={isAdding}
                className="text-xs bg-gray-900 text-white px-2.5 py-1 rounded hover:bg-gray-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                Add Owned
              </button>
              <button
                onClick={() => onAdd(book.isbn, "want", book)}
                disabled={isAdding}
                className="text-xs border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 px-2.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                Add to Wishlist
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
