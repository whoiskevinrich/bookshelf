import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders, makeEntry } from "../test/utils";
import type { Shelf, ShelfEntry, TagCount } from "../lib/api-client";

// AppHeader pulls in the auth context / Amplify; stub it out for page tests.
vi.mock("../components/AppHeader", () => ({
  AppHeader: () => <header data-testid="app-header" />,
}));
vi.mock("../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api-client")>();
  return {
    ...actual,
    fetchShelfEntry: vi.fn(),
    fetchShelves: vi.fn(),
    fetchTags: vi.fn(),
    updateShelfAttributes: vi.fn(),
    updateShelfTags: vi.fn(),
    updateShelfNotes: vi.fn(),
    removeFromShelf: vi.fn(),
    addBookToShelf: vi.fn(),
    removeBookFromShelf: vi.fn(),
  };
});

import {
  fetchShelfEntry,
  fetchShelves,
  fetchTags,
  updateShelfAttributes,
  updateShelfTags,
  updateShelfNotes,
  removeFromShelf,
  addBookToShelf,
  removeBookFromShelf,
  ApiError,
} from "../lib/api-client";
import { BookDetailPage } from "./BookDetailPage";

const ISBN = "9780441013593";
const mockFetchEntry = vi.mocked(fetchShelfEntry);
const mockFetchShelves = vi.mocked(fetchShelves);
const mockFetchTags = vi.mocked(fetchTags);
const mockUpdateAttrs = vi.mocked(updateShelfAttributes);
const mockUpdateTags = vi.mocked(updateShelfTags);
const mockUpdateNotes = vi.mocked(updateShelfNotes);
const mockRemoveEntry = vi.mocked(removeFromShelf);
const mockAddBookToShelf = vi.mocked(addBookToShelf);
const mockRemoveBookFromShelf = vi.mocked(removeBookFromShelf);

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/book/:isbn" element={<BookDetailPage />} />
      <Route path="/shelf" element={<div>Library page</div>} />
    </Routes>,
    { routerEntries: [`/book/${ISBN}`] },
  );
}

