import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

const options = [
  { value: "owned", label: "Owned" },
  { value: "want", label: "Wishlist" },
] as const;

describe("SegmentedControl", () => {
  it("renders a radiogroup with an accessible name", () => {
    render(
      <SegmentedControl
        label="Owned or wishlist"
        value="owned"
        options={[...options]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Owned or wishlist" })).toBeInTheDocument();
  });

  it("marks the selected option with aria-checked", () => {
    render(
      <SegmentedControl label="Status" value="want" options={[...options]} onChange={() => {}} />,
    );
    expect(screen.getByRole("radio", { name: "Owned" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Wishlist" })).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the option value when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Status" value="owned" options={[...options]} onChange={onChange} />,
    );

    await user.click(screen.getByRole("radio", { name: "Wishlist" }));
    expect(onChange).toHaveBeenCalledWith("want");
  });
});
