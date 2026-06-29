import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, updateShelf: vi.fn() };
});

import { updateShelf, ApiError } from "../../lib/api-client";
import { track } from "../../lib/analytics";
import { ShelfNameEditor } from "./ShelfNameEditor";

const mockUpdate = vi.mocked(updateShelf);
const mockTrack = vi.mocked(track);

beforeEach(() => vi.clearAllMocks());

describe("ShelfNameEditor", () => {
  it("shows the name with a rename affordance when idle", () => {
    renderWithProviders(<ShelfNameEditor shelfId="s1" name="Favorites" />);
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename shelf Favorites" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("enters edit mode pre-filled with the current name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ShelfNameEditor shelfId="s1" name="Favorites" />);
    await user.click(screen.getByRole("button", { name: "Rename shelf Favorites" }));
    expect(screen.getByRole("textbox")).toHaveValue("Favorites");
  });

  it("keeps Save disabled until the name actually changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ShelfNameEditor shelfId="s1" name="Favorites" />);
    await user.click(screen.getByRole("button", { name: "Rename shelf Favorites" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "!");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves a trimmed new name and exits edit mode on success", async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({
      shelfId: "s1",
      name: "Reading list",
      createdAt: "",
      bookIds: [],
    });
    renderWithProviders(<ShelfNameEditor shelfId="s1" name="Favorites" />);

    await user.click(screen.getByRole("button", { name: "Rename shelf Favorites" }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "  Reading list  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("s1", "Reading list"));
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(mockTrack).toHaveBeenCalledWith("shelf_renamed", { shelfId: "s1" });
  });

  it("shows a duplicate-name error on a 409 and stays in edit mode", async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(new ApiError(409, "conflict"));
    renderWithProviders(<ShelfNameEditor shelfId="s1" name="Favorites" />);

    await user.click(screen.getByRole("button", { name: "Rename shelf Favorites" }));
    await user.type(screen.getByRole("textbox"), " 2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have a shelf with this name.",
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("cancels edit mode on Escape, restoring the idle view", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ShelfNameEditor shelfId="s1" name="Favorites" />);
    await user.click(screen.getByRole("button", { name: "Rename shelf Favorites" }));

    await user.type(screen.getByRole("textbox"), "edits");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
