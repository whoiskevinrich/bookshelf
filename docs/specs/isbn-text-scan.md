# ISBN Text Scan — OCR Recognition for Legacy Print ISBNs

**Status:** Draft  
**Author:** Kevin Rich  
**Related ADRs:** ADR-001 (tech stack), ADR-015 (auth), ADR-016 (analytics)

---

## Problem Statement

Older paperbacks (printed roughly before 2007) use publisher-specific UPC codes as their
machine-readable barcode — not the ISBN-13 EAN-13 format the current scanner decodes. For
example, "The Stainless Steel Rat for President" carries barcode `0-76783-00275` (a Bantam
Books publisher code), which encodes nothing the app can map to an ISBN. The ISBN appears
**only** as printed text on the back cover: `ISBN 0-553-22759-9`. Users who own large
collections of pre-millennium sci-fi and fantasy paperbacks — exactly the audience most
likely to build a personal shelf tracker — cannot use the camera scanner for most of their
books. They must type every ISBN by hand, defeating the core value of camera-based entry.

## Goals

1. **Coverage**: ≥90% of books with any machine-readable ISBN (printed text or EAN-13
   barcode) can be added via camera scan without manual typing.
2. **Speed**: Average time from scan trigger to book confirmed is ≤8 seconds end-to-end
   (including OCR and metadata lookup) for a successful text scan. On-device tiers target
   ≤2 s for OCR alone; server fallback adds ≤2 s more.
3. **Accuracy**: False-positive reads (OCR confident but wrong) are <1% of completed scans.
4. **No regression**: Existing EAN-13 barcode scan flow is unchanged; current success rates
   are maintained.
5. **Design coherence**: All new UI states use existing components from the Bookshelf design
   system; no one-off styles are introduced.

## Non-Goals

1. **Full-page OCR**: We are not building a general cover scanner. Only the printed ISBN
   line is extracted; all other cover text is ignored.
2. **Price-supplement barcode decoding**: The 5-digit add-on barcode visible on pre-2007
   paperbacks encodes the retail price, not the ISBN. Out of scope.
3. **Publisher UPC → ISBN crosswalk**: Mapping codes like `0-76783-00275` to an ISBN would
   require a lookup table we don't have and can't reliably maintain. Out of scope.
4. **General retail UPC scanning**: The feature remains book-centric. No retail product
   lookups are in scope.

## User Stories

### Collector of older paperbacks

- As a collector of older sci-fi and fantasy paperbacks, I want to hold a pre-2007 book up
  to my phone camera and have the app read the printed "ISBN" line so that I can add it to
  my shelf without manually typing a 10-digit code.
- As a collector, I want to see a visual guide showing where to position the ISBN text in
  the viewfinder so that I know I'm holding the phone at the right angle.
- As a collector, I want clear visual feedback when the ISBN text has been read before the
  book lookup starts so that I know the scan worked and I can lower the book.

### Any user of the camera scanner

- As a scanner user, I want the app to offer text mode automatically if no barcode is
  detected after a few seconds so that I don't have to understand which mode my book needs.
- As a scanner user, I want the active scan mode (barcode or text) to be visible at a
  glance so that I can switch if needed without hunting for a setting.

### User scanning a mixed-era collection

- As a user scanning books from multiple decades, I want the scanner to prefer a barcode
  hit over a text hit when both are available so that the faster, more reliable path runs
  first without me managing it.

## Requirements

### Must-Have (P0)

#### Text scan mode in ScanModal

A "Text" scan mode is added alongside the existing "Barcode" mode via a mode toggle rendered
inside `ScanModal`. The toggle reuses the existing `SegmentedControl` component.

In text mode the video preview reticle changes to a **wide horizontal rectangle** (≈70% of
screen width, ≈18% of screen height) positioned in the lower third of the viewfinder — the
area where the ISBN line appears on a typical paperback held with the back cover facing the
camera. The existing square barcode reticle is retained for barcode mode; only the shape and
position change, not the `border-white/60` ring style or the dark camera surface.

Acceptance criteria:

- [ ] `SegmentedControl` with options "Barcode" and "Text" is visible inside `ScanModal`
      when the device supports camera scanning.
