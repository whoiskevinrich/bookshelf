# Design System

This document records all design decisions for the Bookshelf web app. It is the canonical reference for colors, typography, spacing, components, and accessibility rules. Update it when decisions change — do not let it drift from the code.

---

## Neutral Palette

Light-mode **surfaces** use the custom warm `paper-*` scale (BOOKSHELF-55 — pure white was abrasive at full-viewport scale). **Text, borders-on-dark, and all dark-mode colors stay on Tailwind's `slate-*` scale.** Do not use `gray-*`, `zinc-*`, or other neutral scales — mixing them creates subtle visual noise.

### Paper surfaces (light mode)

Defined as `@theme` tokens in `apps/web/src/index.css`. Lower = lighter/raised, higher = deeper/border.

| Token       | Hex       | Usage                                                                                |
| ----------- | --------- | ------------------------------------------------------------------------------------ |
| `paper-50`  | `#FDFBF5` | Raised surfaces — dialogs, dropdown menus, inputs, tooltips, segmented-control thumb |
| `paper-100` | `#F4F0E6` | Page background, header/footer chrome, auth layout                                   |
| `paper-200` | `#EAE4D4` | Insets — Callout, demo section, filter bar, hover rows, fallback book cover          |
| `paper-300` | `#E5DFD0` | Hairline borders (header/footer), badge fills, hover on insets                       |
| `paper-400` | `#DDD5C1` | Default borders — Callout, search input, segmented control                           |
| `paper-500` | `#D3CCBA` | Strong borders — form inputs, secondary buttons                                      |

Elevation reads _lighter = closer_: cream `paper-50` cards sit on the deeper `paper-100` page.

### Slate (text + dark mode)

| Token       | Light   | Dark             | Usage                                                                                 |
| ----------- | ------- | ---------------- | ------------------------------------------------------------------------------------- |
| `slate-400` | text    | —                | Placeholder text, disabled-ish icon affordances                                       |
| `slate-600` | text    | `dark:slate-400` | Muted/secondary body text, nav inactive (floor on paper surfaces — see Accessibility) |
| `slate-600` | text    | `dark:slate-300` | Auth subtitles, supporting copy                                                       |
| `slate-700` | text    | `dark:slate-300` | Secondary button text                                                                 |
| `slate-800` | bg      | —                | Book cover fallback bg (dark), secondary button hover bg (dark)                       |
| `slate-900` | text/bg | —                | Primary text, primary button bg, dark page bg                                         |

### When is `white` allowed?

`bg-white` no longer appears on light-mode surfaces. It remains in exactly three places: the primary button background in **dark** mode (the inverted button pattern), the QR code tile (scanners expect dark-on-light), and `white/N` alpha overlays on top of book-cover imagery and scanner surfaces.

### Semantic colors

These are additive — they signal state, not brand.

| Purpose          | Light                      | Dark                        |
| ---------------- | -------------------------- | --------------------------- |
| Error text       | `text-red-500`             | `dark:text-red-400`         |
| Error bg         | `bg-red-50`                | `dark:bg-red-900/30`        |
| Error border     | `border-red-200`           | `dark:border-red-800`       |
| Success text     | `text-green-700`           | `dark:text-green-400`       |
| Success bg       | `bg-green-50`              | `dark:bg-green-900/30`      |
| Link/interactive | `text-slate-900 underline` | `dark:text-white underline` |

---

## Typography

**Font family:** System UI stack — no custom web font is loaded. Tailwind's default `font-sans` applies.

**Scale in use:**

| Class      | Size | Weight      | Usage                                |
| ---------- | ---- | ----------- | ------------------------------------ |
| `text-xs`  | 12px | —           | Metadata, labels, count badges       |
| `text-sm`  | 14px | —           | Body text, button labels, form text  |
| `text-lg`  | 18px | —           | Marketing copy (landing subtitle)    |
| `text-xl`  | 20px | —           | Auth page subtitle (`AuthLayout` h2) |
| `text-2xl` | 24px | `font-bold` | Page headings (Shelf, Wishlist)      |
| `text-3xl` | 30px | `font-bold` | Auth branding (`AuthLayout` h1)      |
| `text-4xl` | 36px | `font-bold` | Landing page hero H1                 |

**Weight convention:**

