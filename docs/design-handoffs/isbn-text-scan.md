# Handoff Spec: ISBN Text Scan

**Feature:** OCR-based scanning of printed ISBN text for pre-2007 paperbacks  
**Surface:** `ScanModal` — forced-dark full-screen camera overlay  
**Spec:** `docs/specs/isbn-text-scan.md`  
**Design system ref:** `docs/design-system.md` → Scanner Components section

---

## Overview

Users with older paperbacks (pre-2007) cannot scan their books because those books carry
publisher UPC codes rather than ISBN-13 barcodes. The ISBN appears only as printed text on
the back cover (e.g. "ISBN 0-553-22759-9"). This feature adds a "Text" scan mode that lets
users tap once to OCR-capture the printed ISBN line.

The camera scanner is mobile-only (`supportsCameraScan()` guards the UI). The entire
feature lives on a forced-dark `bg-black` surface — no light-mode variants are needed or
correct inside the scanner.

---

## Layout

The scanner modal is full-screen (`fixed inset-0`). Vertical layout top-to-bottom:

```
┌──────────────────────────────────┐
│         ScannerViewfinder        │  flex-1 (fills remaining height)
│   ┌──────────────────────────┐   │
│   │  <video> — full fill     │   │
│   │                          │   │
│   │   [ Text reticle box ]   │   │
│   │   lower third, wide      │   │
│   │                          │   │
│   │   [ Scan button ]        │   │
│   │   below reticle          │   │
│   └──────────────────────────┘   │
├──────────────────────────────────┤
│         ScannerModeBar           │  height auto
│   ┌──────────────────────────┐   │
│   │   SegmentedControl       │   │
│   │   Barcode  │  Text       │   │
│   │                          │   │
│   │   [Callout — conditional]│   │
│   └──────────────────────────┘   │
├──────────────────────────────────┤
│     footer (existing)            │  border-t border-white/10 bg-slate-950/90 px-4 py-3
└──────────────────────────────────┘
```

The `ScannerModeBar` is only rendered when `features.ocrScan && supportsCameraScan()`. When
the feature flag is off, the existing barcode-only layout is unchanged.

---

## Design Tokens Used

| Token                | Tailwind class      | Value               | Usage                            |
| -------------------- | ------------------- | ------------------- | -------------------------------- |
| Black surface        | `bg-black`          | #000000             | Modal backdrop / viewfinder bg   |
| Dark footer          | `bg-slate-950/90`   | slate-950 @ 90%     | Modal footer + mode bar bg       |
| Reticle bracket      | `border-white`      | #ffffff             | Corner bracket strokes           |
| Reticle dim surround | `box-shadow` inline | `rgba(2,6,23,0.55)` | Darkened area outside reticle    |
| Instructional text   | `text-slate-200`    | slate-200           | "Align the ISBN line here" label |
| Hint / muted text    | `text-slate-400`    | slate-400           | Inline hints inside reticle      |
| Success accent       | `text-emerald-400`  | emerald-400         | Scan hit feedback (existing)     |
| Footer divider       | `border-white/10`   | white @ 10%         | Footer top border                |
| Result card bg       | `bg-slate-900`      | slate-900           | Confirmation/result card         |

All scanner-internal classes are **unconditionally dark** — no `dark:` prefixes inside scanner components.

---

## Components

### ScannerModeBar

| Element        | Component          | Variant / Props                                                            | Notes                                |
| -------------- | ------------------ | -------------------------------------------------------------------------- | ------------------------------------ |
| Mode toggle    | `SegmentedControl` | options: `[{value:"barcode",label:"Barcode"},{value:"text",label:"Text"}]` | Existing component; no changes to it |
| Fallback nudge | `Callout`          | `role="note"`, `onDismiss`, `dismissLabel`                                 | Conditional — appears after 2.5 s    |
| Nudge action   | `Button`           | `size="sm" variant="secondary"` label "Switch to Text"                     | Inside Callout `actions` slot        |

The `ScannerModeBar` sits in a `px-4 py-3` container matching the footer padding. It does
not have a visible border-top unless the Callout is showing (its `rounded-2xl` provides
separation from the viewfinder above it).

### ScannerViewfinder

