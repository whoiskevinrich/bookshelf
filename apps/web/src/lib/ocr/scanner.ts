/**
 * Three-tier OCR stack for reading printed ISBN text from a video frame.
 *
 * Tier 1: Native TextDetector (Chrome Android + some desktop Chromium) — zero bytes,
 *         hardware-accelerated. Skipped when unavailable (iOS Safari).
 * Tier 2: Tesseract.js WASM (lazy-loaded on first call) — covers iOS Safari.
 *         Only used when TextDetector is absent. ~5 MB WASM fetched once then cached.
 * Tier 3: POST /v1/scan/text (AWS Rekognition server fallback) — called when the
 *         on-device tier returns null. Requires OCR_SCAN_ENABLED on the server.
 *
 * Mirrors the BarcodeDetector → zxing-wasm pattern in lib/barcode/scanner.ts.
 */

import { toIsbn13 } from "../isbn";
import { scanTextIsbn } from "../api-client";

export interface OcrScanner {
  /** Capture one frame from the video and attempt to extract an ISBN-13. */
  scan(video: HTMLVideoElement): Promise<string | null>;
  /** Terminate the Tesseract worker (if started) and free resources. */
  dispose(): Promise<void>;
}

// Minimal types for the Web Text Detection API (not in DOM lib yet).
interface DetectedTextBlock {
  rawValue: string;
}
interface TextDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedTextBlock[]>;
}
interface TextDetectorConstructor {
  new (): TextDetectorLike;
}

// ISBN printed on a book back: "ISBN 0-553-22759-9" or "ISBN-13: 978-..."
const ISBN_PATTERN = /ISBN[\s-]*([\d-X]{9,13})/i;

function extractIsbn(text: string): string | null {
  const match = ISBN_PATTERN.exec(text);
  if (!match?.[1]) return null;
  return toIsbn13(match[1]) ?? null;
}

function captureVideoBlob(video: HTMLVideoElement): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
}

// Minimal worker interface — avoids importing the full Tesseract.js types.
interface TesseractWorker {
  recognize(image: HTMLVideoElement): Promise<{ data: { text: string } }>;
  setParameters(params: Record<string, string>): Promise<unknown>;
  terminate(): Promise<unknown>;
}

/**
 * Create an OCR scanner. The scanner is cheap to construct; the Tesseract WASM
 * worker is only started on the first `scan()` call on devices without TextDetector.
 */
export function createOcrScanner(): OcrScanner {
  const TextDetectorCtor = (globalThis as { TextDetector?: TextDetectorConstructor }).TextDetector;
  const textDetector = TextDetectorCtor
    ? (() => {
        try {
          return new TextDetectorCtor();
        } catch {
          return null;
        }
      })()
    : null;

  let tesseractWorker: TesseractWorker | null = null;
  let tesseractInitPromise: Promise<TesseractWorker | null> | null = null;

  async function getWorker(): Promise<TesseractWorker | null> {
    if (tesseractWorker) return tesseractWorker;
    if (!tesseractInitPromise) {
      tesseractInitPromise = (async () => {
        try {
          const { createWorker } = await import("tesseract.js");
          const w = await createWorker("eng", 1, { logger: () => {} });
          // Whitelist reduces false positives for ISBN-like strings.
          await (w as unknown as TesseractWorker).setParameters({
            tessedit_char_whitelist: "0123456789-X ISBN ",
          });
          tesseractWorker = w as unknown as TesseractWorker;
          return tesseractWorker;
        } catch {
          return null;
        }
      })();
    }
    return tesseractInitPromise;
  }

  return {
    async scan(video) {
      if (!video.videoWidth || !video.videoHeight) return null;

      if (textDetector) {
        // Tier 1: Native TextDetector
        try {
          const blocks = await textDetector.detect(video);
          const text = blocks.map((b) => b.rawValue).join("\n");
          const isbn = extractIsbn(text);
          if (isbn) return isbn;
        } catch {
          // Non-fatal — fall through to server
        }
      } else {
        // Tier 2: Tesseract.js WASM (iOS Safari path)
        const worker = await getWorker();
        if (worker) {
          try {
            const { data } = await worker.recognize(video);
            const isbn = extractIsbn(data.text);
            if (isbn) return isbn;
          } catch {
            // Non-fatal — fall through to server
          }
        }
      }

      // Tier 3: Server fallback (AWS Rekognition via POST /v1/scan/text)
      const blob = await captureVideoBlob(video);
      if (!blob) return null;
      try {
        return await scanTextIsbn(blob);
      } catch {
        return null;
      }
    },

    async dispose() {
      if (tesseractWorker) {
        await tesseractWorker.terminate().catch(() => {});
        tesseractWorker = null;
        tesseractInitPromise = null;
      }
    },
  };
}