- `font-medium` (500) — nav labels, form labels, subtle emphasis
- `font-semibold` (600) — section headers, component headings, logo
- `font-bold` (700) — page titles only

---

## Spacing

The app uses Tailwind's default spacing scale. Key conventions:

| Context                 | Value | Tailwind     |
| ----------------------- | ----- | ------------ |
| Page content max-width  | 896px | `max-w-4xl`  |
| Page horizontal padding | 24px  | `px-6`       |
| Page vertical padding   | 40px  | `py-10`      |
| Between page sections   | 40px  | `space-y-10` |
| Between form fields     | 16px  | `space-y-4`  |
| Between auth sections   | 32px  | `space-y-8`  |
| Grid gap (book cards)   | 16px  | `gap-4`      |
| Card internal padding   | 8px   | `p-2`        |

---

## Border Radius

| Context                  | Value | Class                                 |
| ------------------------ | ----- | ------------------------------------- |
| Form inputs              | 6px   | `rounded-md`                          |
| All buttons              | 8px   | `rounded-lg` (enforced by `<Button>`) |
| Search/book result rows  | 8px   | `rounded-lg`                          |
| Large content containers | 16px  | `rounded-2xl`                         |
| Count badges, pills      | full  | `rounded-full`                        |

**Rule:** Inputs → `rounded-md`. Buttons → `rounded-lg`. Containers → `rounded-2xl`. The `<Button>` component enforces `rounded-lg` automatically.

---

## Shadows

Minimal shadow use by design — the app is intentionally flat with borders as separators.

| Usage                    | Class                          |
| ------------------------ | ------------------------------ |
| Book cover images        | `shadow-sm`                    |
| Book cover on card hover | `shadow-md` (via group-hover)  |
| Form inputs              | `shadow-sm` (via `inputClass`) |

---

## Button Component

All buttons must use `<Button>` from `src/components/ui/Button.tsx`. **Never** write inline button Tailwind classes on a raw `<button>` element.

### Variants

| Variant              | Appearance                 | Use for                                                             |
| -------------------- | -------------------------- | ------------------------------------------------------------------- |
| `app` (or `primary`) | Slate-900 / white inverted | Primary CTAs everywhere — "Add a book", "Create account", "Sign in" |
| `secondary`          | Slate border + text        | Secondary actions — "Add to Wishlist" alongside a primary           |
| `ghost`              | Transparent, slate text    | Low-emphasis actions — "Load more", "Sign out", nav                 |
| `destructive`        | Red text                   | Irreversible actions — "Remove" book                                |

> `primary` is an alias for `app` — they render identically. Use `app` when the variant role is explicit; rely on the default (`primary`) when writing concise auth-form submit buttons.

### Sizes

| Size           | Padding         | Text      | Use for                                                      |
| -------------- | --------------- | --------- | ------------------------------------------------------------ |
| `sm`           | `px-2.5 py-1.5` | `text-xs` | Inline actions within content (card buttons, search results) |
| `md` (default) | `px-4 py-2`     | `text-sm` | Standard page buttons                                        |

For full-width auth submit buttons, pass `className="w-full"` — the component does not have a built-in `fullWidth` prop.

### Loading / disabled state

Pass `loading={true}` to disable the button and prevent double-submit. All variants apply `disabled:opacity-40` (or `disabled:opacity-50` on primary). Change the button text to a progressive label ("Signing in…") alongside `loading` — do not rely on the spinner alone.

---

## Form Inputs

Auth and in-app form inputs use the shared tokens from `src/lib/form-styles.ts`:

```ts
import { inputClass, labelClass } from "../../lib/form-styles";
```

**Never** redeclare these locally. This ensures consistent border, background, padding, and focus ring across all inputs.

**Focus ring:** `focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300` — monochromatic, high contrast in both modes.

---

## Callout

`Callout` (`src/components/ui/Callout.tsx`) is the shared container for low-urgency, **supporting** messages — tips and "you can also do X over there" pointers. Use it instead of inventing one-off bordered boxes. It is **not** for form validation feedback tied to an action — those stay inline with the red/green semantic tokens.

**Anatomy:** optional leading `icon` · `title` · body (`children`) · optional `actions` row · optional dismiss button (top-right, shown when `onDismiss` is passed).

