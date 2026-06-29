import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeEntry } from "../../test/utils";
import { ShelfBookCard } from "./ShelfBookCard";
import type { Shelf } from "../../lib/api-client";

function renderCard(
  entryOverrides = {},
  props: Partial<Parameters<typeof ShelfBookCard>[0]> = {},
  shelves: Shelf[] = [],
) {
  const handlers = {
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onAddToShelf: vi.fn(),
    onRemoveFromShelf: vi.fn(),
  };
  renderWithProviders(
    <ShelfBookCard entry={makeEntry(entryOverrides)} shelves={shelves} {...handlers} {...props} />,
  );
  return handlers;
}

describe("ShelfBookCard — state pills (#82)", () => {
  it("shows the Owned pill (and not Want) for an owned book", () => {
    renderCard({ owned: true, want: false });
    expect(screen.getByText("Owned")).toBeInTheDocument();
    expect(screen.queryByText("Want")).not.toBeInTheDocument();
  });

  it("shows the Want pill (and not Owned) for a wishlisted book", () => {
    renderCard({ owned: false, want: true });
    expect(screen.getByText("Want")).toBeInTheDocument();
    expect(screen.queryByText("Owned")).not.toBeInTheDocument();
  });

  it.each([
    ["reading", "Reading"],
    ["finished", "Read"],
    ["unread", "Unread"],
  ] as const)("renders the reading-status pill %s as '%s'", (status, label) => {
    renderCard({ readingStatus: status });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders no reading-status pill when readingStatus is null", () => {
    renderCard({ readingStatus: null });
    for (const label of ["Reading", "Read", "Unread"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});

describe("ShelfBookCard — tags", () => {
  it("shows the first tag and a +N overflow badge", () => {
    renderCard({ tags: ["fiction", "sci-fi", "owned-copy"] });
    expect(screen.getByText("fiction")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("shows a single tag with no overflow badge", () => {
    renderCard({ tags: ["fiction"] });
    expect(screen.getByText("fiction")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });
});

describe("ShelfBookCard — overlay actions", () => {
  it("offers 'Mark as Owned' only for wishlisted books and calls onMove", async () => {
    const user = userEvent.setup();
    const handlers = renderCard({ owned: false, want: true, isbn: "9780441013593" });
    const btn = screen.getByRole("button", { name: "Mark as Owned" });
    await user.click(btn);
    expect(handlers.onMove).toHaveBeenCalledWith("9780441013593", "owned");
  });

  it("does not offer 'Mark as Owned' for an owned book", () => {
    renderCard({ owned: true, want: false });
    expect(screen.queryByRole("button", { name: "Mark as Owned" })).not.toBeInTheDocument();
  });

  it("calls onRemove from the remove button", async () => {
    const user = userEvent.setup();
    const handlers = renderCard({ isbn: "9780441013593" });
    await user.click(screen.getByRole("button", { name: "Remove from library" }));
    expect(handlers.onRemove).toHaveBeenCalledWith("9780441013593");
  });

  it("shows a working spinner and disables remove while removing", () => {
    renderCard({}, { isRemoving: true });
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Working…" })).toBeInTheDocument();
  });
});

describe("ShelfBookCard — links, shelves and error", () => {
  it("links the title to the book-detail route", () => {
    renderCard({
      isbn: "9780441013593",
      book: {
        title: "Dune",
        authors: ["Frank Herbert"],
        coverUrl: null,
        publishedYear: 1965,
        description: null,
      },
    });
    expect(screen.getByRole("link", { name: "Dune" })).toHaveAttribute(
      "href",
      "/book/9780441013593",
    );
  });

  it("renders a shelf picker with a checkbox per shelf when shelves exist", async () => {
    const user = userEvent.setup();
    const shelves: Shelf[] = [
      { shelfId: "s1", name: "Favorites", createdAt: "", bookIds: ["9780441013593"] },
      { shelfId: "s2", name: "To donate", createdAt: "", bookIds: [] },
    ];
    const handlers = renderCard({ isbn: "9780441013593" }, {}, shelves);

    await user.click(screen.getByRole("button", { name: "Manage shelves" }));
    // Favorites already contains the book → checked → toggling removes.
    await user.click(screen.getByRole("checkbox", { name: "Favorites" }));
    expect(handlers.onRemoveFromShelf).toHaveBeenCalledWith("s1", "9780441013593");
    // To donate does not → toggling adds.
    await user.click(screen.getByRole("checkbox", { name: "To donate" }));
    expect(handlers.onAddToShelf).toHaveBeenCalledWith("s2", "9780441013593");
  });

  it("renders an inline error message", () => {
    renderCard({}, { error: "Couldn't move that book" });
    expect(screen.getByText("Couldn't move that book")).toBeInTheDocument();
  });
});
