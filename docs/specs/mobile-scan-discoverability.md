# Spec: Desktop → Mobile Scan Discoverability (the `Callout` design-system entry)

**Status**: Draft
**Date**: 2026-06-15
**Related**: `docs/specs/isbn-scanning.md`, ADR-014 (decoder + ship-dark flag), `docs/design-system.md`

## Problem

ISBN barcode scanning shipped as a **web** feature, but its entry point is gated to
touch devices with a camera (`supportsCameraScan()` in `apps/web/src/lib/device.ts`)
**and** the `features.scanner` runtime flag. The `isbn-scanning.md` spec makes this
explicit: "Desktop webcam scanning" is a non-goal and "Scan button is hidden on
desktop." The practical consequence is that **a user sitting at a desktop browser has
no way to learn the feature exists.** They keep typing ISBNs one at a time, unaware
that the same app on their phone would let them scan a back-cover barcode in one motion.

The most common cataloguing session — standing at a physical bookshelf — is exactly
the moment scanning shines, but a desktop user never gets pointed to it. There is no
discovery path from desktop to the mobile capability today.

## Goals

1. **Make desktop users aware** that camera scanning exists on mobile, at the moment
   they are adding books (where the intent is highest).
2. **Give them a frictionless way to get there** — open the app on their phone and
   start scanning with minimal steps.
3. **Introduce a reusable `Callout` primitive** to the design system so informational
   "you can do X over there" messaging has one consistent, accessible home (there is
   no callout/banner/tip component today).
4. **Stay non-intrusive** — dismissible, remembered, and never shown to users who
   already have scanning available on the device they're using.

## Non-Goals

- **Building desktop webcam scanning.** Out of scope and an explicit non-goal of
  `isbn-scanning.md`; this spec is about _pointing to_ the existing mobile feature,
  not replicating it on desktop.
- **Backend, CDK, or DynamoDB changes.** This is a client-only, presentational
  feature. Dismissal state is client-side (localStorage), matching how scanner
  preferences are already persisted.
- **A full notification/announcement framework.** We are adding one focused `Callout`
  primitive and one instance of it, not a generic in-app messaging system.
- **Native app install prompts / PWA "Add to Home Screen" flows.** Separate initiative.
- **Email or push "try scanning on mobile" campaigns.** In-app surface only.

## User Stories

**Desktop cataloguer**

- As a user adding books from my desktop browser, I want to know that I can scan
  barcodes with my phone, so that I can catalogue my physical shelf far faster than
  typing ISBNs.
- As a desktop user who's seen the hint, I want to dismiss it permanently, so that it
  doesn't nag me on every visit once I've decided.

**Mobile-capable user**

- As a user already on a phone with the scanner available, I want to **not** see a
  "scan on mobile" hint (I can already scan), so that the UI isn't cluttered with
  irrelevant messaging.

**User acting on the hint**

- As a desktop user, I want a one-glance way to open the app on my phone (a short URL
  and/or a QR code), so that I don't have to type the address on a small keyboard.

## Requirements

### Must-Have (P0)

**P0-1 — `Callout` design-system primitive.**
A new reusable component at `apps/web/src/components/ui/Callout.tsx`, documented in
`docs/design-system.md` (see **Design-System Entry** below).

- Props: `title?`, `children` (body), `icon?`, `tone` (`info` default | `success`),
  `onDismiss?`, `actions?` (slot for `<Button>`s).
- Renders with the slate neutral palette, full `dark:` variants, `rounded-2xl`
  container, and `role="note"` (or `role="status"` when used for live messaging).
- Acceptance:
  - Given a `Callout` with `onDismiss`, when the user activates the dismiss control,
    then the `Callout` is removed and `onDismiss` fires.
  - Given dark mode is active, then background, border, text, and icon all have
    correct `dark:` variants (passes the design-system Component Checklist).
  - The dismiss control is a real focusable button with an `aria-label` (not an
    icon-only `div`), meeting the 44×44px touch-target minimum.

**P0-2 — `MobileScanHint` instance.**
A composition of `Callout` at `apps/web/src/components/shelf/MobileScanHint.tsx` that
delivers the scan-on-mobile message and instructions.

- Copy (instructions): a short heading + steps — e.g. _"Scan books with your phone.
  Open bookshelf on your phone, sign in, and tap **Scan** to add a book by pointing
  the camera at its barcode."_