**Tokens:**

| Part         | Light                                                       | Dark                                                                |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Container bg | `bg-paper-200`                                              | `dark:bg-slate-800/50`                                              |
| Border       | `border border-paper-400`                                   | `dark:border-slate-700`                                             |
| Radius       | `rounded-2xl`                                               | —                                                                   |
| Padding      | `p-5`                                                       | —                                                                   |
| Title        | `text-sm font-semibold slate-900`                           | `dark:text-white`                                                   |
| Body         | `text-sm text-slate-600`                                    | `dark:text-slate-300`                                               |
| Icon         | `text-slate-600`                                            | `dark:text-slate-400`                                               |
| Dismiss btn  | `text-slate-600 hover:bg-paper-300/70 hover:text-slate-900` | `dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white` |

**Rules:**

- The dismiss control is a real `<button>` with `aria-label`, an `h-11 w-11` (44×44px) tap target, and `hover:bg` feedback — never an icon-only `div`, never hover-only visibility.
- Pair the message with an icon or text — never color alone (WCAG 1.4.1).
- Action buttons inside `actions` use `<Button>` (`secondary`/`ghost`), never a raw `<button>`.
- Every color class ships a `dark:` counterpart. `role="note"`.
- Ambient only — never modal or blocking.

**Usage example** — `MobileScanHint` (`src/components/shelf/MobileScanHint.tsx`) points desktop users to the mobile scanner:

```tsx
<Callout
  title="Scan books with your phone"
  icon={<CameraIcon aria-hidden="true" />}
  dismissLabel="Dismiss scan tip"
  onDismiss={() => {
    track("hint_dismissed");
    setDismissed("yes");
  }}
>
  <p>
    Open <span className="font-medium text-slate-900 dark:text-white">bookshelf</span> on your phone
    and tap <span className="font-medium text-slate-900 dark:text-white">Scan</span>…
  </p>
  <QrCode value={appUrl} label={`QR code linking to ${displayUrl}`} className="h-28 w-28" />
</Callout>
```

> **QR codes** (`src/components/ui/QrCode.tsx`) always render dark-on-white with a quiet-zone margin, regardless of theme, because scanners expect dark-on-light. This is a deliberate exception to the dark-mode rule — the same reasoning as the always-dark camera scanner surface. The encoder is lazily imported so only views that show a QR pay for it.

---

## Links

### Inline navigation links (within auth forms)

Use `underline` to make links perceivable without relying on color alone (WCAG 1.4.1).

| Role                                                   | Classes                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Primary CTA link (Sign up, Sign in)                    | `font-medium underline underline-offset-2 text-slate-900 dark:text-white hover:no-underline`                                    |
| Secondary nav link (Forgot password?, Back to sign in) | `text-slate-600 dark:text-slate-400 underline underline-offset-2 hover:text-slate-900 dark:hover:text-white hover:no-underline` |

### In-app links (WishlistPage empty state, etc.)

```
text-sm text-slate-900 dark:text-white underline underline-offset-2
```

**Do not use `text-blue-*` for links.** Blue was removed from the app palette in favor of the monochromatic slate system.

---

## Dark Mode

**Implementation:** `ThemeContext` adds/removes the `.dark` class on `<html>`. Tailwind's `darkMode: 'class'` strategy activates `dark:` variants.

**Persistence:** Theme stored in `localStorage`; system preference (`prefers-color-scheme`) used on first visit.

**Inverted button pattern:** Primary buttons invert in dark mode — `dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200`. This is the only place `white` appears as a component background.

**Every new component must include `dark:` variants** for backgrounds, borders, and text. Check every tailwind class you write: if it affects visible color/border/bg, add its dark counterpart.

---

## Accessibility

### Focus rings

All interactive elements must have visible focus rings. Form inputs use `focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300`. The `<Button>` component inherits browser default focus ring (do not suppress `outline` without replacing it).

### Loading states

Spinners must include `role="status"` and `aria-label`:

```tsx
<div role="status" aria-label="Loading" className="animate-spin ..." />
```

Dynamic regions (search results, error messages, status updates) must be wrapped in an `aria-live` region:

```tsx
<div role="status" aria-live="polite" aria-atomic="true">
  {loading && <p>Searching…</p>}
  {error && <p>Error…</p>}
</div>
```

