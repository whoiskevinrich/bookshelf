import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import type { Shelf } from "../../lib/api-client";

vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, deleteShelf: vi.fn() };
});

import { deleteShelf } from "../../lib/api-client";
import { track } from "../../lib/analytics";
import { DeleteShelfDialog } from "./DeleteShelfDialog";

const mockDelete = vi.mocked(deleteShelf);
const mockTrack = vi.mocked(track);

function shelf(overrides: Partial<Shelf> = {}): Shelf {
  return { shelfId: "s1", name: "Favorites", createdAt: "", bookIds: [], ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe("DeleteShelfDialog", () => {
  it("renders nothing when closed", () => {
    renderWithProviders(
      <DeleteShelfDialog shelf={shelf()} open={false} onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the shelf name in the title when open", () => {
    renderWithProviders(
      <DeleteShelfDialog
        shelf={shelf({ name: "Favorites" })}
        open
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: /Delete/ })).toHaveTextContent("Favorites");
  });

  it.each([
    [[], "no books"],
    [["a"], "1 book"],
    [["a", "b", "c"], "3 books"],
  ])("renders the correct book-count label", (bookIds, label) => {
    renderWithProviders(
      <DeleteShelfDialog shelf={shelf({ bookIds })} open onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("deletes the shelf, then tracks and calls onDeleted", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    mockDelete.mockResolvedValue();
    renderWithProviders(
      <DeleteShelfDialog
        shelf={shelf({ bookIds: ["a", "b"] })}
        open
        onClose={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete shelf" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith("shelf_deleted", { shelfId: "s1", bookCount: 2 });
  });

  it("surfaces an error and does not call onDeleted when deletion fails", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    mockDelete.mockRejectedValue(new Error("boom"));
    renderWithProviders(
      <DeleteShelfDialog shelf={shelf()} open onClose={vi.fn()} onDeleted={onDeleted} />,
    );

    await user.click(screen.getByRole("button", { name: "Delete shelf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete shelf");
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("closes via Cancel and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <DeleteShelfDialog shelf={shelf()} open onClose={onClose} onDeleted={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
