# Spec: Dark Mode

**Status**: Draft  
**Date**: 2026-05-31

---

## Problem Statement

The Bookshelf web app currently renders only in a light theme. Users who prefer dark environments (evening reading sessions, system-level dark mode set on their device) see a bright white UI that causes eye strain. Since the app's primary use case — tracking books — happens during leisure time, often at night, dark mode is high-value relative to its implementation cost.

## Goals

1. Users who prefer dark mode can switch the app to a dark theme with a single action.
2. The preference persists across page reloads and new browser sessions without requiring re-authentication.
3. Users whose OS is already set to dark mode get dark mode by default on first load.
4. Every existing page and component renders correctly in both themes with sufficient contrast (WCAG AA minimum).

## Non-Goals

- **Per-component overrides**: Users can only toggle the global theme, not customize colors per-page or per-component.
- **High-contrast / accessibility themes**: Separate accessibility modes are out of scope; this is a standard dark palette only.
- **Syncing across devices**: Preference is stored locally (localStorage); no server-side persistence in v1.
- **Custom color picker or theming**: No user-defined palettes. Two options: light and dark.
- **Admin/org-level defaults**: No organization-wide theme enforcement — this is a personal preference.

## User Stories

- As a user, I want to toggle dark mode from the app header so that I can switch themes without leaving any page.
- As a user, I want the app to remember my preference so that I don't have to toggle it every time I open the app.
- As a user who has dark mode set at the OS level, I want the app to default to dark mode on first load so that the UI matches my environment without any setup.
- As a user reading my shelf at night, I want a dark background and light text so that the UI is comfortable in low-light conditions.

## Requirements

### Must-Have (P0)

- **Toggle control in AppHeader**: A button/icon in the site header that switches between light and dark mode.
  - _Acceptance_: Toggle is visible on every page; clicking it immediately changes the theme without a page reload.
- **Dark theme applied globally**: All existing pages (Landing, Shelf, Wishlist, Auth flows) render with a dark palette.
  - _Acceptance_: No page or component retains a hard-coded white/gray-light background when dark mode is active.
- **Preference persisted in localStorage**: The chosen theme survives page refresh and new browser tab.
  - _Acceptance_: Set dark mode → close tab → reopen app → app loads in dark mode.
- **System preference detection on first visit**: Respects `prefers-color-scheme: dark` media query for users who have never explicitly toggled.
  - _Acceptance_: A user with OS dark mode set sees dark mode on first load without any interaction.

### Nice-to-Have (P1)

- **Smooth transition**: Theme switch applies a short CSS transition (e.g. 150 ms) so the color change is not jarring.
- **Icon reflects current state**: Toggle icon shows a moon when in light mode (click for dark) and a sun when in dark mode (click for light).

### Future Considerations (P2)

- Sync preference to user profile (API) so it follows the user across devices and browsers.
- System-preference auto-follow mode: re-apply OS preference if user hasn't manually overridden.

## Technical Approach (Implementation Notes)

The app uses **Tailwind CSS v4** with no custom config file. The recommended approach:

1. **CSS custom properties on `:root` / `.dark`**: Define a color token set in `index.css` (e.g. `--color-bg`, `--color-text-primary`) for both modes.
2. **`dark` class on `<html>`**: Tailwind v4's dark mode via `class` strategy — add/remove `dark` on `document.documentElement`.
3. **`useTheme` hook**: A React hook wrapping localStorage read/write + system preference detection; exposes `theme` and `toggleTheme`.
4. **Replace hard-coded color utilities**: Audit each component and replace light-only classes (e.g. `bg-gray-50`, `text-gray-900`) with semantic token classes that map to the custom properties.

This approach avoids a full design system rebuild — only `index.css` and component classes need to change.

## Success Metrics

- **Adoption (leading)**: ≥20% of active sessions have dark mode enabled within 30 days of launch.
- **No regression (leading)**: Zero new accessibility-contrast bugs filed against any page within 2 weeks post-launch.
- **Persistence working (lagging)**: <1% of sessions where theme resets unexpectedly (measured via error monitoring if added, or manual QA).

## Open Questions

- **[Engineering]** Does Tailwind v4's `@theme` block replace CSS custom properties, or should we define tokens in plain CSS? Clarify before implementation.
- **[Design]** Should the dark palette use Tailwind's `zinc`/`slate` grays (cooler) or `neutral` (warmer)? No strong preference stated yet.

## Timeline

No hard deadline. This is a self-contained UI change with no API or infra dependencies. Estimate: 0.5–1 day for a single developer.
