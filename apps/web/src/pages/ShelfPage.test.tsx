import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeEntry, makeShelfPage } from "../test/utils";
import type { BookSearchResult, Shelf, TagCount } from "../lib/api-client";

// AppHeader pulls in the auth context / Amplify; stub it for page tests.
vi.mock("../components/AppHeader", () => ({
  AppHeader: () => <header data-testid="app-header" />,
}));
// Keep the scanner out of the way — no camera in jsdom.
vi.mock("../lib/device", () => ({ supportsCameraScan: () => false }));
vi.mock("../lib/runtime-config", () => ({
  getRuntimeConfig: () => ({ apiBaseUrl: "", features: { scanner: false } }),
}));

vi.mock("../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api-client")>();
  return {
    ...actual,
    fetchShelf: vi.fn(),
    fetchTags: vi.fn(),
    fetchShelves: vi.fn(),
    fetchSmartShelves: vi.fn(),
    getBookByIsbn: vi.fn(),
    searchBooks: vi.fn(),
    addToShelf: vi.fn(),
    fetchShelfEntry: vi.fn(),
    updateShelfAttributes: vi.fn(),
  };
});

import {
  fetchShelf,
  fetchTags,
  fetchShelves,
  fetchSmartShelves,
  getBookByIsbn,
  addToShelf,
  fetchShelfEntry,
  updateShelfAttributes,
  ApiError,
} from "../lib/api-client";
import { ShelfPage } from "./ShelfPage";

const OWNED_ISBN = "9780441013593"; // Dune — seeded as an owned library entry
const WISH_ISBN = "9780553283686"; // Hyperion — used as a wishlisted duplicate

const mockFetchShelf = vi.mocked(fetchShelf);
const mockFetchTags = vi.mocked(fetchTags);
const mockFetchShelves = vi.mocked(fetchShelves);
const mockFetchSmartShelves = vi.mocked(fetchSmartShelves);
const mockGetBook = vi.mocked(getBookByIsbn);
const mockAdd = vi.mocked(addToShelf);
const mockFetchEntry = vi.mocked(fetchShelfEntry);
const mockUpdateAttrs = vi.mocked(updateShelfAttributes);

function bookResult(isbn: string, title: string): BookSearchResult {
  return {
    isbn,
    title,
    authors: ["Author"],
    coverUrl: null,
    publishedYear: 2000,
    description: null,
  };
}

function renderPage() {
  return renderWithProviders(<ShelfPage />, { routerEntries: ["/shelf"] });
}

/** Open the add-a-book panel, search an ISBN, and click "Add Owned". */
async function addOwnedViaSearch(user: ReturnType<typeof userEvent.setup>, isbn: string) {
  await user.click(await screen.findByRole("button", { name: "Add a book" }));
  const input = await screen.findByPlaceholderText(/paste an ISBN/i);
  await user.type(input, isbn);
  await user.click(await screen.findByRole("button", { name: "Add Owned" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement scrollIntoView; ShelfPage calls it when the search
  // panel opens.
  Element.prototype.scrollIntoView = vi.fn();
  // Non-empty library so the normal layout (not the empty state) renders.
  mockFetchShelf.mockResolvedValue(makeShelfPage([makeEntry({ isbn: OWNED_ISBN })]));
  mockFetchTags.mockResolvedValue([] as TagCount[]);
  mockFetchShelves.mockResolvedValue([] as Shelf[]);
  mockFetchSmartShelves.mockResolvedValue([]);
});

describe("ShelfPage — duplicate add offers 'add another copy' (BOOKSHELF-60)", () => {
  it("offers to add another copy when the duplicate is an owned book, and increments on confirm", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(bookResult(OWNED_ISBN, "Dune"));
    mockAdd.mockRejectedValue(new ApiError(409, "Book already exists on your shelf"));
    mockFetchEntry.mockResolvedValue(makeEntry({ isbn: OWNED_ISBN, owned: true, copies: 1 }));
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: OWNED_ISBN, owned: true, copies: 2 }));

    renderPage();
    await addOwnedViaSearch(user, OWNED_ISBN);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Add another copy?");

    await user.click(within(dialog).getByRole("button", { name: "Add another copy" }));

    await waitFor(() => expect(mockUpdateAttrs).toHaveBeenCalledWith(OWNED_ISBN, { copies: 2 }));
    // Dialog closes on success.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does NOT offer to add another copy when the duplicate is only on the wishlist", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(bookResult(WISH_ISBN, "Hyperion"));
    mockAdd.mockRejectedValue(new ApiError(409, "Book already exists on your shelf"));
    // The 409 fires for a wishlisted book too — but copies is owned-only, so the
    // ownership lookup must gate the offer off.
    mockFetchEntry.mockResolvedValue(
      makeEntry({ isbn: WISH_ISBN, owned: false, want: true, status: "want", copies: 1 }),
    );

    renderPage();
    await addOwnedViaSearch(user, WISH_ISBN);

    expect(await screen.findByText("That book is already on your shelf.")).toBeInTheDocument();
    await waitFor(() => expect(mockFetchEntry).toHaveBeenCalledWith(WISH_ISBN));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdateAttrs).not.toHaveBeenCalled();
  });

  it("surfaces the failure inside the dialog when the increment fails", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(bookResult(OWNED_ISBN, "Dune"));
    mockAdd.mockRejectedValue(new ApiError(409, "Book already exists on your shelf"));
    mockFetchEntry.mockResolvedValue(makeEntry({ isbn: OWNED_ISBN, owned: true, copies: 1 }));
    mockUpdateAttrs.mockRejectedValue(new Error("network"));

    renderPage();
    await addOwnedViaSearch(user, OWNED_ISBN);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add another copy" }));

    // Error renders inside the still-open dialog, not behind it.
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByText(/Couldn't add another copy/i),
      ).toBeInTheDocument(),
    );
  });
});