- Includes the app URL as selectable text **and** a QR code (see P0-4), plus an
  in-app deep target (the shelf).
- Acceptance:
  - Given the hint is visible, then it states _where_ to go (open on phone) and _what
    to tap_ (the Scan button), not just "scanning exists."

**P0-3 — Environment-derived app URL (Q1).**
The URL shown/encoded is **derived from the current environment**, not hardcoded to the
prod domain. The simplest env-derived value is `window.location.origin` — whatever
origin the user is on _is_ the canonical URL for that environment (dev → dev CloudFront
URL, prod → `bookshelf.whoiskevinrich.com`). No new runtime-config field is needed
(`runtime-config.ts` has no origin field today, and adding one would duplicate what the
browser already knows).

- Acceptance: Given the app is opened on the dev CloudFront URL, then the hint's URL
  and QR encode that dev origin; on prod they encode the prod domain.

**P0-4 — QR code _and_ text URL (Q2).**
Render **both** a scannable QR code (encoding the env-derived origin from P0-3) and the
origin as selectable text beneath it. Prefer a tiny/zero-dependency inline SVG QR
generator; the QR is a `<svg>` (crisp in both color modes) with a descriptive
`aria-label`/`role="img"`, accompanied by the text URL so the information is never
QR-only (accessibility — not everyone can scan a QR from the same screen).

- Acceptance:
  - Given the hint renders, then both a QR `<svg>` and the text URL are present.
  - Given a screen reader, then the QR exposes a label naming the destination and the
    text URL is readable.

**P0-5 — Correct surfacing logic on ShelfPage and WishlistPage (Q3).**
Render `MobileScanHint` on **both** `ShelfPage` (`apps/web/src/pages/ShelfPage.tsx`)
and `WishlistPage` (`apps/web/src/pages/WishlistPage.tsx`), in the add-book region near
where the Scan button appears on mobile. Dismissal is shared (one localStorage key —
dismissing on one page hides it on both).

- Show **only when** all are true: `features.scanner` is on for the environment
  (`getRuntimeConfig().features.scanner`), the device **cannot** scan
  (`!supportsCameraScan()`), and the user has not dismissed it.
- Acceptance:
  - Given a touch device where the Scan button is shown, then the hint is **not**
    rendered on either page (no redundant messaging).
  - Given `features.scanner` is off, then the hint is **not** rendered.
  - Given a desktop browser with the flag on and no prior dismissal, then the hint
    **is** rendered on both ShelfPage and WishlistPage.
  - Given the user dismisses on ShelfPage, then it is also hidden on WishlistPage.

**P0-6 — Analytics instrumentation (Q4).**
Instrument `hint_shown`, `hint_link_clicked` (URL/QR interaction), and `hint_dismissed`
events so the Success Metrics below are measurable from launch. See **Analytics
Options** for the recommended low-cost approach and trade-offs.

- Acceptance:
  - Given the hint renders, then a `hint_shown` event fires once per session.
  - Given the user clicks the URL or interacts with the QR, then `hint_link_clicked`
    fires.
  - Given the user dismisses, then `hint_dismissed` fires.

**P0-7 — Dismissal persistence.**
Dismissal is remembered across sessions via `localStorage` (mirroring
`ScannerPreferencesContext`), under a single shared key (per P0-5). Once dismissed, the
hint does not return on either page.

- Acceptance: Given the user dismisses the hint and reloads, then it stays hidden.

**P0-8 — Accessibility & design-system compliance.**

- Passes every item in the `docs/design-system.md` Component Checklist.
- Not communicated by color alone (icon + text).
- No hover-only affordances; dismiss button always visible.

### Nice-to-Have (P1)

**P1-1 — Empty-state placement.**
Also surface the hint inside `ShelfEmptyState` for brand-new users (zero books) on
desktop — that's the highest-intent "I'm about to catalogue my shelf" moment.

### Future Considerations (P2)

- **Generalize `Callout`** for other "do this elsewhere" moments (e.g. pointing to
  Account settings). Designing the prop API now (tone, actions slot) keeps this cheap.
- **Server-side dismissal** if/when scanner preferences move server-side (currently a
  documented follow-up in `isbn-scanning.md`).
