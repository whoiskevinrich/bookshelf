# ADR-014: Mobile Camera ISBN Barcode Scanning

**Status**: Accepted
**Date**: 2026-06-13

## Context

We want phone users to add books by scanning the back-cover barcode (an EAN-13,
which is the ISBN-13). The constraints that shape the design:

- **iPhone is Safari**, and Safari has never shipped the native `BarcodeDetector`
  API. A native-only approach would silently fail for all iOS users — the largest
  slice of the "mobile" audience.
- `getUserMedia` needs a **secure context**. Production is HTTPS via CloudFront;
  `localhost` is exempt for dev. No new infra is required for that.
- The project is cost- and bundle-conscious (ADR-001). A decoder large enough to
  cover Safari should not be paid for by users who never scan.
- We want to ship the code to `main`/prod without exposing it until it's been
  verified on a real phone (decode quality can't be unit-tested headlessly).

## Decision

**1. Hybrid decoder, lazily loaded.** Use the OS-native `BarcodeDetector` when it
supports EAN-13 (Android Chrome); otherwise fall back to a dynamically-imported
`zxing-wasm` decoder (covers iOS Safari). The fallback's WASM (~450 KB gzipped) is
only fetched the first time it's needed. Encapsulated behind a small
`BarcodeScanner` interface in `apps/web/src/lib/barcode/scanner.ts`.

**2. Self-host the WASM.** `zxing-wasm` defaults to fetching its binary from a CDN
at runtime. We override `locateFile` to point at a Vite-bundled, fingerprinted
asset served from our own origin — no third-party runtime dependency, no CSP
allowance, consistent with the self-hosting posture elsewhere.

**3. Ship dark behind a runtime feature flag.** Extend the deploy-time
`config.json` (ADR-011) with a `features.scanner` boolean, wired per-environment
through `EnvConfig` → `WebStack` → `runtime-config.ts`. **dev = true** (so the
feature can be verified on the dev CloudFront URL from a real phone), **prod =
false** until verified — then a one-line flip + redeploy releases it. Absent →
false, so an older `config.json` reads as disabled.

**4. Always-dark scanner surface.** The `ScanModal` renders on a fixed dark surface
regardless of the app theme (camera-UI convention: maximum contrast against an
unpredictable video feed). It wraps its content in a `.dark` context so the
design-system `Button`, `inputClass`, and `BookCover` render correctly without
inlining button/colour classes.

**5. Client-only preferences.** Post-scan behavior and scan mode persist to
localStorage via `ScannerPreferencesContext` (mirrors `ThemeContext`). No user
settings API exists, and adding one is out of scope.

## Consequences

- **Every phone gets the best available decoder**: Android uses the free native
  path; iPhone falls back to WASM. Non-scanner users pay nothing (lazy import).
- **No backend, CDK resource, or DynamoDB change** — the scanner produces a
  validated ISBN and reuses the existing book-lookup and add-to-shelf endpoints.
- **One new dependency** (`zxing-wasm`) and a self-hosted asset; the initial JS
  bundle is unchanged.
- **Release is decoupled from merge.** Code can sit on `main`/prod hidden; the
  device-gated entry point further limits blast radius. Instant rollback via the
  existing versioned-prefix mechanism remains the primary safety net (ADR-007).
- The always-dark surface is a deliberate, isolated departure from the app's
  themed UI — internally consistent, but a visible mode switch when opened from
  light mode (follow-up: fade-in).

## Alternatives considered

- **Native `BarcodeDetector` only** — zero bytes, but unsupported on iOS Safari →
  disqualifying for a mobile feature.
- **`html5-qrcode`** — bundles its own camera UI that wouldn't match the design
  system or dark mode, and is larger; rejected in favour of a custom UI over a lean
  decoder.
- **Pure JS ZXing port (`@zxing/library`)** — works on iOS but is slower and less
  accurate than the WASM build for EAN-13.
- **No feature flag, rely on rollback** — viable given instant prefix rollback, but
  the flag lets us expose the feature only after on-device verification, which CI
  cannot perform.
