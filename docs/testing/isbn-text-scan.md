# Testing Strategy: ISBN Text Scan (OCR)

**Feature:** ISBN Text Scan — three-tier OCR stack for pre-2007 paperbacks  
**Spec:** `docs/specs/isbn-text-scan.md`  
**Status:** Draft — written before implementation; update file paths if names change during development.

---

## Overview

This document describes what to test, how to mock each external dependency, which files to create, and which gaps are explicitly accepted as untestable in CI.

The feature introduces:

- `apps/web/src/lib/ocr/scanner.ts` — `extractIsbnText(imageData)`, three-tier OCR fallthrough
- `apps/web/src/components/scanner/ScannerViewfinder.tsx` — video element, reticle, mode label
- `apps/web/src/components/scanner/ScannerModeBar.tsx` — `SegmentedControl` toggle + auto-fallback `Callout`
- `apps/web/src/components/scanner/ScannerResultFlow.tsx` — lookup/confirm/success/error states extracted from `ScanModal`
- `apps/api/src/routes/scan.ts` — `POST /v1/scan/text` handler (Rekognition)
- Updates to `apps/web/src/lib/runtime-config.ts` — `features.ocrScan` flag
- Updates to `apps/web/src/context/ScannerPreferencesContext.tsx` — `inputMode: "barcode" | "text"` preference
- Updates to `apps/web/src/lib/analytics.ts` and `apps/api/src/routes/events.ts` — five new analytics events

---

## 1. What to Mock vs What to Test Real

| Dependency                                         | Strategy                                                                                           | Rationale                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `TextDetector` (Shape Detection API)               | Always mock via `vi.stubGlobal`                                                                    | Not available in jsdom or Node; mocking mirrors the pattern in `barcode/scanner.test.ts`     |
| Tesseract.js WASM                                  | Mock the dynamic import; never run WASM in CI                                                      | ~5 MB download; several seconds to initialize; unreliable in jsdom with no real image pixels |
| AWS Rekognition (`DetectTextCommand`)              | Always mock                                                                                        | External paid API; no CI credentials; latency unpredictable                                  |
| `normalizeIsbn` / `isValidIsbn` from `lib/isbn.ts` | Test real (no mock)                                                                                | Pure functions; deterministic; already covered in `isbn.test.ts`                             |
| `authMiddleware` in API route tests                | Mock by stubbing `c.get("auth")` via a fake middleware (same pattern used in existing route tests) | Avoids live Cognito JWKS fetch in unit tests                                                 |
| `emitMetric` from `lib/metrics.ts`                 | Spy on `process.stdout.write` or mock the module                                                   | Keeps tests from producing EMF log noise; lets assertions confirm the metric is emitted      |
| Camera `MediaStream` / `HTMLVideoElement` pixels   | Accept as untestable in unit and integration                                                       | jsdom has no real video pipeline; tested manually                                            |
| `fetch` for `POST /v1/scan/text` client call       | Mock with `vi.stubGlobal("fetch", ...)` in unit tests; intercept with `page.route()` in Playwright |                                                                                              |

---

## 2. Unit Tests

### 2.1 `lib/ocr/scanner.ts`

**File:** `apps/web/src/lib/ocr/scanner.test.ts`  
**Runner:** Vitest + jsdom  
**Dependencies mocked:** `TextDetector`, Tesseract.js dynamic import, `fetch` (for Tier 3)

