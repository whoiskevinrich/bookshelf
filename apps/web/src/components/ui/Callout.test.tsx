import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Callout } from "./Callout";

describe("Callout", () => {
  it("renders as a note landmark with body content", () => {
    render(<Callout>Heads up, you can scan from your phone.</Callout>);
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent("Heads up, you can scan from your phone.");
  });

  it("renders an optional title heading", () => {
    render(<Callout title="Tip">Body</Callout>);
    expect(screen.getByRole("heading", { name: "Tip" })).toBeInTheDocument();
  });

  it("omits the dismiss button when no onDismiss is given", () => {
    render(<Callout>No dismiss here</Callout>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a dismiss button and fires onDismiss when activated", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Callout onDismiss={onDismiss} dismissLabel="Dismiss tip">
        Dismissible
      </Callout>,
    );

    const dismiss = screen.getByRole("button", { name: "Dismiss tip" });
    await user.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("defaults the dismiss label to 'Dismiss'", () => {
    render(<Callout onDismiss={() => {}}>Body</Callout>);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});
