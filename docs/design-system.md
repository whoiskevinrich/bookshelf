# Design System

This document records all design decisions for the Bookshelf web app. It is the canonical reference for colors, typography, spacing, components, and accessibility rules. Update it when decisions change — do not let it drift from the code.

---

## Neutral Palette

The app uses **Tailwind's `slate-*` scale exclusively** as the neutral palette. Do not use `gray-*`, `zinc-*`, or other neutral scales — mixing them creates subtle visual noise.

| Token       | Light     | Dark             | Usage                                                    |
| ----------- | --------- | ---------------- | -------------------------------------------------------- |
| `slate-50`  | bg        | —                | Auth layout background                                   |
| `slate-100` | bg        | —                | Subtle dividers, fallback book cover                     |
| `slate-200` | border/bg | —                | Section rule, count badge bg                             |
| `slate-300` | border    | —                | Form input border, secondary button border               |
| `slate-400` | text      | —                | Placeholder text, muted metadata                         |
| `slate-500` | text      | `dark:slate-400` | Secondary body text, nav inactive                        |
| `slate-600` | text      | `dark:slate-300` | Auth subtitles, supporting copy                          |
| `slate-700` | text      | `dark:slate-300` | Secondary button text                                    |
| `slate-800` | bg        | —                | Book cover fallback bg, secondary button hover bg (dark) |
| `slate-900` | text/bg   | —                | Primary text, primary button bg                          |
| `white`     | bg        | `dark:slate-900` | Page background                                          |
| `white`     | bg        | `dark:white`     | Primary button bg in dark mode                           |

### When is `white` a neutral?

`white` is used as the primary page background in light mode and as the primary button background in dark mode (the inverted button pattern). It is not a "color choice" — it is part of the monochromatic inversion system.

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
| Container bg | `bg-slate-50`                                               | `dark:bg-slate-800/50`                                              |
| Border       | `border border-slate-200`                                   | `dark:border-slate-700`                                             |
| Radius       | `rounded-2xl`                                               | —                                                                   |
| Padding      | `p-5`                                                       | —                                                                   |
| Title        | `text-sm font-semibold slate-900`                           | `dark:text-white`                                                   |
| Body         | `text-sm text-slate-600`                                    | `dark:text-slate-300`                                               |
| Icon         | `text-slate-500`                                            | `dark:text-slate-400`                                               |
| Dismiss btn  | `text-slate-500 hover:bg-slate-200/70 hover:text-slate-900` | `dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white` |

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
    Open <span className="font-medium text-slate-900 dark:text-white">bookshelf</span> on your
    phone and tap <span className="font-medium text-slate-900 dark:text-white">Scan</span>…
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
| Secondary nav link (Forgot password?, Back to sign in) | `text-slate-500 dark:text-slate-400 underline underline-offset-2 hover:text-slate-900 dark:hover:text-white hover:no-underline` |

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

| Name                 | Class                                          | Trigger | Duration         | Usage                                            |
| -------------------- | ---------------------------------------------- | ------- | ---------------- | ------------------------------------------------ |
| Card mount           | `animate-fade-up`                              | Mount   | CSS-defined      | `ShelfBookCard` — staggered via `animationDelay` |
| Cover lift           | `group-hover:scale-105 group-hover:shadow-md`  | Hover   | `duration-200`   | Book cover inside card                           |
| Card hover bg        | `hover:bg-slate-50 dark:hover:bg-slate-800/50` | Hover   | `duration-200`   | Card container                                   |
| All color/bg changes | `transition-colors`                            | State   | Tailwind default | Buttons, links, headers                          |

Stagger cap: `MAX_STAGGER_INDEX = 9` at `STAGGER_STEP_MS = 50ms` steps. Cards beyond index 9 share the same delay to avoid long waits on large shelves.

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
- [ ] Neutral colors use `slate-*` only — no `gray-*` or `zinc-*`
