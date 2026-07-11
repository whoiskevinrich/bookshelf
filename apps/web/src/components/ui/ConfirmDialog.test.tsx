import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";

const baseProps = {
  title: "Delete shelf?",
  message: "This cannot be undone.",
  onConfirm: vi.fn(),
  onClose: vi.fn(),
};

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a labelled modal dialog when open", () => {
    render(<ConfirmDialog {...baseProps} open />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Delete shelf?" })).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("uses the default confirm label and fires onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} open onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders a custom confirm label", () => {
    render(<ConfirmDialog {...baseProps} open confirmLabel="Delete shelf" />);
    expect(screen.getByRole("button", { name: "Delete shelf" })).toBeInTheDocument();
  });

  it("shows 'Working…' and disables confirm when pending", () => {
    render(<ConfirmDialog {...baseProps} open pending confirmLabel="Delete" />);
    const confirm = screen.getByRole("button", { name: "Working…" });
    expect(confirm).toBeDisabled();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmDialog {...baseProps} open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmDialog {...baseProps} open onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an error message inside the dialog when provided", () => {
    // The error must live inside the modal — an inline page message would render
    // behind the dialog's full-screen backdrop and be invisible (BOOKSHELF-60).
    render(
      <ConfirmDialog {...baseProps} open error="Couldn't add another copy — please try again." />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Couldn't add another copy — please try again.");
  });

  it("renders no error paragraph when error is null", () => {
    render(<ConfirmDialog {...baseProps} open error={null} />);
    expect(screen.queryByText(/couldn't/i)).not.toBeInTheDocument();
  });
});