| Element     | Component                | Notes                                                               |
| ----------- | ------------------------ | ------------------------------------------------------------------- |
| Video       | `<video>`                | `w-full h-full object-cover`                                        |
| Reticle     | `ScannerReticle`         | `variant` prop: `"barcode"` or `"text"`                             |
| Scan button | `<Button variant="app">` | Text mode only; absolutely positioned below the reticle box         |
| Inline hint | `<p>`                    | `text-xs text-slate-400`; text mode only; fades after first success |

### ScannerReticle — text variant

| Property        | Value                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| Width           | `min(70vw, 320px)` — 70% of screen width, capped at 320 px                        |
| Height          | `18vh` — 18% of viewport height                                                   |
| Position        | Vertically: centered in lower third (`top: 55%` of viewfinder)                    |
| Corner brackets | `w-6 h-6 border-white border-[3px]`, `rounded-*-2xl` (same as barcode)            |
| Surround dim    | `box-shadow: 0 0 0 2000px rgba(2,6,23,0.55)` on inner box                         |
| Scan line       | **None** (barcode variant only)                                                   |
| Inline hint     | `text-xs text-slate-400` centred inside box; removed from DOM after first success |

---

## States and Interactions

### Mode toggle

| State                        | Behaviour                                                           |
| ---------------------------- | ------------------------------------------------------------------- |
| "Barcode" selected (default) | Barcode reticle shown; scan line animates; no Scan button           |
| "Text" selected              | Text reticle shown; Scan button visible below reticle; no scan line |
| Switching modes              | Reticle updates immediately; timer for fallback Callout resets      |

### Scan button (text mode)

| State     | Label          | Appearance                                  | Interaction                                             |
| --------- | -------------- | ------------------------------------------- | ------------------------------------------------------- |
| Ready     | "Scan"         | `variant="app"` normal                      | Tap captures frame, starts OCR                          |
| In-flight | "Scanning…"    | `loading={true}` (disabled)                 | Taps are no-ops                                         |
| Miss      | "Scan" (reset) | Normal                                      | Inline hint "Nothing found — try re-aligning" shown 2 s |
| Success   | —              | Button disappears as result flow takes over | `onScan(isbn13)` fires                                  |

### Auto-fallback Callout

| State                     | Trigger                                                   | Behaviour                                            |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| Hidden                    | Default                                                   | Not rendered                                         |
| Visible                   | 2.5 s passes with no barcode detected (barcode mode only) | Callout mounts with `role="note"`                    |
| Dismissed (user)          | Tap ✕ or "Switch to Text"                                 | Callout unmounts; if "Switch to Text" → mode changes |
| Dismissed (barcode found) | EAN-13 decoded while Callout is visible                   | Callout unmounts automatically                       |

### Inline hint ("Nothing found — try re-aligning")

- Appears immediately after an OCR miss
- `text-xs text-slate-400` below the Scan button
- Auto-clears after 2 000 ms (use a `setTimeout` cleared on unmount)
- Does **not** appear on a success or while a request is in-flight

---

## Animation / Motion

| Element                        | Trigger                    | Animation                      | Duration | Notes                                         |
| ------------------------------ | -------------------------- | ------------------------------ | -------- | --------------------------------------------- |
| Callout mount                  | 2.5 s timer fires          | Fade-in (`transition-opacity`) | 150 ms   | Match existing `transition-colors` duration   |
| Callout unmount                | Dismissed or barcode found | Fade-out                       | 150 ms   |                                               |
| Inline hint clear              | 2 s timer                  | Fade-out                       | 150 ms   |                                               |
| Inline hint "Align" label fade | First OCR success          | Fade-out, remove from DOM      | 300 ms   | One-time per session                          |
| Scan button label swap         | In-flight state change     | Instant (no transition)        | —        | Loading state handled by `<Button loading>`   |
| Reticle shape switch           | Mode toggle                | Instant                        | —        | No crossfade — position/size jump is expected |

Do not add new Tailwind animation classes. Use `transition-opacity duration-150` for fades.

---

## Content Specifications

