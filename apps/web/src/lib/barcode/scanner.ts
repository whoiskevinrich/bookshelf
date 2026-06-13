/**
 * Hybrid EAN-13 barcode decoder.
 *
 * Book barcodes are EAN-13 (the ISBN-13, prefixed 978/979). We decode them with
 * the best engine available on the device:
 *
 *   1. The OS-native `BarcodeDetector` (Android Chrome, some desktop Chromium) —
 *      zero bytes, hardware-accelerated.
 *   2. A lazily-imported `zxing-wasm` decoder — covers iOS Safari, which has no
 *      `BarcodeDetector`. The ~hundred-KB WASM is only fetched the first time the
 *      fallback is actually needed, so non-scanner users never pay for it.
 *
 * The WASM binary is self-hosted (bundled by Vite, served from our own origin),
 * not fetched from a CDN — no third-party runtime dependency, no CSP allowance.
 */

export interface BarcodeScanner {
  /** Decode the first EAN-13 in the current video frame; null if none found. */
  scan(video: HTMLVideoElement): Promise<string | null>;
  /** Release any resources (canvas, detector). */
  dispose(): void;
}

// ── Native BarcodeDetector ──────────────────────────────────────────────────
// Minimal structural types — the DOM lib doesn't ship BarcodeDetector yet.

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?(): Promise<string[]>;
}

async function createNativeScanner(): Promise<BarcodeScanner | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    // Only use the native path if it actually supports EAN-13.
    const supported = (await Ctor.getSupportedFormats?.()) ?? ["ean_13"];
    if (!supported.includes("ean_13")) return null;
  } catch {
    return null;
  }

  const detector = new Ctor({ formats: ["ean_13"] });
  return {
    async scan(video) {
      try {
        const found = await detector.detect(video);
        return found[0]?.rawValue ?? null;
      } catch {
        // A failed frame (e.g. video not ready) is non-fatal — try again next tick.
        return null;
      }
    },
    dispose() {},
  };
}

// ── zxing-wasm fallback ─────────────────────────────────────────────────────

async function createWasmScanner(): Promise<BarcodeScanner> {
  const [reader, wasmModule] = await Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  // Point the decoder at our self-hosted, Vite-fingerprinted WASM asset.
  reader.prepareZXingModule({ overrides: { locateFile: () => wasmModule.default } });

  // zxing reads pixels, not a <video>, so we sample frames through a canvas.
  // Created lazily on first scan so nothing is allocated until decoding starts.
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;

  return {
    async scan(video) {
      if (!video.videoWidth || !video.videoHeight) return null;
      if (!canvas) {
        canvas = document.createElement("canvas");
        ctx = canvas.getContext("2d", { willReadFrequently: true });
      }
      if (!ctx) return null;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const results = await reader.readBarcodes(image, {
        formats: ["EAN-13"],
        tryHarder: true,
      });
      const hit = results.find((r) => r.isValid && r.text);
      return hit?.text ?? null;
    },
    dispose() {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  };
}

/**
 * Create the best available barcode scanner for this device. Prefers the native
 * `BarcodeDetector`; falls back to the lazily-loaded `zxing-wasm` decoder.
 */
export async function createBarcodeScanner(): Promise<BarcodeScanner> {
  const native = await createNativeScanner();
  return native ?? createWasmScanner();
}
