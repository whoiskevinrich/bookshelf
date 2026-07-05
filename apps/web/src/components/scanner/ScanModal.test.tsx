import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { ScannerPreferencesProvider } from "../../context/ScannerPreferencesContext";

// Camera-less environment: the modal opens straight onto the manual-entry panel.
// (This is the exact surface of the "Enter finds the book but can't add" bug.)
vi.mock("../../hooks/useBarcodeScanner", () => ({
  useBarcodeScanner: () => ({ videoRef: { current: null }, status: "no-camera", retry: vi.fn() }),
}));
vi.mock("../../lib/runtime-config", () => ({
  getRuntimeConfig: () => ({ features: { ocrScan: false } }),
}));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, getBookByIsbn: vi.fn(), addToShelf: vi.fn() };
});

import { getBookByIsbn, addToShelf, ApiError, type BookSearchResult } from "../../lib/api-client";
import { ScanModal } from "./ScanModal";

const ISBN = "9780441013593";
const BOOK: BookSearchResult = {
  isbn: ISBN,
  title: "Dune",
  authors: ["Frank Herbert"],
  coverUrl: null,
  publishedYear: 1965,
  description: null,
};

const mockGetBook = vi.mocked(getBookByIsbn);
const mockAdd = vi.mocked(addToShelf);

function renderModal() {
  return renderWithProviders(
    <ScannerPreferencesProvider>
      <ScanModal onClose={vi.fn()} />
    </ScannerPreferencesProvider>,
  );
}

async function lookUpViaEnter(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ISBN"), ISBN);
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("ScanModal — manual entry via Enter", () => {
  it("looks up on Enter, unmounts the manual panel, and focuses the confirm action", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(BOOK);
    mockAdd.mockResolvedValue({} as never);
    renderModal();

    expect(screen.getByText("Camera unavailable")).toBeInTheDocument();
    await lookUpViaEnter(user);

    expect(await screen.findByText(/Barcode found/)).toBeInTheDocument();
    // The manual panel must be gone — mounted, its input stole focus from the
    // confirm sheet and Enter re-ran the lookup instead of adding.
    expect(screen.queryByLabelText("ISBN")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add owned" })).toHaveFocus());

    // Enter now activates the focused primary action and completes the add.
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/Added to your shelf/)).toBeInTheDocument();
    expect(mockAdd).toHaveBeenCalledWith(ISBN, "owned", BOOK);
  });

  it("emphasises the remembered Wishlist destination on the confirm sheet (BOOKSHELF-58)", async () => {
    // Reopening with Wishlist remembered → it's the primary, autofocused action, so
    // Enter adds to the wishlist without the user re-picking it.
    window.localStorage.setItem("scanner:destination", "want");
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(BOOK);
    mockAdd.mockResolvedValue({} as never);
    renderModal();

    await lookUpViaEnter(user);

    expect(await screen.findByText(/Barcode found/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to wishlist" })).toHaveFocus(),
    );

    await user.keyboard("{Enter}");
    expect(await screen.findByText(/Added to wishlist/)).toBeInTheDocument();
    expect(mockAdd).toHaveBeenCalledWith(ISBN, "want", BOOK);
  });

  it("rejects an invalid ISBN on Enter without a lookup", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText("ISBN"), "12345");
    await user.keyboard("{Enter}");

    expect(screen.getByText("Enter a valid 10- or 13-digit ISBN.")).toBeInTheDocument();
    expect(mockGetBook).not.toHaveBeenCalled();
  });
});

describe("ScanModal — add error messages", () => {
  it("shows a duplicate-specific message on a 409", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(BOOK);
    mockAdd.mockRejectedValue(new ApiError(409, "Book already exists on your shelf"));
    renderModal();

    await lookUpViaEnter(user);
    await user.click(await screen.findByRole("button", { name: "Add owned" }));

    expect(await screen.findByText("That book is already on your shelf.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't add that book — try again.")).not.toBeInTheDocument();
  });

  it("keeps the generic message for non-duplicate failures", async () => {
    const user = userEvent.setup();
    mockGetBook.mockResolvedValue(BOOK);
    mockAdd.mockRejectedValue(new Error("network down"));
    renderModal();

    await lookUpViaEnter(user);
    await user.click(await screen.findByRole("button", { name: "Add owned" }));

    expect(await screen.findByText("Couldn't add that book — try again.")).toBeInTheDocument();
  });
});
