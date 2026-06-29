import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeBook } from "../test/utils";
import type { BookSearchResult } from "../lib/api-client";

vi.mock("../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api-client")>();
  return { ...actual, searchBooks: vi.fn(), getBookByIsbn: vi.fn() };
});

import { searchBooks, getBookByIsbn } from "../lib/api-client";
import { BookSearch } from "./BookSearch";

const mockSearch = vi.mocked(searchBooks);
const mockGetByIsbn = vi.mocked(getBookByIsbn);

function result(overrides: Partial<BookSearchResult> = {}): BookSearchResult {
  const b = makeBook();
  return {
    isbn: "9780441013593",
    title: b.title,
    authors: b.authors,
    coverUrl: b.coverUrl,
    publishedYear: b.publishedYear,
    description: b.description,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BookSearch", () => {
  it("debounces a text query and renders result options", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([result({ title: "Dune" })]);
    render(<BookSearch onAdd={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/Search by title/i), "dune");

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("dune"));
    expect(await screen.findByRole("option")).toHaveTextContent("Dune");
    expect(mockGetByIsbn).not.toHaveBeenCalled();
  });

  it("routes a valid ISBN query to getBookByIsbn", async () => {
    const user = userEvent.setup();
    mockGetByIsbn.mockResolvedValue(result({ title: "Neuromancer" }));
    render(<BookSearch onAdd={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/Search by title/i), "9780441013593");

    await waitFor(() => expect(mockGetByIsbn).toHaveBeenCalledWith("9780441013593"));
    expect(await screen.findByText("Neuromancer")).toBeInTheDocument();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("shows 'No results found.' for an empty result set", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([]);
    render(<BookSearch onAdd={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/Search by title/i), "zzzz");
    expect(await screen.findByText("No results found.")).toBeInTheDocument();
  });

  it("surfaces an error and retries when 'Try again' is clicked", async () => {
    const user = userEvent.setup();
    mockSearch.mockRejectedValueOnce(new Error("Search failed")).mockResolvedValueOnce([result()]);
    render(<BookSearch onAdd={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/Search by title/i), "dune");
    const retry = await screen.findByRole("button", { name: "Try again" });

    await user.click(retry);
    expect(await screen.findByRole("option")).toBeInTheDocument();
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it("calls onAdd with 'owned' / 'want' from the two CTAs", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    mockSearch.mockResolvedValue([result({ isbn: "9780441013593", title: "Dune" })]);
    render(<BookSearch onAdd={onAdd} />);

    await user.type(screen.getByPlaceholderText(/Search by title/i), "dune");
    await screen.findByRole("option");

    await user.click(screen.getByRole("button", { name: "Add Owned" }));
    expect(onAdd).toHaveBeenCalledWith(
      "9780441013593",
      "owned",
      expect.objectContaining({ title: "Dune" }),
    );

    await user.click(screen.getByRole("button", { name: "Add to Wishlist" }));
    expect(onAdd).toHaveBeenCalledWith(
      "9780441013593",
      "want",
      expect.objectContaining({ title: "Dune" }),
    );
  });

  it("disables the add CTAs while a previous add is in flight", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([result()]);
    render(<BookSearch onAdd={vi.fn()} isAdding />);

    await user.type(screen.getByPlaceholderText(/Search by title/i), "dune");
    await screen.findByRole("option");

    expect(screen.getByRole("button", { name: "Add Owned" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to Wishlist" })).toBeDisabled();
  });
});
