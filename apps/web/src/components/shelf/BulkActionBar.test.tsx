import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { BulkActionBar } from "./BulkActionBar";
import type { Shelf } from "../../lib/api-client";
import type { BulkResult } from "../../hooks/useBulkShelfActions";

const shelves: Shelf[] = [
  { shelfId: "s1", name: "Favorites", createdAt: "", bookIds: [] },
  { shelfId: "s2", name: "To donate", createdAt: "", bookIds: [] },
];

function renderBar(overrides: Partial<Parameters<typeof BulkActionBar>[0]> = {}) {
  const handlers = {
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    onConfirmDelete: vi.fn(),
    onMove: vi.fn(),
    onAddToShelf: vi.fn(),
    onAddTag: vi.fn(),
    onRetry: vi.fn(),
    onDismissResult: vi.fn(),
  };
  renderWithProviders(
    <BulkActionBar
      selectedCount={2}
      visibleCount={5}
      shelves={shelves}
      pending={false}
      result={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("BulkActionBar — selection controls", () => {
  it("shows the current selection count", () => {
    renderBar({ selectedCount: 3 });
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("disables all bulk actions when nothing is selected", () => {
    renderBar({ selectedCount: 0 });
    expect(screen.getByRole("button", { name: "Move to Owned" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move to Wishlist" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("calls onSelectAll / onClear", async () => {
    const user = userEvent.setup();
    const handlers = renderBar({ selectedCount: 1, visibleCount: 5 });
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(handlers.onSelectAll).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(handlers.onClear).toHaveBeenCalled();
  });
});

describe("BulkActionBar — move", () => {
  it("moves the selection to Owned / Wishlist", async () => {
    const user = userEvent.setup();
    const handlers = renderBar();
    await user.click(screen.getByRole("button", { name: "Move to Owned" }));
    expect(handlers.onMove).toHaveBeenCalledWith("owned");
    await user.click(screen.getByRole("button", { name: "Move to Wishlist" }));
    expect(handlers.onMove).toHaveBeenCalledWith("want");
  });
});

describe("BulkActionBar — delete confirmation", () => {
  it("shows the selection count in the confirm dialog and gates the delete behind it", async () => {
    const user = userEvent.setup();
    const handlers = renderBar({ selectedCount: 7 });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete 7 books?")).toBeInTheDocument();
    expect(handlers.onConfirmDelete).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(handlers.onConfirmDelete).toHaveBeenCalled();
  });

  it("uses singular phrasing for a single book", async () => {
    const user = userEvent.setup();
    renderBar({ selectedCount: 1 });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete 1 book?")).toBeInTheDocument();
  });
});

describe("BulkActionBar — add to shelf / add tag", () => {
  it("picks a shelf from the dropdown and calls onAddToShelf", async () => {
    const user = userEvent.setup();
    const handlers = renderBar();
    await user.click(screen.getByRole("button", { name: "Add to shelf…" }));
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    expect(handlers.onAddToShelf).toHaveBeenCalledWith("s1");
  });

  it("submits a typed tag via onAddTag", async () => {
    const user = userEvent.setup();
    const handlers = renderBar();
    await user.type(screen.getByLabelText("Tag to add to selected books"), "sci-fi");
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    expect(handlers.onAddTag).toHaveBeenCalledWith("sci-fi");
  });
});

describe("BulkActionBar — partial-failure result", () => {
  it("reports full success with no retry action", () => {
    const result: BulkResult = { op: "delete", total: 4, failed: [] };
    renderBar({ result });
    expect(screen.getByText("Deleted 4 of 4 books")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("reports partial failure with a retry-failed action", async () => {
    const user = userEvent.setup();
    const result: BulkResult = { op: "move-owned", total: 5, failed: ["a", "b"] };
    const handlers = renderBar({ result });
    expect(screen.getByText("Moved to Owned 3 of 5 books")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry 2 failed" }));
    expect(handlers.onRetry).toHaveBeenCalled();
  });

  it("reports a total failure (0 succeeded) without dividing by a wrong count", () => {
    const result: BulkResult = { op: "delete", total: 3, failed: ["a", "b", "c"] };
    renderBar({ result });
    expect(screen.getByText("Deleted 0 of 3 books")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 3 failed" })).toBeInTheDocument();
  });

  it("announces the result to assistive tech via an aria-live region", () => {
    const result: BulkResult = { op: "delete", total: 1, failed: [] };
    renderBar({ result });
    expect(screen.getByRole("status")).toHaveTextContent("Deleted 1 of 1 books");
  });
});
