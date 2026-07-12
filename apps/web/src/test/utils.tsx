/**
 * Shared test helpers — provider wrappers and data factories.
 *
 * Keep these dependency-light: they wrap components/hooks in the same providers
 * `main.tsx` uses (React Query + Router) so tests exercise realistic context.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type {
  BookMetadata,
  EditionSummary,
  ShelfEntry,
  ShelfEntryDetail,
  ShelfPage,
  SmartShelfWithCount,
} from "../lib/api-client";

/**
 * A QueryClient tuned for tests: retries off (so a rejected mutation surfaces an
 * error immediately instead of backing off) and no caching surprises.
 */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** Wrapper for `renderHook` — React Query context only. */
export function createQueryWrapper(client = makeTestQueryClient()) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { Wrapper, client };
}

interface ProviderOptions extends Omit<RenderOptions, "wrapper"> {
  client?: QueryClient;
  /** Initial router entries; defaults to a single "/" entry. */
  routerEntries?: string[];
}

/** Render a component inside the React Query + Router providers. */
export function renderWithProviders(
  ui: ReactNode,
  { client = makeTestQueryClient(), routerEntries = ["/"], ...options }: ProviderOptions = {},
): RenderResult & { client: QueryClient } {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={routerEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
}

// ── Data factories ───────────────────────────────────────────────────────────

export function makeBook(overrides: Partial<BookMetadata> = {}): BookMetadata {
  return {
    title: "Dune",
    authors: ["Frank Herbert"],
    coverUrl: "https://example.com/dune.jpg",
    publishedYear: 1965,
    description: "A desert planet epic.",
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    isbn: "9780441013593",
    owned: true,
    want: false,
    readingStatus: null,
    tags: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    notes: null,
    copies: 1,
    format: null,
    status: "owned",
    book: makeBook(),
    ...overrides,
  };
}

/** A single edition summary derived from an entry (self-edition by default). */
function selfEdition(entry: ShelfEntry): EditionSummary {
  return {
    isbn: entry.isbn,
    format: entry.format,
    owned: entry.owned,
    want: entry.want,
    readingStatus: entry.readingStatus,
    book: entry.book,
  };
}

/**
 * A book-detail payload (BOOKSHELF-91). Defaults `editions` to just this entry (a
 * solo work); pass `editions` to simulate a multi-edition work.
 */
export function makeEntryDetail(overrides: Partial<ShelfEntryDetail> = {}): ShelfEntryDetail {
  const { editions, ...entryOverrides } = overrides;
  const entry = makeEntry(entryOverrides);
  return { ...entry, editions: editions ?? [selfEdition(entry)] };
}

export function makeShelfPage(
  entries: ShelfEntry[],
  overrides: Partial<ShelfPage> = {},
): ShelfPage {
  return {
    entries,
    nextCursor: null,
    total: entries.length,
    ...overrides,
  };
}

export function makeSmartShelf(overrides: Partial<SmartShelfWithCount> = {}): SmartShelfWithCount {
  return {
    smartShelfId: "ss_1",
    name: "Currently reading",
    rule: { readingStatus: "reading" },
    createdAt: "2026-01-01T00:00:00.000Z",
    count: 3,
    ...overrides,
  };
}
