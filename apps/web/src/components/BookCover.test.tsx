import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookCover } from "./BookCover";

describe("BookCover", () => {
  it("renders the cover image when a coverUrl is provided", () => {
    render(
      <BookCover
        coverUrl="https://example.com/dune.jpg"
        title="Dune"
        authors={["Frank Herbert"]}
      />,
    );
    const img = screen.getByRole("img", { name: "Dune" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/dune.jpg");
  });

  it("renders a text fallback (title + authors) when coverUrl is null", () => {
    render(<BookCover coverUrl={null} title="Dune" authors={["Frank Herbert"]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // Fallback exposes an accessible label combining title + authors.
    expect(screen.getByLabelText("Dune by Frank Herbert")).toBeInTheDocument();
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
  });

  it("labels the fallback with the title only when there are no authors", () => {
    render(<BookCover coverUrl={null} title="Untitled" authors={[]} />);
    expect(screen.getByLabelText("Untitled")).toBeInTheDocument();
  });

  it("falls back to the text placeholder when the image fails to load", () => {
    render(
      <BookCover
        coverUrl="https://example.com/broken.jpg"
        title="Dune"
        authors={["Frank Herbert"]}
      />,
    );
    const img = screen.getByRole("img", { name: "Dune" });
    fireEvent.error(img);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dune by Frank Herbert")).toBeInTheDocument();
  });
});
