import { useState, useEffect, useRef, useCallback } from "react";
import { searchBooks, getBookByIsbn, type BookSearchResult } from "../lib/api-client";
import { isValidIsbn } from "../lib/isbn";
import { BookCover } from "./BookCover";
import { Button } from "./ui/Button";
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
  const [activeIndex, setActiveIndex] = useState(-1); // -1 = input focused
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<(HTMLDivElement | null)[]>([]);

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

  // Reset active index whenever results change.
  useEffect(() => {
    setActiveIndex(-1);
    resultRefs.current = [];
  }, [results]);

  // Move DOM focus to match activeIndex.
  useEffect(() => {
    if (activeIndex === -1) {
      inputRef.current?.focus();
    } else {
      const el = resultRefs.current[activeIndex];
      el?.focus();
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIndex]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setActiveIndex(0);
    }
  }

  function handleResultKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    index: number,
    book: BookSearchResult,
  ) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex(Math.min(index + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex(index > 0 ? index - 1 : -1);
        break;
      case "Enter":
        e.preventDefault();
        if (!isAdding) onAdd(book.isbn, "owned", book);
        break;
      case "Escape":
        setActiveIndex(-1);
        break;
    }
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleInputKeyDown}
        placeholder="Search by title, author, or paste an ISBN…"
        className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300"
      />

      <div role="status" aria-live="polite" aria-atomic="true">
        {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Searching…</p>}
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
          <p className="text-sm text-slate-500 dark:text-slate-400">No results found.</p>
        )}
      </div>

      {results.length > 0 && (
        <div role="listbox" aria-label="Search results" className="space-y-2">
          {results.map((book, index) => (
            <div
              key={book.isbn}
              ref={(el) => {
                resultRefs.current[index] = el;
              }}
              role="option"
              aria-selected={activeIndex === index}
              tabIndex={0}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(e) => handleResultKeyDown(e, index, book)}
              className={`flex gap-3 items-start border rounded-lg p-3 outline-none cursor-default transition-colors ${
                activeIndex === index
                  ? "border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-700/50 ring-1 ring-slate-400 dark:ring-slate-500"
                  : "border-slate-100 dark:border-slate-700"
              }`}
            >
              <BookCover
                key={book.coverUrl ?? "no-cover"}
                coverUrl={book.coverUrl}
                title={book.title}
                authors={book.authors}
                className="w-10 h-14 flex-shrink-0 rounded"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight dark:text-white">{book.title}</p>
                {book.authors.length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {book.authors.join(", ")}
                  </p>
                )}
                {book.publishedYear && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{book.publishedYear}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <Button
                  variant="app"
                  size="sm"
                  onClick={() => onAdd(book.isbn, "owned", book)}
                  disabled={isAdding}
                >
                  Add Owned
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onAdd(book.isbn, "want", book)}
                  disabled={isAdding}
                >
                  Add to Wishlist
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