- [ ] Switching modes updates the reticle without closing or re-mounting the modal.
- [ ] Active mode is persisted via `ScannerPreferencesContext` (alongside existing
      `postScanBehavior` and `scanMode` prefs) so it survives modal close/reopen within a
      session.
- [ ] Both modes remain accessible when VoiceOver / TalkBack is active (SegmentedControl
      wraps a radio group with visible labels; no icon-only affordance).

#### Feature flag

OCR text scanning is gated by `features.ocrScan` on two independent layers — client and
server — so the Rekognition call is protected even if the client-side flag is bypassed:

**Client layer**: `features.ocrScan` is a boolean in `/config.json` fetched at startup,
identical in structure to the existing `features.scanner` flag. The `SegmentedControl` mode
toggle and all three OCR tiers are only available when this is `true`.

**Server layer**: The Lambda handler for `POST /v1/scan/text` checks the `OCR_SCAN_ENABLED`
environment variable before calling Rekognition. If the variable is absent or not `"true"`,
the endpoint returns `404` immediately — no Rekognition call is made. CDK provisions this
variable from the same boolean that controls the client flag, keeping them in sync.

Acceptance criteria:

- [ ] `RuntimeConfig` in `apps/web/src/lib/runtime-config.ts` exposes `features.ocrScan`.
- [ ] `ScanModal` only renders the "Text" mode option when `features.ocrScan && supportsCameraScan()`.
- [ ] CDK infra stack adds `ocrScan: boolean` to the `config.json` output and sets
      `OCR_SCAN_ENABLED=true|false` on the Lambda environment — both default to `false`.
- [ ] `POST /v1/scan/text` returns `404 { error: "not_found" }` when `OCR_SCAN_ENABLED`
      is not `"true"`, without calling Rekognition.
- [ ] Toggling the flag off in CDK and redeploying stops all Rekognition calls without a
      code change.

Once user tiers are implemented (see TASKS.md "User tiers" + "Migrate `features.ocrScan`"
backlog items), the env-level gate will be replaced by a per-user entitlement check so OCR
scanning can be offered selectively by tier rather than toggled globally. The two-layer
client/server flag structure above is designed with this migration in mind: the server-side
`OCR_SCAN_ENABLED` guard becomes a tier check without changing the client layer.

#### Frame capture and OCR (tap-to-scan, three-tier stack)

OCR uses a **tap-to-scan** model. In text mode a "Scan" button is rendered below the wide
reticle. On tap, `ScanModal` captures one still frame from the video stream and passes it
through a three-tier OCR stack in `lib/ocr/scanner.ts` — mirroring the
`BarcodeDetector` → `zxing-wasm` pattern in `lib/barcode/scanner.ts`:

| Tier | Engine                                               | Availability                                         | Cost                                   |
| ---- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| 1    | `TextDetector` (Shape Detection API)                 | Chrome on Android + desktop Chromium/Edge            | Zero — native browser                  |
| 2    | Tesseract.js WASM (lazy-loaded, character whitelist) | All browsers with WebAssembly (including iOS Safari) | Zero per scan; ~5 MB one-time download |
| 3    | `POST /v1/scan/text` (AWS Rekognition)               | Any device, any browser                              | $0.001/call — last resort only         |

`lib/ocr/scanner.ts` exports a single async function:

```ts
extractIsbnText(imageData: ImageData): Promise<string | null>
```

It tries each tier in order, returning the first ISBN-13 found (normalized via
`normalizeIsbn`) or `null` if all tiers miss. Tier 2 is only loaded on first use
(dynamic import). Tier 3 is only called if tiers 1 and 2 are both unavailable or return
null — the frame is resized to ≤720p and encoded as JPEG q=0.7 (≤200 KB) before upload.

Tesseract.js is configured with a character whitelist (`0-9-X ISBN `) to reduce processing
time and avoid false positives from surrounding cover text.

While OCR is in-flight the "Scan" button shows `loading={true}` with label "Scanning…". On
success the hook fires the same `onScan(isbn13)` callback used by the barcode path; the
existing lookup → confirmation → success flow runs identically. On a null result the button
resets to ready with a brief `text-xs text-slate-400` hint "Nothing found — try
re-aligning" shown for 2 s then cleared.

Acceptance criteria:

