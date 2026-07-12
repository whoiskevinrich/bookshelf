import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeEntry, makeEntryDetail, makeShelfPage } from "../test/utils";
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
    removeFromShelf: vi.fn(),
    updateShelfStatus: vi.fn(),
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
  removeFromShelf,
  updateShelfStatus,
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
const mockRemove = vi.mocked(removeFromShelf);
const mockUpdateStatus = vi.mocked(updateShelfStatus);

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
    mockFetchEntry.mockResolvedValue(makeEntryDetail({ isbn: OWNED_ISBN, owned: true, copies: 1 }));
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
      makeEntryDetail({ isbn: WISH_ISBN, owned: false, want: true, status: "want", copies: 1 }),
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
    mockFetchEntry.mockResolvedValue(makeEntryDetail({ isbn: OWNED_ISBN, owned: true, copies: 1 }));
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

describe("ShelfPage — add-time edition grouping (BOOKSHELF-91)", () => {
  it("shows a grouped notice with Keep separate when an add auto-joins a work", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(bookResult(OWNED_ISBN, "Dune"));
    mockAdd.mockResolvedValue({ ...makeEntry({ isbn: OWNED_ISBN }), groupedWith: [WISH_ISBN] });
    mockUpdateAttrs.mockResolvedValue(makeEntry({ isbn: OWNED_ISBN }));
    renderPage();

    await addOwnedViaSearch(user, OWNED_ISBN);

    expect(await screen.findByText(/Grouped as one of 2 editions/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep separate" }));
    await waitFor(() =>
      expect(mockUpdateAttrs).toHaveBeenCalledWith(OWNED_ISBN, { grouped: false }),
    );
  });

  it("shows no grouped notice for a solo add", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(bookResult(OWNED_ISBN, "Dune"));
    mockAdd.mockResolvedValue({ ...makeEntry({ isbn: OWNED_ISBN }), groupedWith: [] });
    renderPage();

    await addOwnedViaSearch(user, OWNED_ISBN);

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(screen.queryByText(/Grouped as one of/)).not.toBeInTheDocument();
  });
});

describe("ShelfPage — Manage mode bulk actions (BOOKSHELF-59)", () => {
  it("enters/exits Manage mode with a header swap and a sticky action bar", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("button", { name: "Manage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));

    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a book" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Manage library" })).toBeInTheDocument();
    expect(screen.getByText("0 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("group", { name: "Manage library" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a book" })).toBeInTheDocument();
  });

  it("selects a book and bulk-deletes it, confirming the count and reporting the result", async () => {
    const user = userEvent.setup();
    mockRemove.mockResolvedValue(undefined);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("checkbox", { name: /Select/ }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete 1 book?");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(OWNED_ISBN));
    expect(await screen.findByText("Deleted 1 of 1 books")).toBeInTheDocument();
  });

  it("bulk-moves the selection to Owned via updateShelfStatus", async () => {
    const user = userEvent.setup();
    mockUpdateStatus.mockResolvedValue(makeEntry({ isbn: OWNED_ISBN, owned: true }));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("checkbox", { name: /Select/ }));
    await user.click(screen.getByRole("button", { name: "Move to Owned" }));

    await waitFor(() => expect(mockUpdateStatus).toHaveBeenCalledWith(OWNED_ISBN, "owned"));
  });

  it("clears the selection when the active view changes (facet filter)", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("checkbox", { name: /Select/ }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    // Switching the facet filter changes which entry set is "visible" — a stale
    // selection could otherwise merge bulk-tag changes against a book the new
    // view never loaded, silently wiping its existing tags.
    await user.click(screen.getByRole("button", { name: "Owned" }));

    await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
  });
});
