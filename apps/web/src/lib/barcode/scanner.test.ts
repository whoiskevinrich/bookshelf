import { describe, it, expect, vi, afterEach } from "vitest";
import { createBarcodeScanner } from "./scanner";

// Mock the zxing fallback so the wasm path can be exercised without a real WASM
// runtime (jsdom has no canvas pixels anyway).
vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: vi.fn(),
  readBarcodes: vi.fn().mockResolvedValue([{ text: "9781234567897", isValid: true }]),
}));
vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({ default: "/zxing_reader.wasm" }));

const globalRef = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete globalRef["BarcodeDetector"];
  vi.restoreAllMocks();
});

describe("createBarcodeScanner — native BarcodeDetector path", () => {
  it("returns the first EAN-13 value from the native detector", async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: "9780306406157", format: "ean_13" }]);
    globalRef["BarcodeDetector"] = class {
      static getSupportedFormats() {
        return Promise.resolve(["ean_13"]);
      }
      detect = detect;
    };

    const scanner = await createBarcodeScanner();
    const video = document.createElement("video");
    await expect(scanner.scan(video)).resolves.toBe("9780306406157");
    expect(detect).toHaveBeenCalledWith(video);
  });

  it("returns null when no barcode is in frame", async () => {
    globalRef["BarcodeDetector"] = class {
      static getSupportedFormats() {
        return Promise.resolve(["ean_13"]);
      }
      detect = vi.fn().mockResolvedValue([]);
    };

    const scanner = await createBarcodeScanner();
    await expect(scanner.scan(document.createElement("video"))).resolves.toBeNull();
  });

  it("swallows a detector error and returns null (keeps the loop alive)", async () => {
    globalRef["BarcodeDetector"] = class {
      static getSupportedFormats() {
        return Promise.resolve(["ean_13"]);
      }
      detect = vi.fn().mockRejectedValue(new Error("frame not ready"));
    };

    const scanner = await createBarcodeScanner();
    await expect(scanner.scan(document.createElement("video"))).resolves.toBeNull();
  });
});

describe("createBarcodeScanner — fallback selection", () => {
  it("falls back to the wasm scanner when there is no native detector", async () => {
    // No global BarcodeDetector → wasm path. Returns a usable scanner object.
    const scanner = await createBarcodeScanner();
    expect(typeof scanner.scan).toBe("function");
    expect(typeof scanner.dispose).toBe("function");
  });

  it("falls back when the native detector lacks EAN-13 support", async () => {
    globalRef["BarcodeDetector"] = class {
      static getSupportedFormats() {
        return Promise.resolve(["qr_code"]);
      }
      detect = vi.fn();
    };
    const scanner = await createBarcodeScanner();
    expect(typeof scanner.scan).toBe("function");
  });
});