function resolveEntry(overrides: Partial<ShelfEntry> = {}) {
  mockFetchEntry.mockResolvedValue(makeEntry({ isbn: ISBN, ...overrides }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override as needed.
  mockFetchShelves.mockResolvedValue([] as Shelf[]);
  mockFetchTags.mockResolvedValue([] as TagCount[]);
});

describe("BookDetailPage — load states", () => {
  it("renders the book once loaded", async () => {
    resolveEntry({
      book: {
        title: "Dune",
        authors: ["Frank Herbert"],
        coverUrl: null,
        publishedYear: 1965,
        description: "A desert planet epic.",
      },
    });
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Dune" })).toBeInTheDocument();
    // Metadata line combines author + year (distinct from the cover fallback label).
    expect(screen.getByText(/Frank Herbert · 1965/)).toBeInTheDocument();
    expect(screen.getByText("A desert planet epic.")).toBeInTheDocument();
    expect(screen.getByText(ISBN)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Dune — Bookshelf"));
  });

  it("shows a not-found message (no retry) on a 4xx", async () => {
    mockFetchEntry.mockRejectedValue(new ApiError(404, "not found"));
    renderPage();

    expect(
      await screen.findByText("We couldn't find this book on your shelf."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to My Library" })).toBeInTheDocument();
  });

  it("shows a retryable error state on a non-4xx failure", async () => {
    mockFetchEntry.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText("Couldn't load this book.")).toBeInTheDocument();
  });

  it("lists the custom shelves the book is on", async () => {
    resolveEntry();
    mockFetchShelves.mockResolvedValue([
      { shelfId: "s1", name: "Favorites", createdAt: "", bookIds: [ISBN] },
      { shelfId: "s2", name: "Elsewhere", createdAt: "", bookIds: ["other"] },
    ]);
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    const link = await screen.findByRole("link", { name: "Favorites" });
    expect(link).toHaveAttribute("href", "/shelves/s1");
    expect(screen.queryByRole("link", { name: "Elsewhere" })).not.toBeInTheDocument();
  });
});

describe("BookDetailPage — Your copy panel (#82)", () => {
  it("reflects owned status and switches to want", async () => {
    const user = userEvent.setup();
    resolveEntry({ owned: true, want: false });
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: ISBN, owned: false, want: true }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    const ownedRadio = screen.getByRole("radio", { name: "Owned" });
    expect(ownedRadio).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "Wishlist" }));
    expect(mockUpdateAttrs).toHaveBeenCalledWith(ISBN, { want: true });
  });

  it("sets reading status", async () => {
    const user = userEvent.setup();
    resolveEntry({ readingStatus: null });
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: ISBN, readingStatus: "reading" }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("radio", { name: "Reading" }));
    expect(mockUpdateAttrs).toHaveBeenCalledWith(ISBN, { readingStatus: "reading" });
  });

  it("adds a tag through the add form", async () => {
    const user = userEvent.setup();
    resolveEntry({ tags: ["sci-fi"] });
    mockUpdateTags.mockResolvedValue(makeEntry({ isbn: ISBN, tags: ["fantasy", "sci-fi"] }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    await user.type(screen.getByRole("textbox", { name: "Add a tag" }), "fantasy");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(mockUpdateTags).toHaveBeenCalledWith(ISBN, ["sci-fi", "fantasy"]);
  });

  it("removes a tag via its chip button", async () => {
    const user = userEvent.setup();
    resolveEntry({ tags: ["sci-fi", "fantasy"] });
    mockUpdateTags.mockResolvedValue(makeEntry({ isbn: ISBN, tags: ["fantasy"] }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Remove tag sci-fi" }));
    expect(mockUpdateTags).toHaveBeenCalledWith(ISBN, ["fantasy"]);
  });

  it("hides the add form and shows the limit message at 25 tags", async () => {
    const tags = Array.from({ length: 25 }, (_, i) => `tag-${i}`);
    resolveEntry({ tags });
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/reached the 25-tag limit/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Add a tag" })).not.toBeInTheDocument();
  });

  it("offers tag suggestions from the library and adds on click", async () => {
    const user = userEvent.setup();
    resolveEntry({ tags: [] });
    mockFetchTags.mockResolvedValue([
      { tag: "fantasy", count: 3 },
      { tag: "history", count: 1 },
    ]);
    mockUpdateTags.mockResolvedValue(makeEntry({ isbn: ISBN, tags: ["fantasy"] }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    const suggestion = await screen.findByRole("button", { name: "+ fantasy" });
    await user.click(suggestion);
    expect(mockUpdateTags).toHaveBeenCalledWith(ISBN, ["fantasy"]);
  });

  it("hides the Copies stepper for a wishlisted book", async () => {
    resolveEntry({ owned: false, want: true, copies: 1 });
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Copies")).not.toBeInTheDocument();
  });

  it("shows the current copies count for an owned book", async () => {
    resolveEntry({ owned: true, copies: 2 });
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Copies")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("increments copies via the + button", async () => {
    const user = userEvent.setup();
    resolveEntry({ owned: true, copies: 2 });
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: ISBN, owned: true, copies: 3 }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Add a copy" }));
    expect(mockUpdateAttrs).toHaveBeenCalledWith(ISBN, { copies: 3 });
  });

  it("decrements copies via the - button", async () => {
    const user = userEvent.setup();
    resolveEntry({ owned: true, copies: 2 });
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: ISBN, owned: true, copies: 1 }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Remove a copy" }));
    expect(mockUpdateAttrs).toHaveBeenCalledWith(ISBN, { copies: 1 });
  });

  it("disables the - button at the floor of 1 (not a delete shortcut)", async () => {
    resolveEntry({ owned: true, copies: 1 });
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Remove a copy" })).toBeDisabled();
  });

  it("disables the + button at the ceiling of 99", async () => {
    resolveEntry({ owned: true, copies: 99 });
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Add a copy" })).toBeDisabled();
  });

  it("saves notes on blur", async () => {
    const user = userEvent.setup();
    resolveEntry({ notes: null });
    mockUpdateNotes.mockResolvedValue(makeEntry({ isbn: ISBN, notes: "Great read" }));
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    const notes = screen.getByLabelText("Notes");
    await user.type(notes, "Great read");
    await user.tab(); // blur

    await waitFor(() => expect(mockUpdateNotes).toHaveBeenCalledWith(ISBN, "Great read"));
  });
});

describe("BookDetailPage — shelves panel", () => {
  it("toggles shelf membership from the Shelves checkboxes", async () => {
    const user = userEvent.setup();
    resolveEntry();
    mockFetchShelves.mockResolvedValue([
      { shelfId: "s1", name: "Favorites", createdAt: "", bookIds: [ISBN] },
      { shelfId: "s2", name: "To donate", createdAt: "", bookIds: [] },
    ]);
    mockAddBookToShelf.mockResolvedValue(undefined as never);
    mockRemoveBookFromShelf.mockResolvedValue(undefined as never);
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    // Favorites contains the book → checked → toggling removes.
    const favorites = await screen.findByRole("checkbox", { name: "Favorites" });
    expect(favorites).toBeChecked();
    await user.click(favorites);
    expect(mockRemoveBookFromShelf).toHaveBeenCalledWith("s1", ISBN);

    // To donate does not → toggling adds (wait out the in-flight disable first).
    const toDonate = screen.getByRole("checkbox", { name: "To donate" });
    await waitFor(() => expect(toDonate).toBeEnabled());
    await user.click(toDonate);
    expect(mockAddBookToShelf).toHaveBeenCalledWith("s2", ISBN);
  });

  it("hides the Shelves panel when there are no shelves", async () => {
    resolveEntry();
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Shelves")).not.toBeInTheDocument();
  });
});

describe("BookDetailPage — remove from library", () => {
  it("removes only after confirmation, then navigates back to the library", async () => {
    const user = userEvent.setup();
    resolveEntry();
    mockRemoveEntry.mockResolvedValue(undefined as never);
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Remove from library" }));
    // The dialog gates the destructive action — nothing removed yet.
    expect(mockRemoveEntry).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(mockRemoveEntry).toHaveBeenCalledWith(ISBN);
    expect(await screen.findByText("Library page")).toBeInTheDocument();
  });

  it("keeps the book when the removal is cancelled", async () => {
    const user = userEvent.setup();
    resolveEntry();
    renderPage();

    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Remove from library" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockRemoveEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