- **Deep link with auth hand-off** (open phone already signed in) — depends on a
  broader cross-device session story; out of scope now.

## Design-System Entry

This is the artifact the task calls for: a documented `Callout` entry to add to
`docs/design-system.md`, complete with instructions and examples.

### `Callout`

> An informational container for low-urgency, supporting messages — "you can also do
> X," tips, and cross-surface pointers. Use it instead of inventing one-off bordered
> boxes. It is **not** for error/success validation feedback tied to a form action
> (those stay inline with the existing red/green semantic tokens).

**Anatomy:** optional leading icon · title · body copy · optional actions row ·
optional dismiss button (top-right).

**Tokens (slate palette, both modes):**

| Part         | Light                                 | Dark                    |
| ------------ | ------------------------------------- | ----------------------- |
| Container bg | `bg-slate-50`                         | `dark:bg-slate-800/50`  |
| Border       | `border border-slate-200`             | `dark:border-slate-700` |
| Radius       | `rounded-2xl` (container)             | —                       |
| Padding      | `p-4` (or `p-5` with QR)              | —                       |
| Title        | `text-sm font-semibold slate-900`     | `dark:text-white`       |
| Body         | `text-sm text-slate-600`              | `dark:text-slate-300`   |
| Icon         | `text-slate-500`                      | `dark:text-slate-400`   |
| Dismiss btn  | `text-slate-500 hover:text-slate-900` | `dark:hover:text-white` |

**Rules:**

- Always pair the tone with an icon or text — never color alone (WCAG 1.4.1).
- Dismiss is a real `<button>` with `aria-label="Dismiss"`, ≥44×44px tap target.
- Action buttons inside use `<Button>` (`secondary`/`ghost`), never raw `<button>`.
- Every color class ships a `dark:` counterpart.

**Usage example (the `MobileScanHint` instance):**

```tsx
// apps/web/src/components/shelf/MobileScanHint.tsx
const appUrl = window.location.origin; // env-derived (Q1/P0-3)

<Callout
  tone="info"
  icon={<CameraIcon aria-hidden="true" />}
  title="Scan books with your phone"
  onDismiss={dismiss}
>
  <p>
    Open <span className="font-medium">bookshelf</span> on your phone, sign in, and tap{" "}
    <span className="font-medium">Scan</span> to add a book by pointing the camera at its barcode.
  </p>
  <QrCode
    value={appUrl}
    role="img"
    aria-label={`QR code linking to ${appUrl}`}
    className="mt-3 h-28 w-28"
  />
  <a
    href={appUrl}
    className="mt-1 block text-sm text-slate-900 dark:text-white underline underline-offset-2"
  >
    {appUrl.replace(/^https?:\/\//, "")}
  </a>
</Callout>;
```

**Conditional render (shared across ShelfPage and WishlistPage — Q3/P0-5):**

```tsx
const showScanHint =
  getRuntimeConfig().features.scanner && !supportsCameraScan() && !scanHintDismissed;

{
  showScanHint && <MobileScanHint onDismiss={dismissScanHint} />;
}
```

**Do / Don't:**

- ✅ Use for "this works better on your phone," tips, and pointers to another surface.
- ✅ Keep it dismissible when it's a one-time nudge.
- ❌ Don't use it for form validation errors (use inline red/green semantic tokens).
- ❌ Don't make it modal or blocking — it's ambient, not a gate.

## Success Metrics

**Leading (days–weeks):**

- **Hint engagement:** % of desktop sessions where the hint is shown that result in a
  click on the URL/QR or a mobile session for that account within 24h. Target: ≥ 8%.
- **Dismissal rate:** % of users who dismiss without acting. Watch as a nuisance
  signal; if > 70% dismiss immediately, revisit copy/placement.

**Lagging (weeks–months):**

- **Scanner adoption lift:** increase in first-time scanner use among accounts that
  began on desktop, vs. the pre-launch baseline. Target: measurable upward trend.
- **Books-added velocity:** median books added per cataloguing session for accounts
  exposed to the hint vs. not.

There is **no analytics pipeline in the web app today** (no events are instrumented),
so the metrics above require new plumbing — see **Analytics Options** for how we'll add
it cheaply (Q4: instrument now).

## Analytics Options (Q4)

We want measurement from launch, and **low cost is the deciding factor.** Three options,
cheapest-fit first:

