# Spec: Mobile Camera ISBN Barcode Scanning

**Status**: Implemented (ships dark in prod, pending on-device verification)
**Date**: 2026-06-13
**Related**: ADR-014 (decoder + ship-dark flag), `docs/specs/core-shelf.md`

## Problem

Adding books one ISBN at a time by typing is tedious, especially when cataloguing
a physical shelf. On a phone, the back-cover barcode _is_ the ISBN — pointing the
camera at it should add the book in one motion.

## Goals

- Let a user on a phone scan a book's EAN-13 barcode with the rear camera and add
  it to their shelf.
- Work on real phones **including iPhone/Safari**, which has no `BarcodeDetector`.
- Reuse the existing add-book pipeline (`GET /v1/books/isbn/:isbn`, `POST /v1/shelf`)
  with **no backend changes**.
- Cost nothing for users who never scan (lazy-load the decoder).

## Non-goals

- Desktop webcam scanning (entry point is gated to touch + camera devices).
- Scanning anything other than book barcodes (EAN-13 only).
- Server-side persistence of scanner preferences (client-only for now).
- OCR of the printed ISBN digits (manual entry covers the unscannable case).

## How book barcodes work

The barcode on a book's back cover is an **EAN-13**, which _is_ the ISBN-13
(prefixed `978`/`979`). "Scan the barcode" therefore reduces to: decode an EAN-13,
validate it with the existing `isValidIsbn` checksum, and feed the digits to the
existing ISBN lookup.

## User experience

Entry point: a **Scan** button on the shelf, shown only when the device has a touch
screen + camera **and** the `features.scanner` flag is on for the environment.

States in the full-screen scanner sheet:

1. **Scanning** — live camera, reticle with a sweeping line, "point at the barcode"
   hint, quick toggles, and an "Enter ISBN manually" escape hatch.
2. **Confirm** (default) — decoded ISBN → looked-up book card with **Add owned** /
   **Add to wishlist**. Or **Auto-add** — adds straight to the Owned shelf.
3. **Continuous mode** — camera stays live; each add fires a success pill + haptic +
   reticle flash, and appends to an "added this session" list (de-duplicated).
4. **No match** — "Couldn't find that book" → manual ISBN entry (decoded value
   pre-filled), with "add anyway" options.
5. **Camera denied / unavailable** — manual ISBN entry fallback.

### Configurable preferences (client-side, persisted to localStorage)

- **Post-scan behavior**: `confirm` (default) | `autoAddOwned`
- **Scan mode**: `single` (default) | `continuous`

Editable from **both** Account → Settings and an in-scanner quick toggle.

## Acceptance criteria

- [ ] Decodes a real EAN-13 from a book on Android Chrome (native) and iPhone Safari (wasm).
- [ ] Invalid/misread barcodes are ignored (checksum-validated before any API call).
- [ ] Confirm mode shows the looked-up book; user picks Owned or Wishlist.
- [ ] Auto-add adds to Owned with an Undo affordance.
- [ ] Continuous mode dedupes a book already added this session.
- [ ] Unknown ISBN routes to manual entry with the decoded value pre-filled.
- [ ] Camera-denied and no-camera both fall back to manual entry.
- [ ] Manual entry accepts ISBN-10 ending in `X`.
- [ ] Scan button is hidden on desktop and when `features.scanner` is off.
- [ ] No backend, CDK resource, or DynamoDB schema changes.

## Out of scope / follow-ups

See `todo/TASKS.md` Backlog: collapse quick toggles behind an "Options" affordance;
fade the light→dark mode switch on open.