```ts
// Skeleton — illustrates the mock setup pattern
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn().mockResolvedValue({
    loadLanguage: vi.fn(),
    initialize: vi.fn(),
    setParameters: vi.fn(),
    recognize: vi.fn().mockResolvedValue({ data: { text: "" } }),
    terminate: vi.fn(),
  }),
}));

const globalRef = globalThis as unknown as Record<string, unknown>;
afterEach(() => {
  delete globalRef["TextDetector"];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

#### Tier 1 — `TextDetector` (native)

| Test                                                                       | Setup                                                                             | Expected                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Returns ISBN-13 when Tier 1 finds "ISBN 978-0-553-22759-8" in the image    | `TextDetector` mock returns `[{ rawValue: "ISBN 978-0-553-22759-8" }]`            | `extractIsbnText(imageData)` resolves `"9780553227598"`        |
| Returns ISBN-13 from a hyphenated ISBN-10 line "ISBN 0-553-22759-9"        | `TextDetector` returns `[{ rawValue: "ISBN 0-553-22759-9" }]`                     | Resolves `"9780553227598"` (via `normalizeIsbn`)               |
| Falls through to Tier 2 when `TextDetector` returns no matches             | `TextDetector` returns `[]`                                                       | Tesseract.js mock is called; `TextDetector.detect` called once |
| Falls through to Tier 2 when `TextDetector` is not present in `globalThis` | No `TextDetector` on global                                                       | Tesseract.js mock is called                                    |
| Falls through when `TextDetector.detect` throws                            | `detect` rejects with `new Error("not ready")`                                    | Does not throw; moves to Tier 2                                |
| Returns `null` when Tier 1 finds text but no ISBN pattern is present       | `TextDetector` returns `[{ rawValue: "SOME RANDOM COVER TEXT" }]`                 | Resolves `null` after all tiers miss                           |
| ISBN with bad checksum from Tier 1 is treated as a miss                    | `TextDetector` returns `[{ rawValue: "ISBN 9780553227599" }]` (wrong check digit) | `normalizeIsbn` validation fails; falls through to Tier 2      |

#### Tier 2 — Tesseract.js WASM

| Test                                                             | Setup                                                                                                 | Expected                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| Returns ISBN-13 when Tesseract produces "ISBN 978-0-553-22759-8" | `TextDetector` absent; Tesseract `recognize` returns `{ data: { text: "ISBN 978-0-553-22759-8\n" } }` | Resolves `"9780553227598"`      |
| Tesseract is not loaded until Tier 1 is unavailable/misses       | `TextDetector` present and returns a valid ISBN                                                       | `createWorker` is not called    |
| Falls through to Tier 3 when Tesseract returns text with no ISBN | Tesseract returns `{ data: { text: "No price barcode here" } }`                                       | `fetch` (Tier 3) is called once |
| Falls through to Tier 3 when Tesseract import rejects            | `vi.mock("tesseract.js", () => { throw new Error("WASM load failed") })`                              | Falls through; does not throw   |

#### Tier 3 — `POST /v1/scan/text`

| Test                                                   | Setup                                                                      | Expected                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Returns ISBN-13 from a successful server response      | `fetch` resolves `{ ok: true, json: () => ({ isbn13: "9780553227598" }) }` | Resolves `"9780553227598"`                         |
| Returns `null` when server responds `{ isbn13: null }` | `fetch` resolves `{ ok: true, json: () => ({ isbn13: null }) }`            | Resolves `null`                                    |
| Returns `null` and does not throw on 502               | `fetch` resolves `{ ok: false, status: 502 }`                              | Resolves `null` (does not surface error to caller) |
| Returns `null` and does not throw on network error     | `fetch` rejects `new Error("network failure")`                             | Resolves `null`                                    |
| Sends a multipart/form-data body with an `image` field | Inspect the `fetch` call args                                              | `FormData` with field named `"image"`              |
| Sends frame resized to ≤720p as JPEG                   | Provide an `ImageData` wider than 1280px                                   | `fetch` call body's blob has JPEG content-type     |

#### Fallthrough guarantees

| Test                                      | Setup                                                                    | Expected                         |
| ----------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Returns `null` when all three tiers miss  | Tier 1 absent; Tier 2 returns no ISBN; Tier 3 returns `{ isbn13: null }` | Resolves `null`                  |
| Returns `null` when all three tiers throw | All three throw errors                                                   | Resolves `null`; does not reject |

---

### 2.2 API Route — `POST /v1/scan/text`

**File:** `apps/api/src/routes/scan.test.ts`  
**Runner:** Vitest (Node, ESM)  
**Pattern:** Follows `apps/api/src/routes/books.ts` — construct a `Hono` app with a stub auth middleware, then call `app.request()` directly.

```ts
import { Hono } from "hono";
import { scanRouter } from "./scan.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub auth to avoid live JWKS fetch
const app = new Hono();
app.use("*", async (c, next) => {
  c.set("auth", { userId: "user-1", cognitoUsername: "test@example.com", isGoogleUser: false });
  await next();
});
app.route("/v1/scan", scanRouter);
```

#### Feature flag — `OCR_SCAN_ENABLED`

| Test                                      | Env                                      | Request                              | Expected                                        |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| Returns 404 when flag is absent           | `delete process.env.OCR_SCAN_ENABLED`    | `POST /v1/scan/text` with valid JPEG | `{ status: 404, body: { error: "not_found" } }` |
| Returns 404 when flag is `"false"`        | `process.env.OCR_SCAN_ENABLED = "false"` | Valid JPEG                           | `{ status: 404 }`                               |
| Proceeds to handler when flag is `"true"` | `process.env.OCR_SCAN_ENABLED = "true"`  | Valid JPEG (Rekognition mocked)      | Status 200                                      |

Use `beforeEach`/`afterEach` to set and restore `process.env.OCR_SCAN_ENABLED` so tests are hermetic.

#### Auth

| Test                                     | Setup                                                          | Expected          |
| ---------------------------------------- | -------------------------------------------------------------- | ----------------- |
| Returns 401 with no Authorization header | Remove the stub auth middleware; use the real `authMiddleware` | `{ status: 401 }` |

#### Input validation — body

| Test                                | Request                                 | Expected                                            |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------- |
| Missing `image` field               | Empty multipart body                    | `{ status: 400, body: { error: "invalid_image" } }` |
| Non-image content-type              | `image` field with `text/plain` content | `{ status: 400, body: { error: "invalid_image" } }` |
| Body exceeds 500 KB per-route limit | Send 600 KB JPEG                        | `{ status: 413 }` (Hono `bodyLimit` triggers)       |
| Body under 500 KB passes body limit | 499 KB JPEG                             | Not rejected by body limit (proceeds to handler)    |

Note: the global 64 KB body limit in `app.ts` is overridden by the per-route `bodyLimit({ maxSize: 500 * 1024 })` added before the handler. The test for the 413 response validates that the per-route limit is actually registered — if it's missing, the global 64 KB limit fires first, giving a false-pass at 500 KB but a false-fail at 100 KB. Test explicitly at 499 KB to confirm the override is effective.

#### Rekognition integration (mocked)

Mock `@aws-sdk/client-rekognition` at the module level:

```ts
vi.mock("@aws-sdk/client-rekognition", () => ({
  RekognitionClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DetectTextCommand: vi.fn(),
}));
```

| Test                                                                       | Rekognition mock response                                                                | Expected                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Returns `{ isbn13: "9780553227598" }` when Rekognition finds the ISBN line | `TextDetections: [{ Type: "LINE", DetectedText: "ISBN 0-553-22759-9", Confidence: 95 }]` | `{ status: 200, body: { isbn13: "9780553227598" } }`                       |
| Returns `{ isbn13: null }` when no ISBN pattern in detections              | `TextDetections: [{ Type: "LINE", DetectedText: "BANTAM BOOKS" }]`                       | `{ status: 200, body: { isbn13: null } }`                                  |
| Returns `{ isbn13: null }` when `TextDetections` is empty                  | `TextDetections: []`                                                                     | `{ status: 200, body: { isbn13: null } }`                                  |
| Normalizes ISBN-10 embedded in text to ISBN-13                             | `DetectedText: "ISBN 0553227599"`                                                        | `body.isbn13 === "9780553227598"`                                          |
| Returns `{ isbn13: null }` for invalid ISBN checksum in OCR text           | `DetectedText: "ISBN 9780553227599"` (bad check digit)                                   | `body.isbn13 === null`                                                     |
| Returns 502 when Rekognition throws                                        | `send` rejects with `new Error("ThrottlingException")`                                   | `{ status: 502, body: { error: "ocr_unavailable" } }`                      |
| Does not include stack trace in 502 body                                   | Rekognition throws                                                                       | `body.error === "ocr_unavailable"` — no `stack` or exception message field |

#### Metrics

| Test                                             | Setup                         | Expected                                                                 |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| Emits `OcrScans` metric on each Rekognition call | Spy on `process.stdout.write` | Output includes `"OcrScans"` or `"event":"OcrScans"` in an EMF JSON line |
| Does not emit metric when flag is off (404 path) | `OCR_SCAN_ENABLED` unset      | `process.stdout.write` not called with an OcrScans metric line           |

---

### 2.3 `ScannerViewfinder` component

**File:** `apps/web/src/components/scanner/ScannerViewfinder.test.tsx`  
**Runner:** Vitest + RTL + jsdom

| Test                                                             | Setup                             | Expected                                                                      |
| ---------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| Renders a `<video>` element with `autoPlay playsInline muted`    | Mount with `mode="barcode"`       | `getByRole` or `querySelector("video")` exists with those attributes          |
| Barcode mode renders a square reticle                            | `mode="barcode"`                  | Reticle element does not have the wide-rectangle CSS classes (e.g. `w-[70%]`) |
| Text mode renders a wide horizontal reticle                      | `mode="text"`                     | Reticle element has wide-rectangle dimensions                                 |
| Reticle label "Align the ISBN line here" is present in text mode | `mode="text"`, `showLabel={true}` | `getByText("Align the ISBN line here")` present                               |
| Reticle label is absent in barcode mode                          | `mode="barcode"`                  | No element with label text                                                    |
| Scan button is visible only in text mode                         | `mode="text"`                     | `getByRole("button", { name: /scan/i })` present                              |
| Scan button is absent in barcode mode                            | `mode="barcode"`                  | No scan button                                                                |
| Scan button is disabled while `scanning={true}`                  | `mode="text"`, `scanning={true}`  | Button has `disabled` attribute                                               |
| Scan button label changes to "Scanning…" while in-flight         | `scanning={true}`                 | `getByRole("button", { name: /scanning…/i })`                                 |
| "Nothing found" hint appears after a miss                        | `missHint={true}`                 | `getByText(/nothing found/i)` visible                                         |
| "Nothing found" hint is absent initially                         | `missHint={false}`                | Hint element not in DOM                                                       |

RTL renders `ScannerViewfinder` without a live camera stream — the `<video>` will have no `srcObject`. Tests should not depend on video playback; they verify DOM structure and ARIA only.

---

### 2.4 `ScannerModeBar` component

**File:** `apps/web/src/components/scanner/ScannerModeBar.test.tsx`  
**Runner:** Vitest + RTL + jsdom

| Test                                                                    | Setup                                                      | Expected                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Renders a radiogroup with "Barcode" and "Text" options                  | Mount with `mode="barcode"`                                | `getByRole("radiogroup")` with two radios; "Barcode" is `aria-checked="true"` |
| Clicking "Text" fires `onModeChange("text")`                            | `onModeChange={spy}`                                       | Spy called with `"text"`                                                      |
| "Text" option is not rendered when `ocrEnabled={false}`                 | `ocrEnabled={false}`                                       | `queryByRole("radio", { name: /text/i })` is `null`                           |
| Auto-fallback `Callout` is not shown initially                          | `mode="barcode"`, no timer                                 | `queryByRole("note")` is `null`                                               |
| Auto-fallback `Callout` appears after 2.5 s of no barcodes              | Use `vi.useFakeTimers()` and advance 2500 ms               | `getByRole("note")` with title "Can't find a barcode?" appears                |
| Timer resets on each barcode detection                                  | Advance 2000 ms, fire `onBarcodeDetected`, advance 2500 ms | Callout does not appear until 2.5 s after the last `onBarcodeDetected` call   |
| "Switch to Text" button in Callout calls `onModeChange("text")`         | Callout visible; click button                              | `onModeChange` spy called with `"text"`                                       |
| Callout auto-dismisses on barcode detection after appearing             | Show Callout; fire `onBarcodeDetected`                     | `queryByRole("note")` becomes `null`                                          |
| Callout dispatches `track("scan_text_mode_suggested")` on appearance    | Spy on analytics `track`                                   | Called with `"scan_text_mode_suggested"`                                      |
| Clicking "Switch to Text" dispatches `track("scan_text_mode_accepted")` | Click button                                               | `track` called with `"scan_text_mode_accepted"`                               |
| Callout has `role="note"` and a dismiss button with `aria-label`        | Callout visible                                            | `getByRole("note")` present; dismiss button has non-empty `aria-label`        |

---

### 2.5 `ScannerResultFlow` component

**File:** `apps/web/src/components/scanner/ScannerResultFlow.test.tsx`  
**Runner:** Vitest + RTL + jsdom

These tests confirm the refactoring is behavior-preserving — the states already existed in `ScanModal`; extraction must not change their observable behavior.

| Test                                                                            | Setup                                                            | Expected                                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| "looking-up" state shows a loading indicator                                    | `state="looking-up"`                                             | Loading indicator present with `role="status"` and `aria-label` |
| "confirm" state shows book title and "Add to Owned" / "Add to Wishlist" buttons | `state="confirm"`, `book={{ title: "Dune", ... }}`               | Both CTAs visible                                               |
| "not-found" state shows manual ISBN entry field                                 | `state="not-found"`                                              | ISBN input field visible                                        |
| "added" state in single mode shows the added book                               | `state="added"`, `item={{ title: "Dune", ... }}`                 | Book title in DOM                                               |
| "error" state in confirm view shows error message                               | `state="confirm"`, `error="Couldn't add that book — try again."` | Error text visible                                              |

---

### 2.6 `runtime-config.ts` — `features.ocrScan` flag

**File:** `apps/web/src/lib/runtime-config.test.ts` (extend existing file)

| Test                                                               | Config JSON                                      | Expected                                       |
| ------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| Defaults `ocrScan` to `false` when `config.json` predates the flag | `{ features: { scanner: true } }` (no `ocrScan`) | `cfg.features.ocrScan === false`               |
| Reads `ocrScan: true` from config.json                             | `{ features: { scanner: true, ocrScan: true } }` | `cfg.features.ocrScan === true`                |
| Reads `ocrScan: false` from config.json                            | `{ features: { ocrScan: false } }`               | `cfg.features.ocrScan === false`               |
| `fromEnv()` fallback reads `VITE_FEATURE_OCR_SCAN === "true"`      | `import.meta.env.VITE_FEATURE_OCR_SCAN = "true"` | `getRuntimeConfig().features.ocrScan === true` |
| `fromEnv()` fallback defaults `ocrScan` to `false` when var absent | No `VITE_FEATURE_OCR_SCAN`                       | `ocrScan === false`                            |

---

### 2.7 Analytics events — new event names

**File:** `apps/web/src/lib/analytics.test.ts` (extend existing file) and `apps/api/src/routes/events.test.ts`

Client side: confirm the five new event names (`scan_text_mode_activated`, `scan_text_mode_suggested`, `scan_text_mode_accepted`, `scan_text_success`, `scan_text_miss`) are accepted by `track()` without TypeScript errors. This is enforced at the type level (union type) — the test file imports and calls `track("scan_text_success")` to catch type drift at compile time. No runtime assertion is needed.

Server side: confirm `POST /v1/events` accepts each new event name and returns 200. Confirm a non-allowlisted name still returns 400. These follow the existing events route test pattern.

---

## 3. Integration Tests

Integration tests exercise multiple units together without a live Rekognition or camera, using the API test framework (`app.request()`) and RTL for the UI.

### 3.1 `OCR_SCAN_ENABLED` flag behaviour — API layer

**File:** `apps/api/src/routes/scan.test.ts` (same file as unit tests, separate `describe` block)

Test that the full app (`apps/api/src/app.ts`) with `scanRouter` mounted returns the correct behaviour:

| Scenario                                                       | Flag                                            | Expected                                                 |
| -------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Flag off: endpoint is invisible                                | `OCR_SCAN_ENABLED` unset                        | `POST /v1/scan/text` → 404 even with valid auth and body |
| Flag on: endpoint handles valid request                        | `OCR_SCAN_ENABLED = "true"`, Rekognition mocked | `POST /v1/scan/text` → 200                               |
| Flag on: per-route body limit is active (not the global 64 KB) | `OCR_SCAN_ENABLED = "true"`, send 499 KB        | 200 (not 413)                                            |

### 3.2 ScanModal refactor — preserved external behaviour

**File:** `apps/web/src/components/scanner/ScanModal.integration.test.tsx`

Mount `ScanModal` with all dependencies mocked (`useBarcodeScanner`, `useScannerPreferences`, `useAddToShelf`, `getBookByIsbn`) and verify that the extract did not break the barcode path. These tests should pass unchanged after `ScannerViewfinder`, `ScannerModeBar`, and `ScannerResultFlow` are extracted.

| Scenario                                                                                  | Expected                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Initial render: `ScanModal` shows the viewfinder and SegmentedControl                     | "Barcode" radio selected; video element present                    |
| Barcode scan fires `handleDecode` → lookup → confirm view                                 | Book title appears after `getBookByIsbn` resolves                  |
| Switching to Text mode via SegmentedControl changes active mode                           | "Text" radio is `aria-checked="true"`                              |
| Text-mode Scan button fires `extractIsbnText` with an `ImageData` capture                 | `extractIsbnText` mock called; resolves ISBN; confirm view appears |
| `ScannerPreferencesContext` `inputMode` persists across modal close/reopen within session | Reopen modal: "Text" radio remains selected                        |
| Mode-switch fires `track("scan_text_mode_activated")`                                     | Analytics spy called                                               |

Mock `extractIsbnText` to return a known ISBN-13 so the test does not depend on OCR logic:

```ts
vi.mock("../../lib/ocr/scanner", () => ({
  extractIsbnText: vi.fn().mockResolvedValue("9780553227598"),
}));
```

---

## 4. E2E Tests (Playwright)

**Directory:** `apps/web/e2e/isbn-text-scan.spec.ts`  
**Setup:** Signed-in via `storageState: ".auth/user.json"` (same pattern as `books-auth.spec.ts`).  
**Key constraint:** Camera access is never granted in CI headless Chromium. All camera-dependent tests use `page.route()` to intercept the OCR server call, plus `page.addInitScript()` to install a mock `TextDetector` that returns a canned result.

### 4.1 Feature flag off — text mode hidden

```ts
// Intercept /config.json to return features.ocrScan: false
await page.route("**/config.json", async (route) => {
  const response = await route.fetch();
  const json = await response.json();
  await route.fulfill({ json: { ...json, features: { ...json.features, ocrScan: false } } });
});
```

| Test                                                             | Expected                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| "Text" radio option is absent in ScanModal when `ocrScan: false` | `queryByRole("radio", { name: /text/i })` times out (not present) |

### 4.2 Feature flag on — text mode visible

```ts
// Intercept /config.json to return features.ocrScan: true
await page.route("**/config.json", (route) => {
  // ... same pattern
});
```

| Test                                                               | Expected                                           |
| ------------------------------------------------------------------ | -------------------------------------------------- |
| ScanModal renders "Barcode" and "Text" radios when `ocrScan: true` | Both radios visible                                |
| "Text" starts unselected                                           | "Barcode" has `aria-checked="true"`                |
| Clicking "Text" selects it                                         | "Text" has `aria-checked="true"`                   |
| "Scan" button appears below the reticle in text mode               | `getByRole("button", { name: /^scan$/i })` visible |
| "Scan" button absent in barcode mode                               | Switching back to "Barcode" hides the Scan button  |

### 4.3 Tap-to-scan flow — mocked OCR response

Install a fake `TextDetector` on the page so Tier 1 returns a canned ISBN without a real camera:

```ts
await page.addInitScript(() => {
  class FakeTextDetector {
    async detect() {
      return [{ rawValue: "ISBN 978-0-553-22759-8" }];
    }
  }
  (globalThis as unknown as Record<string, unknown>)["TextDetector"] = FakeTextDetector;
});
```

Then intercept `captureFrame` (or stub `HTMLVideoElement.captureStream`) so the Scan button can fire without a live stream.

| Test                                                            | Expected                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Tapping "Scan" button fires OCR and enters "Scanning…" state    | Button label changes to "Scanning…" briefly                                             |
| Successful OCR (mocked Tier 1) enters the confirm view          | Book title visible after `getBookByIsbn` resolves                                       |
| Scan button is disabled during in-flight OCR                    | Clicking Scan again during Scanning is a no-op                                          |
| Null OCR result shows "Nothing found — try re-aligning" for 2 s | Hint text appears then disappears (use `expect(locator).toBeHidden({ timeout: 3500 })`) |

For the null-result test, override `FakeTextDetector.detect` to return `[]` and intercept `POST /v1/scan/text` to return `{ isbn13: null }`.

### 4.4 Auto-fallback Callout timing

This test can only run meaningfully with a real (or mock) barcode scan loop running. Since camera access is unavailable in CI, use `page.evaluate` to directly invoke the internal `noBarcodeSince` timer state, or wait for the 2.5 s timeout with `page.waitForSelector`.

```ts
// Navigate to the shelf, open ScanModal with ocrScan: true
// Wait 3 seconds (2.5 s threshold + 500 ms buffer)
await page.waitForTimeout(3000);
await expect(page.getByRole("note")).toBeVisible();
await expect(page.getByRole("note")).toContainText("Can't find a barcode?");
```

Note: this test is slow by necessity (3 s wall-clock). Run it in a dedicated `test.slow()` group or accept the extra CI time.

| Test                                                          | Expected                                       |
| ------------------------------------------------------------- | ---------------------------------------------- |
| Callout appears after 2.5 s in barcode mode with no barcode   | `role="note"` visible with correct title       |
| Callout "Switch to Text" button switches the SegmentedControl | "Text" radio `aria-checked="true"` after click |
| Callout is not shown in text mode                             | Switch to text mode: Callout never appears     |

### 4.5 Auth gate — `POST /v1/scan/text`

Use the `request` fixture (no storageState, same pattern as `books-auth.spec.ts`):

```ts
test("POST /v1/scan/text returns 401 without a token", async ({ request }) => {
  const formData = new FormData();
  formData.append("image", new Blob(["fake"], { type: "image/jpeg" }), "img.jpg");
  const res = await request.post(`${API_BASE_URL}/v1/scan/text`, { multipart: formData });
  expect(res.status()).toBe(401);
});
```

Additional auth gate test when the flag is off (even authenticated requests return 404):

```ts
test("POST /v1/scan/text returns 404 when OCR_SCAN_ENABLED is not set", async ({ request }) => {
  // CI environment variable OCR_SCAN_ENABLED is expected to be absent in the test env
  // This test is only meaningful if the deployed test API has the flag off.
  // Mark it as a smoke test (apps/api/vitest.smoke.config.ts) rather than CI-blocking E2E.
});
```

---

## 5. Coverage Gaps — Explicitly Accepted

The following are **not** tested automatically in CI. Each gap is accepted with rationale.

### 5.1 Real camera video stream

- **Gap:** Unit and integration tests cannot capture a real `MediaStream` frame because jsdom has no camera pipeline. The `HTMLVideoElement` has no pixels, so `ImageData` capture returns an empty buffer.
- **Impact:** `extractIsbnText` argument construction (frame-capture logic inside `ScanModal`) is not exercised with real pixels.
- **Mitigation:** Playwright E2E mocks `TextDetector` to bypass frame-dependent OCR; manual QA on a real device covers the actual camera path.
- **Manual test required:** On an Android or iOS device with a real pre-2007 paperback: open text mode, tap "Scan", confirm ISBN is extracted and book is added.

### 5.2 Tesseract.js WASM in CI

- **Gap:** The Tesseract.js WASM runtime is never executed in CI tests. The dynamic import is mocked to return a controlled `recognize` response.
- **Impact:** The character whitelist configuration (`0-9-X ISBN `) is untested, and WASM initialization errors are not exercised.
- **Mitigation:** Tesseract.js is a well-maintained library with its own test suite. The whitelist is a configuration value, not a code path. If the dynamic import itself fails, the OCR stack falls through to Tier 3 — that fallthrough is covered.
- **Manual test required:** On an iOS device (no `TextDetector`), with Wi-Fi available for the one-time WASM download: text mode, tap "Scan" pointing at an ISBN line, confirm Tier 2 returns the correct value.

### 5.3 Real Rekognition calls

- **Gap:** No test calls AWS Rekognition's live `DetectText` API. All Rekognition interactions are mocked at the SDK level.
- **Impact:** IAM permission issues, regional availability, response-format changes, and Rekognition confidence score behaviour are not validated in CI.
- **Mitigation:** Use `apps/api/test:smoke` (the existing `vitest.smoke.config.ts` runner) for a manual smoke test against the deployed dev API with a real JPEG containing an ISBN line. Verify the `OcrScans` CloudWatch metric appears in the dev account after the call.
- **Smoke test steps:** POST a real book-cover JPEG to `https://d1n55zwqulukok.cloudfront.net/v1/scan/text` with a valid Cognito token; confirm response `{ isbn13: "<valid-isbn>" }`.