### Muted text floor on paper

`text-slate-500` measures **4.16:1 on `paper-100`** — below WCAG AA (4.5:1) for normal text. The light-mode muted floor is therefore **`text-slate-600`** for any text sitting on `paper-100`/`paper-200` surfaces. On `paper-50` raised surfaces `slate-500` still passes (4.59:1), but use `slate-600` everywhere for consistency. Dark mode keeps `dark:text-slate-400`.

### Color-only information

Never communicate state by color alone. Use shape/icon/text alongside color:

- Errors: red color + error message text + (optional) error icon
- Required fields: use `required` attribute, not red asterisk alone
- Active nav links: `font-medium` weight distinguishes active from inactive (not just color)

### Touch targets

Minimum tap target: 44×44px (WCAG 2.5.8). The `<Button>` `sm` size is `py-1.5 text-xs` — this meets the minimum at typical font sizes. Do not use `py-1` or smaller.

### Interactive affordances

No hover-only affordances. If an element is interactive, it must be visible without hover (e.g., book card action buttons are always rendered, not `opacity-0 group-hover:opacity-100`).

---

## Animations

| Name                 | Class                                           | Trigger | Duration         | Usage                                            |
| -------------------- | ----------------------------------------------- | ------- | ---------------- | ------------------------------------------------ |
| Card mount           | `animate-fade-up`                               | Mount   | CSS-defined      | `ShelfBookCard` — staggered via `animationDelay` |
| Cover lift           | `group-hover:scale-105 group-hover:shadow-md`   | Hover   | `duration-200`   | Book cover inside card                           |
| Card hover bg        | `hover:bg-paper-200 dark:hover:bg-slate-800/50` | Hover   | `duration-200`   | Card container                                   |
| All color/bg changes | `transition-colors`                             | State   | Tailwind default | Buttons, links, headers                          |

Stagger cap: `MAX_STAGGER_INDEX = 9` at `STAGGER_STEP_MS = 50ms` steps. Cards beyond index 9 share the same delay to avoid long waits on large shelves.

---

## Scanner Components

The camera scanner runs on a **forced-dark surface** (`bg-black`) regardless of the user's theme. All scanner components omit `dark:` prefixes — the dark surface is unconditional. Do not add light-mode variants to scanner internals.

### ScannerReticle

The viewport overlay that guides the user's aim. Two variants share the same corner-bracket style but differ in shape and position.

| Variant             | Dimensions                             | Position    | Purpose                     |
| ------------------- | -------------------------------------- | ----------- | --------------------------- |
| `barcode` (default) | 240×150 px                             | Centered    | Framing a barcode label     |
| `text`              | ≈70% screen width × ≈18% screen height | Lower third | Framing a printed ISBN line |

**Shared tokens:**

- Corner brackets: `w-6 h-6 border-white border-[3px]` with matching `rounded-*-2xl`
- Dimmed surround: `box-shadow: 0 0 0 2000px rgba(2,6,23,0.55)` on the inner box
- Instructional label: `text-sm text-slate-200`, centered, `bottom-6`

**Barcode-variant additions:**

- Animated scan line: `animate-scan-line h-0.5 bg-emerald-400` at vertical center, `box-shadow: 0 0 8px #34d399`
- Label text: "Point at the barcode on the back cover"

**Text-variant additions:**

- No animated scan line
- Optional inline hint inside the box: `text-xs text-slate-400` "Align the ISBN line here" (fades after first successful scan)
- Label text: "Align the ISBN line here" (same copy as hint, shown while hint is visible; hidden after)

**Do's and Don'ts:**

| ✅ Do                                                                     | ❌ Don't                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Use `border-white` for brackets regardless of theme                       | Add `dark:` variants to reticle internals                                             |
| Position `text` variant in lower third via absolute positioning           | Center the text reticle — ISBN text appears low on the cover                          |
| Keep the dimmed surround `box-shadow` — do not use a backdrop overlay div | Replace `box-shadow` surround with a separate dim layer (breaks reticle transparency) |

---

### ScannerViewfinder

Wraps the `<video>` element and `ScannerReticle`. Owns the camera surface.

