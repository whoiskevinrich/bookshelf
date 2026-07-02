import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";

// AppHeader reads auth state; stub the context so we control the signed-in user.
const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// ThemeToggle needs ThemeProvider — not under test here, so stub it out.
vi.mock("./icons/ThemeIcons", () => ({
  ThemeToggle: () => <button type="button" aria-label="Toggle theme" />,
}));

import { AppHeader } from "./AppHeader";

function signedIn() {
  mockUseAuth.mockReturnValue({ user: { userId: "u1", email: "a@b.co" }, signOut: vi.fn() });
}

function signedOut() {
  mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() });
}

beforeEach(() => {
  mockUseAuth.mockReset();
});

describe("AppHeader — shelf deep-links", () => {
  it("renders My Library, Wishlist and Reading list links with the right hrefs", () => {
    signedIn();
    renderWithProviders(<AppHeader />, { routerEntries: ["/shelf"] });

    expect(screen.getByRole("link", { name: "My Library" })).toHaveAttribute("href", "/shelf");
    expect(screen.getByRole("link", { name: "Wishlist" })).toHaveAttribute(
      "href",
      "/shelf?facet=want",
    );
    expect(screen.getByRole("link", { name: "Reading list" })).toHaveAttribute(
      "href",
      "/shelf?view=reading-list",
    );
  });

  it("marks only My Library active on the bare /shelf route", () => {
    signedIn();
    renderWithProviders(<AppHeader />, { routerEntries: ["/shelf"] });

    expect(screen.getByRole("link", { name: "My Library" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Wishlist" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Reading list" })).not.toHaveAttribute("aria-current");
  });

  it("marks only Wishlist active on /shelf?facet=want", () => {
    signedIn();
    renderWithProviders(<AppHeader />, { routerEntries: ["/shelf?facet=want"] });

    expect(screen.getByRole("link", { name: "Wishlist" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "My Library" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Reading list" })).not.toHaveAttribute("aria-current");
  });

  it("marks only Reading list active on /shelf?view=reading-list", () => {
    signedIn();
    renderWithProviders(<AppHeader />, { routerEntries: ["/shelf?view=reading-list"] });

    expect(screen.getByRole("link", { name: "Reading list" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "My Library" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Wishlist" })).not.toHaveAttribute("aria-current");
  });

  it("marks no shelf link active on an unrelated route", () => {
    signedIn();
    renderWithProviders(<AppHeader />, { routerEntries: ["/about"] });

    for (const name of ["My Library", "Wishlist", "Reading list"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("shows the shelf links even when signed out", () => {
    signedOut();
    renderWithProviders(<AppHeader />, { routerEntries: ["/shelf"] });

    expect(screen.getByRole("link", { name: "Wishlist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reading list" })).toBeInTheDocument();
    // Account is gated behind a signed-in user.
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
  });
});