- [ ] A "Scan" `<Button variant="app">` is visible below the reticle only in text mode.
- [ ] Button is disabled and shows "Scanning…" while OCR is running.
- [ ] Tier 1 (`TextDetector`) is attempted first; result is parsed for the ISBN pattern.
- [ ] Tier 2 (Tesseract.js) is dynamically imported only when Tier 1 is unavailable or
      returns null; it must not be in the initial bundle.
- [ ] Tier 3 (server) is called only when both Tier 1 and Tier 2 fail.
- [ ] Frame is resized to ≤720p and encoded at JPEG q=0.7 before the Tier 3 upload.
- [ ] When any tier returns a match the existing confirmation / auto-add flow runs without
      modification.
- [ ] Tapping "Scan" while OCR is in-flight is a no-op (button is disabled).

#### New API endpoint: `POST /v1/scan/text`

| Property         | Value                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route            | `POST /v1/scan/text`                                                                                                                                                                                          |
| Auth             | `authMiddleware` — same pattern as all other routes                                                                                                                                                           |
| Input            | `multipart/form-data`, single `image` field (JPEG or PNG)                                                                                                                                                     |
| Body limit       | 500 KB via per-route `bodyLimit` override — the global app limit is 64 KB (`apps/api/src/app.ts`); add a route-level `bodyLimit({ maxSize: 500 * 1024 })` before the handler, do not raise the global limit   |
| Processing       | Call `rekognition.detectText({ Image: { Bytes } })`, collect `TextDetections` where `Type === "LINE"`, match against `/ISBN[\s\-]*([\d\-X]+)/i`, normalize first match via `normalizeIsbn` from `lib/isbn.ts` |
| Success          | `200 { isbn13: "9780553227598" }`                                                                                                                                                                             |
| Not found        | `200 { isbn13: null }`                                                                                                                                                                                        |
| Feature disabled | `404 { error: "not_found" }` (`OCR_SCAN_ENABLED !== "true"` — no Rekognition call made)                                                                                                                       |
| Bad input        | `400 { error: "invalid_image" }` (missing field, wrong content-type, size exceeded)                                                                                                                           |
| Upstream error   | `502 { error: "ocr_unavailable" }` (Rekognition error caught and logged)                                                                                                                                      |

Additional requirements:

- `isValidIsbn` / `normalizeIsbn` from `lib/isbn.ts` must be used for all normalization —
  no inline digit-only check in the route file.
- Raw Rekognition exceptions must be caught with `console.error` and returned as 502 with a
  generic message; no stack traces in responses.
- Each Rekognition call must be counted in CloudWatch via the existing EMF metric helper
  (`apps/api/src/lib/metrics.ts`) under metric name `OcrScans` — needed to track cost.
- The Lambda execution role's IAM policy must include `rekognition:DetectText` for the
  relevant region. Add to the CDK stack before testing in dev.

#### Automatic mode suggestion

If the scanner is in "Barcode" mode and no EAN-13 is detected for 2.5 continuous seconds, a
`Callout` appears below the viewfinder with title "Can't find a barcode?" and body "This
book may only have a printed ISBN. Try Text mode." The `actions` slot contains a single
`<Button size="sm" variant="secondary">Switch to Text</Button>`.

Acceptance criteria:

- [ ] `Callout` appears after 2.5 s barcode-free scanning (timer resets on each barcode hit).
- [ ] Tapping "Switch to Text" dismisses the callout and switches `SegmentedControl` to
      "Text".
- [ ] Callout auto-dismisses if a barcode is detected after it appears.
- [ ] `Callout` uses `role="note"` and `onDismiss` with an accessible `aria-label` — follows
      the documented `Callout` API exactly.
- [ ] The callout's appearance is tracked via `track("scan_text_mode_suggested")`.

### Nice-to-Have (P1)

**Reticle label**: A small label "Align the ISBN line here" appears inside the wide text
reticle, styled `text-xs text-slate-400` on the forced-dark camera surface. The label fades
(removed from DOM) after the first successful text scan in the current session to reduce
visual noise for experienced users.

**Confidence gate**: Both Tesseract.js and Rekognition `DetectText` return per-character /
per-line confidence scores. If the best ISBN candidate is below 80% confidence the result is
treated as a miss. If two consecutive taps return low-confidence misses, a "Hold steady and
tap again" hint (`text-xs text-slate-400`, not a full `Callout`) appears inside the reticle
for 1.5 s then clears.

