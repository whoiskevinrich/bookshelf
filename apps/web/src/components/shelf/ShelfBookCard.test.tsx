import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
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
  it("shows the Owned pill (and not Wishlist) for an owned book", () => {
    renderCard({ owned: true, want: false });
    expect(screen.getByText("Owned")).toBeInTheDocument();
    expect(screen.queryByText("Wishlist")).not.toBeInTheDocument();
  });

  it("shows the Wishlist pill (and not Owned) for a wishlisted book", () => {
    renderCard({ owned: false, want: true });
    expect(screen.getByText("Wishlist")).toBeInTheDocument();
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

describe("ShelfBookCard — copies badge (BOOKSHELF-60)", () => {
  it("shows a ×N badge when copies > 1 on an owned book", () => {
    renderCard({ owned: true, want: false, copies: 3 });
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("renders no badge when copies is 1", () => {
    renderCard({ owned: true, want: false, copies: 1 });
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
  });

  it("renders no badge for a wishlisted book even if copies > 1", () => {
    renderCard({ owned: false, want: true, copies: 3 });
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
  });
});

describe("ShelfBookCard — editions affordance (BOOKSHELF-93)", () => {
  it("shows an 'N editions' badge when editionCount > 1", () => {
    renderCard({ editionCount: 2 });
    expect(screen.getByText("2 editions")).toBeInTheDocument();
  });

  it("renders no badge for a solo edition", () => {
    renderCard({ editionCount: 1 });
    expect(screen.queryByText(/editions$/)).not.toBeInTheDocument();
  });

  it("shows both the copies and editions badges when both apply", () => {
    renderCard({ owned: true, want: false, copies: 2, editionCount: 3 });
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("3 editions")).toBeInTheDocument();
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

  it("asks for confirmation before removing, then calls onRemove", async () => {
    const user = userEvent.setup();
    const handlers = renderCard({ isbn: "9780441013593" });
    await user.click(screen.getByRole("button", { name: "Remove from library" }));
    // The dialog gates the destructive action — nothing removed yet.
    expect(handlers.onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(handlers.onRemove).toHaveBeenCalledWith("9780441013593");
  });

  it("does not remove when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const handlers = renderCard({ isbn: "9780441013593" });
    await user.click(screen.getByRole("button", { name: "Remove from library" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a working spinner and disables remove while removing", () => {
    renderCard({}, { isRemoving: true });
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Working…" })).toBeInTheDocument();
  });
});

describe("ShelfBookCard — links, shelves and error", () => {
  it("navigates to the book-detail route when the cover is clicked", async () => {
    const user = userEvent.setup();
    const handlers = {
      onMove: vi.fn(),
      onRemove: vi.fn(),
      onAddToShelf: vi.fn(),
      onRemoveFromShelf: vi.fn(),
    };
    renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <ShelfBookCard
              entry={makeEntry({ isbn: "9780441013593" })}
              shelves={[]}
              {...handlers}
            />
          }
        />
        <Route path="/book/:isbn" element={<div>Detail route</div>} />
      </Routes>,
    );

    await user.click(screen.getByRole("img", { name: "Dune" }));
    expect(screen.getByText("Detail route")).toBeInTheDocument();
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

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

describe("ShelfBookCard — Manage mode selection (BOOKSHELF-59)", () => {
  it("renders no selection checkbox and no navigate-away when manageMode is off", () => {
    renderCard({ isbn: "9780441013593" });
    expect(screen.queryByRole("checkbox", { name: 'Select "Dune"' })).not.toBeInTheDocument();
  });

  it("shows an always-visible selection checkbox in Manage mode", () => {
    renderCard({ isbn: "9780441013593" }, { manageMode: true, selected: false });
    expect(screen.getByRole("checkbox", { name: 'Select "Dune"' })).not.toBeChecked();
  });

  it("shows the checkbox checked when the book is selected", () => {
    renderCard({ isbn: "9780441013593" }, { manageMode: true, selected: true });
    expect(screen.getByRole("checkbox", { name: 'Select "Dune"' })).toBeChecked();
  });

  it("toggles selection via the checkbox without navigating to detail", async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    renderCard({ isbn: "9780441013593" }, { manageMode: true, selected: false, onToggleSelect });
    await user.click(screen.getByRole("checkbox", { name: 'Select "Dune"' }));
    expect(onToggleSelect).toHaveBeenCalledWith("9780441013593");
  });

  it("clicking the cover toggles selection instead of navigating in Manage mode", async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    renderCard({ isbn: "9780441013593" }, { manageMode: true, selected: false, onToggleSelect });
    await user.click(screen.getByRole("img", { name: "Dune" }));
    expect(onToggleSelect).toHaveBeenCalledWith("9780441013593");
    expect(screen.queryByText("Detail route")).not.toBeInTheDocument();
  });

  it("clicking the title toggles selection instead of navigating in Manage mode", async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    renderCard({ isbn: "9780441013593" }, { manageMode: true, selected: false, onToggleSelect });
    await user.click(screen.getByRole("button", { name: "Dune" }));
    expect(onToggleSelect).toHaveBeenCalledWith("9780441013593");
  });

  it("hides the per-card hover overlay actions while in Manage mode", () => {
    renderCard({ isbn: "9780441013593", owned: false, want: true }, { manageMode: true });
    expect(screen.queryByRole("button", { name: "Mark as Owned" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove from library" })).not.toBeInTheDocument();
  });
});
