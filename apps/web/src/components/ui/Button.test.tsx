import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its children and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add Owned</Button>);

    const btn = screen.getByRole("button", { name: "Add Owned" });
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when loading, even without an explicit disabled prop", () => {
    render(<Button loading>Saving…</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("does not fire onClick while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges a custom className onto the variant classes", () => {
    render(<Button className="custom-x">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("custom-x");
  });

  it("forwards the type attribute", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});
