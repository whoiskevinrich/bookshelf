import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WhatsNewEntry, WhatsNewFeed } from "../hooks/useWhatsNew";
import { groupByDate, unseenCount } from "./WhatsNewPanel";

// Control the feed the panel sees; the fetch/normalize path is covered separately.
const mockFeed = vi.fn<() => WhatsNewFeed>();
vi.mock("../hooks/useWhatsNew", () => ({
  useWhatsNew: () => mockFeed(),
}));

import { WhatsNewPanel } from "./WhatsNewPanel";

const LAST_SEEN_KEY = "whats-new:last-seen-id";

// Newest-first, with two entries sharing a date so grouping is exercised.
const ENTRIES: WhatsNewEntry[] = [
  { id: "c", date: "2026-07-03", note: "Newest thing." },
  { id: "b", date: "2026-07-03", note: "Same-day thing." },
  { id: "a", date: "2026-06-30", note: "Older thing." },
];

function feed(entries: WhatsNewEntry[]): WhatsNewFeed {
  return { generatedAt: entries[0]?.date ?? null, entries };
}

beforeEach(() => {
  localStorage.clear();
  mockFeed.mockReset();
});

describe("groupByDate", () => {
  it("groups consecutive same-date entries, order preserved", () => {
    expect(groupByDate(ENTRIES)).toEqual([
      { date: "2026-07-03", entries: [ENTRIES[0], ENTRIES[1]] },
      { date: "2026-06-30", entries: [ENTRIES[2]] },
    ]);
  });

  it("returns no groups for an empty feed", () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe("unseenCount", () => {
  it("is 0 on first visit (no marker) so a new visitor is never nagged", () => {
    expect(unseenCount(ENTRIES, "")).toBe(0);
  });

  it("counts entries ahead of the stored marker in feed order", () => {
    expect(unseenCount(ENTRIES, "a")).toBe(2); // c, b are newer than a
    expect(unseenCount(ENTRIES, "c")).toBe(0); // nothing newer than the newest
  });

  it("treats a pruned/unknown marker as everything-new", () => {
    expect(unseenCount(ENTRIES, "gone")).toBe(3);
  });
});

describe("WhatsNewPanel", () => {
  it("shows the unseen dot when entries are newer than the stored marker", () => {
    localStorage.setItem(LAST_SEEN_KEY, "a");
    mockFeed.mockReturnValue(feed(ENTRIES));

    render(<WhatsNewPanel />);

    expect(screen.getByRole("button", { name: /2 new/i })).toBeInTheDocument();
  });

  it("shows no dot on first visit (no stored marker)", () => {
    mockFeed.mockReturnValue(feed(ENTRIES));

    render(<WhatsNewPanel />);

    expect(screen.getByRole("button", { name: "What's New" })).toBeInTheDocument();
    // The baseline marker is established at the newest entry so the dot only
    // ever fires for genuinely new entries later.
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe("c");
  });

  it("clears the dot and persists the newest id once opened, flagging unseen entries as New", () => {
    localStorage.setItem(LAST_SEEN_KEY, "a");
    mockFeed.mockReturnValue(feed(ENTRIES));

    render(<WhatsNewPanel />);
    fireEvent.click(screen.getByRole("button", { name: /2 new/i }));

    // Dot gone: the accessible name drops the count.
    expect(screen.getByRole("button", { name: "What's New" })).toBeInTheDocument();
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe("c");

    // The two entries newer than the old marker carry a "New" pill; the old one does not.
    expect(screen.getAllByText("New")).toHaveLength(2);
    expect(screen.getByRole("dialog", { name: "What's New" })).toBeInTheDocument();
  });

  it("renders a graceful empty state and no dot for an empty feed", () => {
    mockFeed.mockReturnValue(feed([]));

    render(<WhatsNewPanel />);
    expect(screen.getByRole("button", { name: "What's New" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "What's New" }));
    expect(screen.getByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    mockFeed.mockReturnValue(feed(ENTRIES));

    render(<WhatsNewPanel />);
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