### 5.4 Frame resize and JPEG encoding

- **Gap:** The logic that downsizes frames to ≤720p and encodes them as JPEG q=0.7 is tested only structurally (correct content-type in the fetch call) in jsdom, not for actual pixel content or byte size, since jsdom's `Canvas.toBlob` is a stub.
- **Impact:** A regression in the resize/encode step (e.g. accidentally uploading a full 4K frame) would not be caught in CI.
- **Mitigation:** The 500 KB per-route body limit catches runaway uploads at the API layer. The JPEG size assertion (`≤200 KB`) is manually verified during dev.

### 5.5 Haptic feedback

- **Gap:** `navigator.vibrate(40)` is not testable in jsdom. The call silently no-ops.
- **Impact:** Vibration behaviour change would not be caught by tests.
- **Mitigation:** Low-risk — `navigator.vibrate` is only called on OCR success, which is already covered by other outcome assertions. No dedicated test needed.

### 5.6 Mode memory across sessions (P1)

- **Gap:** The `localStorage` persistence of `scanner_mode` across fresh page loads is not covered in unit tests (mocked context) or the current Playwright setup.
- **Impact:** A regression in `useLocalStorage` keying would not be caught.
- **Mitigation:** If/when the P1 item is implemented, add a Playwright test that reloads the page after switching to text mode and asserts "Text" is still selected. Until P1 is shipped, no test needed.