**Option A — `POST /v1/events` Hono route → CloudWatch EMF (recommended).**
Add one tiny authenticated route to the existing API (`apps/api`) that accepts a small
event payload and writes it as an [Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html)
log line. CloudWatch turns those into queryable metrics — no new datastore, no new
service.

- **Cost:** marginal Lambda invocations + a trickle of CloudWatch Logs ingestion. Events
  are low-volume (one shelf/wishlist view each). Effectively rounding error.
- **Pros:** reuses the existing Lambda + `authMiddleware`; metrics live next to the rest
  of our observability; no third party, no PII leaving AWS; no new infra in CDK beyond
  the route.
- **Cons:** we own a (trivial) endpoint; must apply the New-Endpoint Checklist (input
  validation, body limit, max-length caps) from `CLAUDE.md`.
- **Note:** This becomes the app's first generic event sink — design the payload
  (`{ name, props }`) so other features can reuse it.

**Option B — Amazon CloudWatch RUM.**
Drop in the managed real-user-monitoring web client and emit custom events.

- **Cost:** **$1 per 100k events** + data retention — cheap at our scale but a real
  per-event line item, and RUM also pulls in page/session telemetry we don't need.
- **Pros:** zero backend code; AWS-native; gives session context for free.
- **Cons:** adds a client SDK + an App Monitor resource in CDK; more than we need for
  three events; another thing to configure per environment.

**Option C — Third-party (Plausible / PostHog free tier / GA4).**

- **Cost:** $0 on free tiers, but sends user behavior to an external service.
- **Pros:** richest dashboards out of the box, fastest to wire.
- **Cons:** external dependency + privacy/consent surface (cookie banner risk), and it
  conflicts with the app's no-third-party-telemetry posture. **Not recommended.**

> **Recommendation: Option A.** Lowest true cost, no new external surface, reuses the
> stack we already operate, and leaves us a reusable event sink. The three events
> (`hint_shown`, `hint_link_clicked`, `hint_dismissed`) are the whole v1 payload.

## Resolved Decisions

The original open questions, with the answers folded into the requirements above:

- **Q1 — App URL source:** _Environment-derived._ Use `window.location.origin`
  (no new config field). → P0-3.
- **Q2 — QR vs. text URL:** _Both._ Inline SVG QR **and** selectable text URL. → P0-4.
- **Q3 — Which pages:** _Both ShelfPage and WishlistPage_ (shared dismissal), plus the
  P1 empty-state placement. → P0-5, P1-1.
- **Q4 — Analytics:** _Instrument now_ via **Option A** (`POST /v1/events` → CloudWatch
  EMF). → P0-6 + Analytics Options.
- **Q5 — Feature flag:** _Already on in both environments_ — `scannerEnabled: true` for
  dev **and** prod in `packages/infra/bin/bookshelf.ts:66,74` ("released to prod. On in
  both environments"); ADR-014's ship-dark phase is over. The hint gates on the same
  `features.scanner` flag, which is currently always true. **Recommended follow-up
  (separate task):** retire the now-always-true `scanner` flag entirely
  (`scannerEnabled`, `featureScanner`, `RuntimeConfig.features.scanner`, and the
  `getRuntimeConfig().features.scanner` guards) since the feature is shipped and tested
  — tracked outside this spec to keep its scope tight.

## Remaining Open Questions

- **Q6 — [data]** Event payload shape for the reusable sink: minimum is
  `{ name: string; props?: Record<string, string|number|boolean> }`. Confirm we don't
  also want a per-event `sessionId`/`anonId` for the "mobile session within 24h"
  lagging metric (which needs correlating a desktop view to a later mobile session).

## Timeline Considerations

- **Backend touch is small but real** (Option A adds `POST /v1/events`) → one PR can
  carry the `Callout` primitive, `MobileScanHint`, both page placements, the QR
  generator, and the events route.
- **No flag dependency to wait on:** `features.scanner` is already on in dev and prod,
  so the hint is visible immediately on merge + deploy.
- **Suggested phasing:** v1 = `Callout` primitive + `MobileScanHint` (QR + text URL) on
  ShelfPage **and** WishlistPage, dismissible, with `POST /v1/events` analytics.
  Fast-follow = empty-state placement (P1-1) + the flag-retirement cleanup (Q5).