| Element                   | Text                                                     | Max length | Truncation               |
| ------------------------- | -------------------------------------------------------- | ---------- | ------------------------ |
| SegmentedControl option 1 | "Barcode"                                                | —          | Never truncates          |
| SegmentedControl option 2 | "Text"                                                   | —          | Never truncates          |
| Scan button (ready)       | "Scan"                                                   | —          | —                        |
| Scan button (in-flight)   | "Scanning…"                                              | —          | —                        |
| Reticle label             | "Align the ISBN line here"                               | —          | Single line; never wraps |
| Miss hint                 | "Nothing found — try re-aligning"                        | —          | Single line              |
| Callout title             | "Can't find a barcode?"                                  | —          | Single line              |
| Callout body              | "This book may only have a printed ISBN. Try Text mode." | —          | Wraps naturally          |
| Callout action            | "Switch to Text"                                         | —          | Single line              |

---

## Edge Cases

- **iOS Safari + TextDetector unavailable**: OCR falls through to Tesseract.js WASM
  (~5 MB, lazy-loaded on first text scan). The Scan button stays in loading state until the
  WASM finishes loading (~1–3 s on first use). No special UI needed — the existing loading
  state covers it. If Tesseract.js also fails, the server fallback runs; same loading state.
- **All OCR tiers return null three times consecutively**: Show the "Nothing found"
  hint each time. No escalation UI — user can switch to manual entry via the existing
  "Enter ISBN manually" link in the footer.
- **Feature flag off (`features.ocrScan: false`)**: `ScannerModeBar` is not rendered.
  The modal looks and behaves identically to the pre-feature state.
- **Barcode detected while in text mode**: Should be ignored — the barcode decode loop is
  paused in text mode. Do not show a barcode success from text mode.
- **Very short back covers (small paperbacks)**: The text reticle is position-percentage-
  based, so it scales with viewport. No special handling needed.
- **Landscape orientation**: The lower-third position may land differently. Acceptable for
  v1 — do not add landscape-specific layout.

---

## Accessibility

### Focus order (text mode, modal open)

1. Close button (top-right, existing)
2. SegmentedControl — "Barcode" option (first radio)
3. SegmentedControl — "Text" option (second radio)
4. "Scan" button (below viewfinder)
5. If Callout is visible: dismiss button (✕), then "Switch to Text" button
6. Footer controls (existing — manual entry link, preferences)

### ARIA

| Element               | Role / ARIA                                         | Notes                                               |
| --------------------- | --------------------------------------------------- | --------------------------------------------------- |
| SegmentedControl      | `role="radiogroup"` with `role="radio"` options     | Existing component handles this                     |
| Callout               | `role="note"`                                       | Per design system spec                              |
| Callout dismiss       | `aria-label="Dismiss scan tip"`                     | 44×44 px tap target                                 |
| Scan button           | `aria-label="Scan for ISBN text"`                   | Clarifies purpose beyond "Scan" label alone         |
| Scan button (loading) | `aria-disabled="true"`                              | `<Button loading>` sets this                        |
| Inline hint           | `aria-live="polite"` region wrapping hint paragraph | Announces to screen reader when hint appears/clears |
| Reticle hint label    | `aria-hidden="true"`                                | Decorative positioning guide; not navigable         |

### Keyboard

The scanner is a focus-trapped modal (existing behaviour). In text mode:

- `Tab` cycles through close → SegmentedControl → Scan button → footer controls
- `Space` / `Enter` on Scan button triggers OCR (same as tap)
- `Escape` closes modal (existing)
- Arrow keys navigate `SegmentedControl` options (existing component behaviour)

---

## Implementation Notes

1. **Scan button position**: Use `position: absolute` inside `ScannerViewfinder`, not a
   flexbox sibling. The button must overlay the camera feed directly below the reticle box.
   Approximate: `top: calc(55% + 18vh/2 + 12px)` or derive from reticle ref bounds.
2. **Reticle lower-third placement**: The barcode `Reticle` uses `items-center
justify-center` (dead center). The text reticle should use `items-end justify-center` with
   `pb-[20%]` or an explicit `top` offset — keeps the reticle in the lower third where the
   ISBN line actually appears on a held book.
3. **Timer cleanup**: Both the 2.5 s fallback-Callout timer and the 2 s hint-clear timer
   must be cleaned up with `clearTimeout` in `useEffect` return. Missing cleanup causes
   state updates on unmounted components.
4. **Tesseract.js worker teardown**: The Tesseract worker should be terminated when
   `ScannerViewfinder` unmounts to avoid orphaned WASM threads.
5. **No `dark:` prefixes inside scanner**: The checklist item in `docs/design-system.md`
   covers this — enforce in code review.