---

## 6. Test File Summary

| File                                                             | Type               | Runner         |
| ---------------------------------------------------------------- | ------------------ | -------------- |
| `apps/web/src/lib/ocr/scanner.test.ts`                           | Unit               | Vitest + jsdom |
| `apps/web/src/components/scanner/ScannerViewfinder.test.tsx`     | Unit               | Vitest + RTL   |
| `apps/web/src/components/scanner/ScannerModeBar.test.tsx`        | Unit               | Vitest + RTL   |
| `apps/web/src/components/scanner/ScannerResultFlow.test.tsx`     | Unit               | Vitest + RTL   |
| `apps/web/src/lib/runtime-config.test.ts`                        | Unit (extended)    | Vitest + jsdom |
| `apps/api/src/routes/scan.test.ts`                               | Unit + Integration | Vitest (Node)  |
| `apps/web/src/components/scanner/ScanModal.integration.test.tsx` | Integration        | Vitest + RTL   |
| `apps/web/e2e/isbn-text-scan.spec.ts`                            | E2E                | Playwright     |

All unit and integration tests run as part of `pnpm test` in their respective apps. The E2E suite runs via `pnpm test:e2e` from `apps/web`.

---

## 7. CI Considerations

- Tesseract.js WASM must never be downloaded in CI. The module mock in `scanner.test.ts` must be applied before any import of the OCR scanner resolves — use `vi.mock("tesseract.js", ...)` at the top of the file, before any `import` statements that could trigger the dynamic load path.
- `OCR_SCAN_ENABLED` must not be set in CI environment variables unless a test explicitly needs it — most tests validate the flag-off path as the default.
- The Playwright E2E suite does not require `OCR_SCAN_ENABLED` on the test API for the auth-gate test; it does require it for the full tap-to-scan flow test. Document this in `apps/web/.env.test.local.example`.
- The 3-second auto-fallback Callout Playwright test should be annotated with `test.slow()` to avoid triggering a default timeout warning in CI.