```tsx
<ScannerViewfinder
  videoRef={videoRef}
  reticleVariant="barcode" | "text"
  hint?: string          // inline text-xs text-slate-400 hint inside the reticle
  onScanTap?: () => void // text mode: tap-to-scan button handler
  scanning?: boolean     // drives the "Scan" button loading state
/>
```

- The `<video>` element fills the container: `w-full h-full object-cover`
- In `reticleVariant="text"` mode a `<Button variant="app">` labelled "Scan" (or "Scanning…" when `scanning`) is absolutely positioned below the reticle box
- The Scan button must be inside `ScannerViewfinder` so it overlays the camera feed; it must not be in the modal footer

---

### ScannerModeBar

Owns the mode toggle and the auto-fallback nudge. Sits between the viewfinder and the footer.

```tsx
<ScannerModeBar
  mode="barcode" | "text"
  onModeChange={(mode) => void}
  showFallbackNudge?: boolean  // true after 2.5s barcode-free
  onNudgeAccept?: () => void   // called when user taps "Switch to Text"
  onNudgeDismiss?: () => void
/>
```

- Mode toggle: `<SegmentedControl>` with options `[{ value: "barcode", label: "Barcode" }, { value: "text", label: "Text" }]`
- Auto-fallback nudge: `<Callout role="note">` with title "Can't find a barcode?", body text, and `<Button size="sm" variant="secondary">Switch to Text</Button>` in the `actions` slot
- The nudge appears when `showFallbackNudge` is true and dismisses (via `onNudgeDismiss`) if a barcode is detected while it is visible

---

### ScannerResultFlow

Owns the lookup → confirmation → success → error view states. Extracted from `ScanModal` with no visual changes. Receives the detected ISBN-13 and fires callbacks:

```tsx
<ScannerResultFlow
  isbn13: string
  onConfirm: (status: "owned" | "want") => void
  onCancel: () => void
  onSuccess: () => void
  onError: (err: Error) => void
  postScanBehavior: "confirm" | "autoAddOwned"
/>
```

This component has no new design tokens. All visual states (confirmation card, success banner, error state) are unchanged from the pre-refactor `ScanModal`.

---

### Scanner Surface Tokens (summary)

| Element                 | Classes                                                    |
| ----------------------- | ---------------------------------------------------------- |
| Full-screen backdrop    | `fixed inset-0 bg-black`                                   |
| Reticle corner brackets | `absolute w-6 h-6 border-white border-[3px] rounded-*-2xl` |
| Dimmed surround         | `box-shadow: 0 0 0 2000px rgba(2,6,23,0.55)`               |
| Scan-line animation     | `animate-scan-line h-0.5 bg-emerald-400`                   |
| Instructional label     | `text-sm text-slate-200`                                   |
| Inline hint (text mode) | `text-xs text-slate-400`                                   |
| Result card surface     | `rounded-2xl border border-white/10 bg-slate-900 p-4 m-3`  |
| Footer surface          | `border-t border-white/10 bg-slate-950/90 px-4 py-3`       |
| Success accent          | `text-emerald-400`                                         |
| Manual-entry surface    | `absolute inset-0 overflow-y-auto bg-slate-950`            |

---

## Component Checklist (code review)

- [ ] Buttons use `<Button>` — no raw `<button>` with `bg-slate-900` or `bg-blue-600`
- [ ] Form inputs import `inputClass`/`labelClass` from `form-styles.ts`
- [ ] Every color class has a `dark:` counterpart
- [ ] Loading spinners have `role="status"` and `aria-label`
- [ ] Dynamic content regions have `role="status" aria-live="polite"`
- [ ] Links use `underline` — no color-only link affordance
- [ ] No `opacity-0 group-hover:opacity-100` — all interactive elements visible without hover
- [ ] Touch targets: no `py-1` or smaller on interactive elements
- [ ] Light-mode surfaces use `paper-*`; text and dark mode use `slate-*` — no `gray-*`, `zinc-*`, or raw `bg-white` (outside the three documented exceptions)
- [ ] Scanner internals have no `dark:` prefixes — the surface is unconditionally dark
- [ ] Text-mode reticle uses `variant="text"` prop — no ad-hoc width/height overrides inline
- [ ] Scan button (`variant="app"`, label "Scan" / "Scanning…") lives inside `ScannerViewfinder`, not the modal footer
