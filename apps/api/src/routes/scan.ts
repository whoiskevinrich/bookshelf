import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { RekognitionClient, DetectTextCommand } from "@aws-sdk/client-rekognition";
import { authMiddleware } from "../middleware/auth.js";
import { FixedWindowRateLimiter, userRateLimit } from "../middleware/rate-limit.js";
import { emitMetric } from "../lib/metrics.js";
import { isValidIsbn, normalizeIsbn } from "../lib/isbn.js";

/**
 * OCR text-scan endpoint. Accepts a JPEG image as multipart form data, calls
 * AWS Rekognition DetectText, extracts the first ISBN found, and returns it as
 * a canonical ISBN-13. Returns `{ isbn13: null }` when no ISBN is detected.
 *
 * Gated behind OCR_SCAN_ENABLED=true (Lambda env var). Returns 404 when the
 * flag is off so the client's three-tier stack stops at the server tier.
 * Also capped by the ADR-018 per-user rate limiter (BOOKSHELF-99) — open
 * signup + no limit meant any authenticated user could drive up Rekognition
 * cost with no ceiling. See docs/runbooks/abuse-rate-limiting.md.
 * Future: replace both with a per-user entitlement check (user tiers).
 */

const OCR_SCAN_ENABLED = process.env["OCR_SCAN_ENABLED"] === "true";

// Per-user rate limit on the OCR fallback tier — it's a paid-per-call Rekognition
// request, and the client only reaches it when on-device detection fails, so a
// legitimate session should rarely approach this. Held at module scope so the
// counter survives across warm Lambda invocations (ADR-018).
const OCR_SCANS_PER_MINUTE = 10;
const OCR_SCANS_PER_HOUR = 50;
const scanLimiter = new FixedWindowRateLimiter([
  { label: "minute", limit: OCR_SCANS_PER_MINUTE, windowMs: 60_000 },
  { label: "hour", limit: OCR_SCANS_PER_HOUR, windowMs: 3_600_000 },
]);

const ISBN_PATTERN = /ISBN[\s-]*([\d-X]{9,13})/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

let rekognitionClient: RekognitionClient | null = null;
function getClient(): RekognitionClient {
  if (!rekognitionClient) rekognitionClient = new RekognitionClient({});
  return rekognitionClient;
}

function extractIsbn(lines: string[]): string | null {
  for (const line of lines) {
    const match = ISBN_PATTERN.exec(line);
    if (match?.[1] && isValidIsbn(match[1])) {
      return normalizeIsbn(match[1]);
    }
  }
  return null;
}

export const scanRouter = new Hono();

// Order matters: auth first (sets userId), then the per-user limit reads it.
scanRouter.use("*", authMiddleware);
scanRouter.use("*", userRateLimit(scanLimiter, { metricEvent: "rate_limited_scan" }));

// POST /v1/scan/text
// Per-route body limit: 500 KB — images require more than the global 64 KB cap.
// The global bodyLimit in app.ts exempts /v1/scan/text; this limit applies instead.
scanRouter.post(
  "/text",
  bodyLimit({
    maxSize: 500 * 1024,
    onError: (c) => c.json({ error: "Image too large" }, 413),
  }),
  async (c) => {
    if (!OCR_SCAN_ENABLED) {
      return c.json({ error: "Not found" }, 404);
    }

    let imageBytes: Uint8Array;
    try {
      const body = await c.req.parseBody();
      const file = body["image"];
      if (!file || typeof file === "string") {
        return c.json({ error: "Missing or invalid image field" }, 400);
      }
      if (!ALLOWED_IMAGE_TYPES.has((file as File).type)) {
        return c.json({ error: "Unsupported image type" }, 415);
      }
      const buf = await (file as File).arrayBuffer();
      imageBytes = new Uint8Array(buf);
    } catch {
      return c.json({ error: "Invalid multipart body" }, 400);
    }

    if (imageBytes.length === 0) {
      return c.json({ error: "image field is empty" }, 400);
    }

    try {
      const result = await getClient().send(
        new DetectTextCommand({ Image: { Bytes: imageBytes } }),
      );
      const lines = (result.TextDetections ?? [])
        .filter((d) => d.Type === "LINE" && d.DetectedText)
        .map((d) => d.DetectedText!);

      emitMetric("OcrScans");
      return c.json({ isbn13: extractIsbn(lines) });
    } catch (err) {
      console.error("Rekognition DetectText failed:", err instanceof Error ? err.message : err);
      return c.json({ error: "OCR service unavailable" }, 502);
    }
  },
);
