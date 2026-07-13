import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/device", () => ({ supportsCameraScan: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
// QrCode is lazy and pulls in qrcode-generator; a stub keeps the test focused.
vi.mock("../ui/QrCode", () => ({
  QrCode: ({ label }: { label: string }) => <div data-testid="qr">{label}</div>,
}));

import { supportsCameraScan } from "../../lib/device";
import { track } from "../../lib/analytics";
import { MobileScanHint } from "./MobileScanHint";

const mockSupports = vi.mocked(supportsCameraScan);
const mockTrack = vi.mocked(track);

function setEnv({ canScan }: { canScan: boolean }) {
  mockSupports.mockReturnValue(canScan);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("MobileScanHint", () => {
  it("renders nothing when the device can already scan", () => {
    setEnv({ canScan: true });
    const { container } = render(<MobileScanHint page="shelf" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the hint for an eligible (desktop) device and tracks hint_shown", () => {
    setEnv({ canScan: false });
    render(<MobileScanHint page="shelf" />);
    expect(screen.getByText("Scan books with your phone")).toBeInTheDocument();
    expect(screen.getByTestId("qr")).toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith("hint_shown", { page: "shelf" });
  });

  it("dismissing hides the hint, persists the choice, and tracks hint_dismissed", async () => {
    const user = userEvent.setup();
    setEnv({ canScan: false });
    render(<MobileScanHint page="wishlist" />);

    await user.click(screen.getByRole("button", { name: "Dismiss scan tip" }));

    expect(screen.queryByText("Scan books with your phone")).not.toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith("hint_dismissed", { page: "wishlist" });
    expect(localStorage.getItem("scanHint:dismissed")).toBe("yes");
  });

  it("stays hidden when previously dismissed", () => {
    localStorage.setItem("scanHint:dismissed", "yes");
    setEnv({ canScan: false });
    const { container } = render(<MobileScanHint page="shelf" />);
    expect(container).toBeEmptyDOMElement();
  });
});
