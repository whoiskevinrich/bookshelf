---
paths:
  - "apps/web/src/components/scanner/**/*"
  - "apps/web/src/hooks/useBarcodeScanner.ts"
  - "apps/web/src/lib/barcode/**/*"
  - "apps/web/src/lib/ocr/**/*"
  - "apps/web/src/context/ScannerPreferencesContext.tsx"
---

# Scanner

Camera-based ISBN capture: barcode decode (primary) + OCR (fallback for pre-ISBN
books). See `docs/adrs/014-mobile-barcode-scanning.md` and
`docs/adrs/026-scanner-destination-memory.md`.

## Decoder tiers (don't reorder without revisiting the ADR)

- Barcode: native `BarcodeDetector` (Android) → `zxing-wasm` fallback
  (`lib/barcode/scanner.ts`), lazy-imported, **self-hosted** `.wasm` — never
  switch this to a CDN (ADR-014 rejected that on CSP grounds).
- OCR: native `TextDetector` → `tesseract.js` (lazy, ~5MB) → server
  `POST /v1/scan/text` (Rekognition) — `lib/ocr/scanner.ts`.
- Both implement the same `scan(video)`/`dispose()` interface — new decoders
  must conform to it.

## Flow

`useBarcodeScanner` (rear camera only, `facingMode: "environment"`, no
front/back picker by design) → 250ms poll (`SCAN_INTERVAL_MS`) →
`ScanModal.tsx` state machine (`scanning → looking-up → confirm/not-found →
added`) → `extractIsbn13` (`lib/isbn.ts`) → `getBookByIsbn` → add via
`useAddToShelf`.

## Non-negotiables

- **No feature flag**: the barcode scanner shipped to both envs and the flag
  was retired (BOOKSHELF-26) — visibility is gated only by
  `supportsCameraScan()` below. The separate OCR text-scan mode still ships
  dark behind `features.ocrScan`.
- **Destination chip is the only setter** (ADR-026): confirm-sheet button
  taps are one-off overrides and must never update the remembered
  `scanner:destination`/shelf preference. Don't reintroduce "last add wins."
- **Always-dark surface**: `ScanModal` wraps content in `.dark` — camera UI
  needs max contrast regardless of app theme. Use design-system
  `Button`/`inputClass`; never inline colors here.
- **Dedupe window is 2.5s** (`DEDUPE_MS`) — shortening it makes a barcode
  sitting in frame re-fire the lookup.
- **409 = not an error**: route duplicate adds through `isConflictError()`;
  surface as an amber flash (auto-add) or confirm-sheet message (single),
  never a generic error state.
- Manual ISBN entry must stay reachable from every state (denied, no-camera,
  error, not-found).

## Gotchas

- `supportsCameraScan()` (`lib/device.ts`) intentionally excludes desktop
  webcams — don't "fix" that.
- A remembered shelf that's since been deleted resolves to "no shelf"
  silently — not an error state to handle.
