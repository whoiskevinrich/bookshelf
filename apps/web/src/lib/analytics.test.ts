import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./api-client", () => ({
  postEvent: vi.fn(),
}));

import { postEvent } from "./api-client";
import { track } from "./analytics";

describe("track", () => {
  beforeEach(() => {
    vi.mocked(postEvent).mockReset();
  });

  it("forwards the event name and props to postEvent", () => {
    vi.mocked(postEvent).mockResolvedValueOnce(undefined);
    track("hint_link_clicked", { page: "shelf" });
    expect(postEvent).toHaveBeenCalledWith("hint_link_clicked", { page: "shelf" });
  });

  it("does not throw when postEvent rejects (fire-and-forget)", async () => {
    vi.mocked(postEvent).mockRejectedValueOnce(new Error("network down"));
    // Must not throw synchronously...
    expect(() => track("hint_shown")).not.toThrow();
    // ...and the swallowed rejection must not surface as an unhandled rejection.
    await Promise.resolve();
    expect(postEvent).toHaveBeenCalledWith("hint_shown", undefined);
  });

  it("returns synchronously (never blocks the caller)", () => {
    vi.mocked(postEvent).mockReturnValueOnce(new Promise(() => {}));
    expect(track("hint_dismissed")).toBeUndefined();
  });
});