**Haptic + visual feedback**: On a successful text-OCR hit, fire the same 40 ms vibration
pulse and green flash banner already used by the barcode success path. No new feedback
patterns.

**Mode memory across sessions**: Persist the last-used scan mode to `localStorage` so users
whose books are primarily pre-2007 don't reset to "Barcode" on every new session. Use the
key `scanner_mode` alongside the existing `scanner_prefs` key.

### Future Considerations (P2)

- **Camera-roll import**: Accept an image from the device photo library and run the same OCR
  pipeline — useful when a user wants to add a book from a photo of its back cover.
- **Spine scan / batch**: Scan a shelf of book spines; requires vertical-text ISBN detection
  and a meaningfully different UX (separate initiative).
- **WAF rate-limiting on `/v1/scan/text`**: This endpoint proxies an external paid API and
  is an amplification target if auth ever lapses. Flag for backlog WAF coverage (per the
  security checklist's "unauthenticated endpoint that proxies an external API" note).

## Design System Mapping

All new UI uses existing tokens and components. No new ad-hoc styles are introduced.

| New element                | Component / token                                             | Notes                                                          |
| -------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Mode toggle                | `SegmentedControl` (existing)                                 | "Barcode" / "Text" options                                     |
| Auto-fallback nudge        | `Callout` (existing, `role="note"`)                           | With dismiss + action button                                   |
| Action button in `Callout` | `<Button size="sm" variant="secondary">`                      |                                                                |
| Text reticle overlay       | New `variant="text"` prop on existing scanner reticle element | Same `border-white/60` ring; different `w-*` / `h-*` / `top-*` |
| Label inside reticle       | `text-xs text-slate-400`                                      | Forced-dark surface; no `dark:` prefix needed                  |
| Confidence hint            | `text-xs text-slate-400` inline inside reticle                | Not a `Callout` — ambient, not actionable                      |
| Success / error feedback   | Existing `ScanModal` flash banner                             | No changes to existing states                                  |

The `ScanModal` forced-dark surface (`bg-black text-white`) already covers all new states.
No new theme work is required.

**ScanModal refactor (in scope for this PR)**: Before adding new view states, extract three
sub-components to keep `ScanModal` maintainable:

- `ScannerViewfinder` — the `<video>` element, reticle overlay, and mode-specific label
- `ScannerModeBar` — the `SegmentedControl` toggle + auto-fallback `Callout`
- `ScannerResultFlow` — the lookup / confirmation / success / error states (already present;
  extraction moves them out of the main render tree)

## Analytics Events

Following ADR-016, add both sides of each new event:

| Event name                 | Trigger                                             |
| -------------------------- | --------------------------------------------------- |
| `scan_text_mode_activated` | User switches `SegmentedControl` to "Text" (manual) |
| `scan_text_mode_suggested` | Auto-fallback `Callout` is shown                    |
| `scan_text_mode_accepted`  | User taps "Switch to Text" in the `Callout`         |
| `scan_text_success`        | OCR returns a valid ISBN-13                         |
| `scan_text_miss`           | OCR returns `isbn13: null`                          |

Add each name to both the client `AnalyticsEvent` union (`apps/web/src/lib/analytics.ts`)
and the server `ALLOWED_EVENTS` allowlist (`apps/api/src/routes/events.ts`).

## Success Metrics

### Leading (evaluate at 2 weeks)

- Text scan mode activated in ≥20% of scanning sessions (discoverability signal).
- OCR tap success rate (valid ISBN returned / taps) ≥60% under typical indoor lighting.
- Median `POST /v1/scan/text` response time ≤1.5 s (CloudWatch p50).
- Rekognition calls per text-scan session ≤1 (server is Tier 3 — only reached when
  `TextDetector` and Tesseract.js both unavailable or miss; expected to be rare on Chrome
  Android which handles Tier 1 natively).

### Lagging (evaluate at 6 weeks)

- Books added per text scan per MAU ≥0.5 (baseline from barcode scan as reference).
- Manual ISBN entry rate drops by ≥15% relative to pre-launch baseline.
- Zero P0 incidents attributable to the new endpoint (auth bypass, runaway Rekognition
  spend, 500-rate spike).

## Decisions (formerly Open Questions)

**Q1 — OCR interaction model**: **Tap-to-scan.** A "Scan" button captures one frame on
demand. This avoids per-second Rekognition charges during alignment and gives the user a
clear action point. Feature is behind `features.ocrScan` env flag. Once user tiers land,
migrate the gate to a per-user entitlement (see TASKS.md "User tiers" backlog item).

**Q2 — Body limit**: **Per-route override required.** The global `bodyLimit` in
`apps/api/src/app.ts` is 64 KB. The `/v1/scan/text` route adds its own `bodyLimit({ maxSize:
500 * 1024 })` before the handler. The global limit is not raised.

**Q3 — ScanModal refactor**: **In scope for this PR.** Extract `ScannerViewfinder`,
`ScannerModeBar`, and `ScannerResultFlow` before adding new view states — see the Design
System Mapping section above.

**Q4 — Auto-fallback Callout timing**: **2.5 seconds.** Short enough to feel responsive
when a barcode isn't found; long enough that users with modern books don't see it fire
before they've finished aiming.

**Q6 — Scan button position**: **Absolute overlay inside ScannerViewfinder.** The Scan
button must overlay the camera feed directly below the reticle box, not appear as a flex
sibling below the viewfinder. Use `position: absolute` derived from the reticle ref bounds
(see `docs/design-handoffs/isbn-text-scan.md`).

**Q7 — Tesseract.js worker teardown**: **Terminate worker on ScannerViewfinder unmount.**
The Tesseract worker is terminated in the `useEffect` cleanup to avoid orphaned WASM threads
when the modal is closed mid-scan.

**Q5 — On-device OCR architecture**: **Three-tier stack mirroring `BarcodeDetector` →
`zxing-wasm`.** `TextDetector` (native, Chrome Android/desktop) → Tesseract.js WASM
(lazy-loaded, iOS + others, character-whitelisted) → `POST /v1/scan/text` (Rekognition,
last resort). Most Android scans are zero-cost; iOS pays a one-time ~5 MB WASM download
then scans free. Server OCR reserved for unsupported browsers or when both client paths
miss.

## QA Checklist

### Feature flag

- [ ] `features.ocrScan: false` (default) — "Text" option absent from SegmentedControl; modal looks identical to pre-feature state
- [ ] `features.ocrScan: true` — "Text" option appears in SegmentedControl
- [ ] `OCR_SCAN_ENABLED` unset / `"false"` — `POST /v1/scan/text` returns 404; no Rekognition call made
- [ ] `OCR_SCAN_ENABLED=true` — endpoint processes normally

### Mode toggle (ScannerModeBar)

- [ ] Default mode on first open is "Barcode"
- [ ] Switching to "Text" updates reticle shape without closing modal
- [ ] Switching back to "Barcode" restores square reticle and scan line
- [ ] Selected mode persists across modal close/reopen within session
- [ ] SegmentedControl is keyboard-navigable (arrow keys between options)
- [ ] Active option announced correctly by VoiceOver / TalkBack

### Text-mode reticle (ScannerViewfinder)

- [ ] Wide horizontal reticle appears in lower third of viewfinder
- [ ] Corner brackets use same `border-white border-[3px]` style as barcode reticle
- [ ] No animated scan line present in text mode
- [ ] "Align the ISBN line here" label visible on first open
- [ ] Label disappears after first successful OCR scan (within session)
- [ ] No `dark:` classes present on any scanner-internal element

### Scan button

- [ ] "Scan" button visible below reticle in text mode only
- [ ] Button is absent in barcode mode
- [ ] Tapping "Scan" disables the button and shows "Scanning…"
- [ ] Tapping "Scan" while in-flight is a no-op
- [ ] On OCR miss: button resets to "Scan"; "Nothing found — try re-aligning" hint appears
- [ ] Hint clears after 2 s
- [ ] On OCR success: existing confirmation/auto-add flow triggers; button disappears
- [ ] `aria-label="Scan for ISBN text"` present on button
- [ ] Button is reachable via Tab; activatable via Space / Enter

### Three-tier OCR stack

- [ ] Tier 1 (`TextDetector`): when available, a valid "ISBN X-XXX-XXXXX-X" pattern on screen is recognised without a server call
- [ ] Tier 1 miss → Tier 2: Tesseract.js is lazy-loaded (not in initial bundle); ISBN extracted from image data
- [ ] Tier 2 miss → Tier 3: frame uploaded to `POST /v1/scan/text`; Rekognition response returns correct ISBN-13
- [ ] All three tiers produce a canonicalised ISBN-13 (via `normalizeIsbn`)
- [ ] ISBN-10 printed text (e.g. "0-553-22759-9") is converted to ISBN-13 (9780553227598)

### Auto-fallback Callout

- [ ] Callout appears after exactly 2.5 s of barcode-free scanning in "Barcode" mode
- [ ] Callout does NOT appear if a barcode is found before 2.5 s
- [ ] "Switch to Text" button changes mode to "Text" and dismisses Callout
- [ ] Dismiss (✕) button closes Callout without changing mode
- [ ] Callout auto-dismisses if a barcode is detected while it is visible
- [ ] Callout has `role="note"` and dismiss button has `aria-label`
- [ ] Dismiss button meets 44×44 px tap target

### API endpoint (`POST /v1/scan/text`)

- [ ] Returns 401 without a valid auth token
- [ ] Returns 404 when `OCR_SCAN_ENABLED !== "true"`
- [ ] Returns 400 for missing `image` field
- [ ] Returns 400 for wrong content-type (not multipart/form-data)
- [ ] Returns 413 for payload > 500 KB (per-route bodyLimit)
- [ ] Returns 200 `{ isbn13: "978..." }` for a recognisable ISBN image
- [ ] Returns 200 `{ isbn13: null }` for an image with no detectable ISBN
- [ ] Returns 502 (not 500, no stack trace) on Rekognition failure
- [ ] Rekognition call counted in CloudWatch under metric `OcrScans`
- [ ] Global 64 KB bodyLimit is NOT raised; per-route override confirmed

### ScanModal refactor

- [ ] Existing barcode scan flow unchanged after sub-component extraction
- [ ] Existing manual-entry flow unchanged
- [ ] Existing continuous-scan mode unchanged
- [ ] Existing post-scan-behavior preference (confirm / auto-add) unchanged
- [ ] Focus trap still works (Tab cycles within modal; Escape closes)

### Analytics events

- [ ] `scan_text_mode_activated` fires when user manually switches to Text
- [ ] `scan_text_mode_suggested` fires when auto-fallback Callout appears
- [ ] `scan_text_mode_accepted` fires when user taps "Switch to Text" in Callout
- [ ] `scan_text_success` fires on successful OCR result
- [ ] `scan_text_miss` fires on null OCR result
- [ ] All five events are in client `AnalyticsEvent` union AND server `ALLOWED_EVENTS`

### Accessibility

- [ ] Focus order (text mode): Close → SegmentedControl → Scan button → footer controls
- [ ] Focus order with Callout visible: …→ Scan button → Callout dismiss → "Switch to Text" → footer
- [ ] "Nothing found" hint region has `aria-live="polite"`
- [ ] Reticle hint label has `aria-hidden="true"`

### Dark mode / theming

- [ ] No scanner-internal element changes appearance when system theme switches
- [ ] `Callout` inside `ScannerModeBar` uses correct dark Callout tokens (`dark:bg-slate-800/50` etc.) — Callout sits outside the pure-black camera surface

### CDK / infrastructure

- [ ] `ocrScan: false` in `config.json` output by default in dev + prod stacks
- [ ] `OCR_SCAN_ENABLED=false` on Lambda by default
- [ ] Lambda execution role includes `rekognition:DetectText` permission
- [ ] Toggling flag in CDK and redeploying (no code change) enables / disables the feature

---

## Timeline Considerations

- No hard deadline — this is quality-of-life for collectors.
- **Dependency (blocking)**: The Lambda execution role's IAM policy must include
  `rekognition:DetectText` before the endpoint can be tested in dev. Add to CDK before
  starting implementation.
- **Suggested phasing**:
  - Phase 1: Server endpoint + basic text mode (P0 items). Single PR.
  - Phase 2: Auto-fallback `Callout` + P1 polish (reticle label, confidence gate, haptics,
    mode memory). Ships independently as a fast-follow PR once Phase 1 is in dev.
