# Spec: Release & Polish Batch

**Status:** Draft
**Date:** 2026-06-13
**Author:** Kevin Rich
**Related:** `docs/specs/release-polish-batch-handoff.md` (dev handoff for #2 + #5), `docs/specs/isbn-scanning.md`, `docs/specs/visual-polish.md`, `docs/specs/prod-deployment-domain.md`, ADR-014

---

## Problem Statement

The scanner feature is built and shipping dark in dev; several small UX rough edges remain
before the app feels production-ready. This spec batches five discrete, independent issues:
releasing the scanner to prod, three visual/navigation polish items, and one scanner-capability
gap. None is large; each is individually shippable. They are grouped because they target the
same milestone — a credible public release — and because three of them (cover fill, logged-in
redirect, mobile sizing) want a **design pass before implementation**.

> **Design handoff:** Items **#2 (cover fill)** and **#5 (mobile sizing)** are design-led and
> should go through `/design-handoff` before any code is written. Item **#3 (redirect)** is
> trivial but touches first-impression flow, so include it in the handoff for sign-off.
> Items **#1 (scanner release)** and **#4 (ISBN-10)** are engineering-only and need no design.
> **#2 applies to the landing page too** — the marketing/demo covers (`DemoShelf`) are in scope
> alongside the shelf.

---

## Scope at a glance

| #   | Issue                             | Type              | Design needed? | Rough size |
| --- | --------------------------------- | ----------------- | -------------- | ---------- |
| 1   | Release scanner to production     | Config / deploy   | No             | XS         |
| 2   | Remove cover background fill      | Visual            | **Yes**        | S          |
| 3   | Redirect logged-in users to shelf | Navigation        | Sign-off only  | XS         |
| 4   | Scan ISBN-10 as well as ISBN-13   | Engineering       | No             | S–M        |
| 5   | Fix mobile sizing (Pixel 7 Pro)   | Responsive layout | **Yes**        | M          |

---

## Goals

1. Scanner is live for all prod users on touch devices with a camera.
2. Book covers read as clean, edge-to-edge artwork — no awkward letterbox band, especially under hover.
3. A returning, logged-in user lands on their shelf, not the marketing page.
4. A user can scan any book in their physical collection, including older ISBN-10-era titles.
5. The app looks intentional and uncramped on a ~412px-wide phone (Pixel 7 Pro), not just on desktop.

## Non-Goals

- **No backend, CDK resource, or DynamoDB schema changes** beyond flipping the existing scanner flag (#1).
- **No redesign of the shelf or landing page** — #2 and #5 are corrective polish within the current visual language (Slate Blue theme), not a rework.
- **No desktop webcam scanning** — scanner entry stays gated to touch + camera (unchanged from `isbn-scanning.md`).
- **No new cover-art sourcing or image pipeline** — #2 is purely how existing covers are framed.
- **No bottom-nav / hamburger mobile nav rebuild** in #5 unless the design handoff explicitly calls for it; default is to fix spacing and type scale, not restructure navigation.
- **No change to how the metadata cache is keyed** — #4 normalizes input to ISBN-13 _before_ the existing lookup; the `BOOK#${isbn}` key contract is untouched.

---

## Work Items

### #1 — Release scanner to production

**Current state.** The scanner ships dark in prod. The gate is a runtime flag `features.scanner`,
read from `/config.json` (falling back to `VITE_FEATURE_SCANNER` locally) in
[runtime-config.ts](apps/web/src/lib/runtime-config.ts). The UI entry point is gated by
`getRuntimeConfig().features.scanner && supportsCameraScan()` in
[ShelfPage.tsx:260](apps/web/src/pages/ShelfPage.tsx). The CDK value is set per-env in
[bookshelf.ts](packages/infra/bin/bookshelf.ts): dev `scannerEnabled: true`, prod `scannerEnabled: false`.

**Change.** Flip prod to `scannerEnabled: true` and deploy to prod.

**Requirements**

- **P0** — Prod `config.json` reports `features.scanner: true` after deploy.
- **P0** — On a real phone against prod, the Scan button appears on the shelf and a scan adds a book end-to-end.
- **P0** — Desktop prod still hides the Scan button (`supportsCameraScan()` gate unchanged).

**Acceptance criteria**

- [ ] `scannerEnabled: true` for the prod env in `packages/infra/bin/bookshelf.ts`.
- [ ] Promote/deploy run to prod completed; prod `/config.json` shows `features.scanner: true`.
- [ ] Given a logged-in user on a prod-served phone, When they open their shelf, Then the Scan button is visible and functional.
- [ ] Given a desktop browser on prod, When they open their shelf, Then no Scan button is shown.

**Dependencies / risk**

- On-device verification was completed against the **dev site** (scanning confirmed working). No remaining blocker — this item is ready to ship. Back-fill the unchecked verification boxes in `isbn-scanning.md` to reflect that.

---

### #2 — Remove cover background fill (design-led)

**Current state.** Covers render with `object-contain` over a `bg-slate-100 dark:bg-slate-700`
fill ([BookCover.tsx:36](apps/web/src/components/BookCover.tsx)). Covers whose aspect ratio
doesn't match the card box show that slate band as a letterbox. Under the hover treatment
(`group-hover/card:shadow-xl` plus the dark gradient overlay in
[ShelfBookCard.tsx:282,301](apps/web/src/components/shelf/ShelfBookCard.tsx)) the band reads as
an awkward frame around the art.

**Scope.** Both the **shelf** (`BookCover` / `ShelfBookCard`) **and the landing page** demo grid
(`DemoShelf`, [DemoShelf.tsx](apps/web/src/components/demo/DemoShelf.tsx)) — wherever a cover can
letterbox.

**Intent.** Covers should sit on the page with no background band, and the hover state should
highlight the artwork, not a letterbox.

**Resolved framing.** Covers are normalized to a **consistent height**; the **image width is
variable** (it follows the cover's natural aspect ratio at that height). On the landing page the
**grid cell stays a fixed width** so columns still align — the variable-width image is **centered
within the fixed cell**, with the surrounding space left as page background (no slate fill). On the
shelf's horizontal row, cards likewise size to the image's natural width at the shared height.

**Settled details:**

- No `object-contain` letterbox and no `bg-slate-*` behind a _loaded_ image — the image is its own width.
- The **fallback placeholder** (no/failed image) keeps its background + broken-image fallback (per code-review checklist) — only loaded images change.
- Re-confirm the hover shadow/gradient reads well once the band is gone (no double-frame effect).

**Requirements**

- **P0** — A loaded cover shows **no** slate background band, on both the shelf and the landing demo grid.
- **P0** — Covers are normalized to a consistent height with the image at its natural (variable) width.
- **P0** — On the landing grid, the cell stays a fixed width and the variable-width image is centered within it (columns stay aligned).
- **P0** — The fallback placeholder (missing/broken image) is unchanged and still has its background + broken-image fallback (per code-review checklist).
- **P1** — Hover/focus treatment still reads cleanly with the band gone (no double-frame effect).

**Acceptance criteria**

- [ ] Given any loaded cover, When the shelf or landing grid renders it, Then no slate fill is visible around it.
- [ ] Covers within a row/grid share a consistent height; image widths vary by aspect ratio.
- [ ] Given the landing grid, When covers of different widths render, Then cells stay equal width and images are centered within them (no column misalignment).
- [ ] Given a book with no cover, When it renders, Then the existing fallback placeholder (with background) is shown unchanged.
- [ ] Hover and keyboard-focus states verified in both light and dark mode with the new framing.
- [ ] No layout shift introduced (wrapper keeps `overflow-hidden`).

---

### #3 — Redirect logged-in users to their shelf

**Current state.** `/` always renders `<LandingPage />` ([App.tsx:27](apps/web/src/App.tsx)) with
no auth check. A logged-in user returning to the root sees the marketing/sign-up page. The inverse
pattern already exists: `AuthRoute` redirects authenticated users away from login/signup to `/shelf`
([AuthRoute.tsx:6](apps/web/src/components/AuthRoute.tsx)), and auth state is available via
`useAuth()` ([AuthContext.tsx](apps/web/src/context/AuthContext.tsx)) with a `loading` flag.

**Change.** When an authenticated user hits `/`, redirect to `/shelf`. Unauthenticated users still
see the landing page.

**Requirements**

- **P0** — Authenticated user navigating to `/` is redirected to `/shelf`.
- **P0** — Unauthenticated user navigating to `/` sees the landing page (unchanged).
- **P0** — While auth state is resolving (`loading`), no landing-page flash before redirect — match `AuthRoute`/`ProtectedRoute` loading handling.

**Acceptance criteria**

- [ ] Given a logged-in user, When they visit `/`, Then they are sent to `/shelf` (use `<Navigate replace>` so back-button doesn't bounce).
- [ ] Given a logged-out user, When they visit `/`, Then the landing page renders.
- [ ] Given auth is still loading, When `/` mounts, Then no marketing content flashes before the redirect resolves.

**Resolved:** A logged-in user is **always** redirected from `/` to their shelf — `/` is not a
destination they see while authenticated.

---

### #4 — Scan ISBN-10 as well as ISBN-13

**Important technical context.** A book's back-cover barcode is an **EAN-13**, which _is_ the
ISBN-13 (978/979-prefixed) — including for books marketed with a 10-digit ISBN. So most
"ISBN-10-era" books **already scan today**: the barcode yields a valid ISBN-13. The decoder
requests only `ean_13` ([scanner.ts:50,93](apps/web/src/lib/barcode/scanner.ts)), and
`isValidIsbn`/the manual-entry path already accept 10-digit ISBNs
([isbn.ts:2](apps/web/src/lib/isbn.ts)).

**Worked example (from the attached photo).** "The Right Stuff" is printed with ISBN-10
`0-553-38135-0`, but its back-cover barcode is the **EAN-13 `9 780553 381351`** (= the ISBN-13
`9780553381351`). So this book — and most "ISBN-10-era" trade books — **already scans today** and
resolves correctly. The capability gap is therefore two-fold:

1. **Symbology coverage** for books whose only machine-readable code is a **UPC-A or UPC-E** (older
   US printings) rather than a Bookland EAN-13.
2. **10-digit normalization**, so any ISBN-10 that enters the pipeline (manual entry, or a decode
   that yields a 10-digit value) is converted to ISBN-13 before the ISBN-keyed lookup, preventing
   duplicate shelf entries for the same book under two ISBN forms.

**Change.**

1. Add an **ISBN-10 → ISBN-13 normalization** helper (drop the ISBN-10 check digit, prepend `978`,
   recompute the EAN-13 check digit) in `lib/isbn.ts`, and apply it so any 10-digit input — scanned
   or typed — is converted to ISBN-13 before `GET /v1/books/isbn/:isbn`.
2. Extend the decoder format list to also decode **UPC-A and UPC-E** (confirmed in scope), in
   addition to the existing EAN-13, in both the native `BarcodeDetector` and zxing-wasm paths
   ([scanner.ts:50,93](apps/web/src/lib/barcode/scanner.ts)). Validate every decode with
   `isValidIsbn` (after normalization) and discard anything that doesn't checksum.

**Requirements**

- **P0** — A book whose barcode is a standard EAN-13 (the common case, incl. the example) continues to scan unchanged.
- **P0** — A 10-digit ISBN entered manually or otherwise reaching the pipeline is normalized to a valid ISBN-13 before lookup (no duplicate shelf entries for the same book under two ISBN forms).
- **P0** — The decoder accepts **UPC-A and UPC-E** in addition to EAN-13.
- **P0** — Any misread or non-ISBN barcode is still rejected by the `isValidIsbn` checksum gate before any API call (no quota waste / no garbage writes — per the endpoint checklist).

**Acceptance criteria**

- [ ] `lib/isbn.ts` exposes an `isbn10to13` (or equivalent) helper with correct check-digit recomputation, unit-tested against known pairs (e.g. `0553381350` → `9780553381351`, `0306406152` → `9780306406157`).
- [ ] Manual entry of a valid ISBN-10 resolves to the same shelf entry as scanning that book's EAN-13 (dedup holds).
- [ ] Decoder decodes UPC-A and UPC-E (native + wasm paths); every decode is checksum-validated after normalization before lookup.
- [ ] An invalid/misread barcode produces no API call.

---

### #5 — Fix mobile sizing (Pixel 7 Pro, ~412px) (design-led)

**Confirmed offenders (from the Pixel 7 Pro screenshot of the shelf):**

1. **Header nav overflows.** With the wordmark plus `Wishlist · About · Account · Sign out` inline
   on one row at `px-6` ([AppHeader.tsx:23](apps/web/src/components/AppHeader.tsx)), **"Sign out"
   wraps to two lines** and the header feels crammed against both edges. This is the single most
   obvious break.
2. **Book cards bleed off the right edge.** The horizontal shelf row ends with a card clipped at the
   screen edge with no gutter/peek treatment — it reads as broken rather than as "scroll for more."
3. **Tight, uniform gutters.** `px-6` everywhere ([ShelfPage.tsx:384](apps/web/src/pages/ShelfPage.tsx))
   pinches content against the frame at 412px.
4. **Dead vertical space.** A single short shelf leaves a large empty area below; not broken, but it
   amplifies the cramped-at-top / empty-below imbalance.
5. **Landing page** uses a large `text-4xl` hero + `text-lg` body at `px-6 py-16`
   ([LandingPage.tsx:10](apps/web/src/pages/LandingPage.tsx)) with no mobile step-down — include in
   the handoff even though the screenshot is of the shelf.

For reference, the demo grid _is_ already responsive (`grid-cols-2 sm:grid-cols-3 md:grid-cols-5`,
[DemoShelf.tsx:131](apps/web/src/components/demo/DemoShelf.tsx)) — a good pattern to mirror.

**Resolved direction:**

- **Header → menu icon (Option A).** On small screens, collapse the nav links
  (`Wishlist · About · Account · Sign out`) behind a single menu (`☰`) button next to the wordmark;
  the links live in a tap-to-open menu. Chosen because it's the standard mobile pattern and won't
  break again as nav items are added. Full inline nav stays at the larger breakpoint (≥ `sm`).
- **Book row → peek + gutter (Option B).** Add a trailing gutter and let the next card peek in at the
  right edge so the row reads as scrollable rather than clipped. The horizontal scroll itself stays.

This is still design-led for the menu's open/close treatment and the landing type scale; the two
structural choices above are locked.

**Requirements**

- **P0** — At < `sm`, `AppHeader` collapses nav links behind a menu (`☰`) button; **no nav item wraps**. Full inline nav returns at ≥ `sm`.
- **P0** — The menu is accessible: `aria-expanded`/`aria-controls` on the toggle, focus management on open/close, Escape closes, keyboard operable.
- **P0** — The shelf's horizontal card row uses a peek + trailing gutter at 412px so the last card isn't clipped flush. (The horizontal scroll itself stays.)
- **P0** — No page-level horizontal scroll on a 412px viewport (per-section horizontal scroll exempt).
- **P0** — Gutters/padding tuned for narrow screens (e.g. `px-4 sm:px-6`) so content isn't pinched.
- **P1** — Landing hero/heading type steps down at the base breakpoint so it doesn't feel oversized (e.g. `text-2xl sm:text-4xl`-style scale, per design).
- **P0** — Touch targets remain ≥ the accessibility minimum; no hover-only affordances (per code-review checklist).

**Acceptance criteria**

- [ ] At 412px, the header shows wordmark + menu button on one row with no nav item wrapping; opening the menu reveals all four links.
- [ ] Menu toggle is keyboard-operable with correct `aria-expanded`/`aria-controls`; Escape closes; focus is handled.
- [ ] At ≥ `sm`, the full inline nav renders as before (no menu button).
- [ ] At 412px, the shelf card row shows a peek of the next card + trailing gutter; the last card is not clipped flush against the screen edge.
- [ ] At 412×915, landing and shelf render with no page-level horizontal scrollbar.
- [ ] Landing hero/headings do not feel oversized/cramped at 412px.
- [ ] Verified at 412px in both light and dark mode.

---

## Success Metrics

**Leading (within ~2 weeks):**

- Scanner used at least once in prod (qualitative — solo product).
- No new WCAG AA regressions; Lighthouse mobile score not reduced.
- No page-level horizontal scroll on a 412px device across landing + shelf.

**Lagging:**

- Returning-user friction reduced (logged-in users reach their shelf in one hop).
- Physical-shelf cataloguing feels viable on a phone (scanner + ISBN-10 coverage).

---

## Open Questions

None outstanding — all resolved:

- **#1** — Scanning verified on the dev site; ready to flip the prod flag.
- **#2** — Consistent height, variable-width image; landing grid cell stays fixed width with the image centered inside.
- **#3** — Logged-in users are always redirected from `/` to their shelf.
- **#4** — Add UPC-A/UPC-E decode support + ISBN-10→13 normalization; the EAN-13 common case is unchanged.
- **#5** — Header collapses to a menu (`☰`) button below `sm`; book row uses peek + trailing gutter.

Remaining design latitude (non-blocking, for the handoff): the menu open/close treatment and the
landing-page mobile type scale.

---

## Timeline / Sequencing

No hard deadline. Suggested order:

1. **#1 scanner release** and **#3 redirect** — independent, shippable immediately (#1 verified on dev; just flip the prod flag + deploy).
2. **#4 ISBN-10** — independent engineering task; ready to start (UPC-A/UPC-E + ISBN-10→13 normalization).
3. **`/design-handoff`** covering **#2 cover fill** and **#5 mobile sizing** (plus #3 sign-off) — ready to run; screenshot received.
4. **#2 + #5** implementation after handoff; can share one PR (both presentational/responsive).

Each item is small enough to be its own PR; #2 and #5 may bundle. All follow the standard
pre-merge gate (`pnpm version:bump` → `pnpm preflight` → `/pr-review-toolkit:review-pr all` →
qa-checklist) per `docs/runbooks/pr-workflow.md`.
