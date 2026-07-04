# Spec: "What's New" In-App Release Notes

**Status**: Draft
**Date**: 2026-07-03
**Owner**: Solo developer
**Jira**: Epic BOOKSHELF-72 · stories BOOKSHELF-73 (convention), BOOKSHELF-74 (generator), BOOKSHELF-75 (panel + dot), BOOKSHELF-76 (seed)
**Related**: ADR-017 (CI-derived release version), `release-please-config.json`, `docs/runbooks/cicd-setup.md`, `docs/design-system.md`, `docs/specs/multiple-copies.md`

## Problem

The app ships continuously — every merge to `main` auto-deploys to dev and, on promotion, to prod. Users never find out what changed. The only record of change is `CHANGELOG.md`, which Release Please generates from Conventional Commits (`fix(web): recover ISBN-13 from barcodes with an EAN-2/EAN-5 add-on`) — a **developer** artifact full of commit scopes, Jira keys, and CI plumbing that no reader of the app should ever see.

For a solo-built app whose audience will grow from "people I know" to strangers, a visible, steady stream of shipped improvements is a **trust and momentum signal** — evidence the thing is alive and cared for. Today that signal is invisible.

This is not a utility feature (it is **not** for re-engagement or for explaining moved UI). Its job is **transparency, momentum, and delight**.

## Scope

**In scope — a curated, in-app "What's New" feed.** A passive panel, opened from a header icon, showing a date-grouped, human-readable list of notable changes, fed by an opt-in commit convention and generated at build time.

**Out of scope (deferred):**

- **Interruptive "moment"** — a toast/modal on version change. High-delight but higher-risk; revisited as P2 once the passive panel proves out.
- **Cross-device "seen" state** — server-side per-user read tracking. MVP is per-device via `localStorage`.
- **Stale-tab live detection** — notifying a long-open tab that a new build deployed without a reload.
- **Piping the raw changelog** — explicitly rejected; developer text is the anti-goal.

## Goals / Non-goals

**Goals**

- Give users a friendly, honest, always-current feed of notable changes, in the app.
- Keep the content pipeline low-friction enough that it never goes stale (a visibly abandoned feed signals the _opposite_ of momentum).
- Zero new backend — no API route, no DynamoDB item, no auth surface. Static JSON bundled with the web build.
- Read well cold, to a first-time visitor who has never seen the app.

**Non-goals**

- Not a version log. Releases with nothing user-facing produce **no** feed entry (silence, never "v0.4.2 — no notable changes").
- Not marketing copy. Plain, present-tense, benefit-first — the CDS/house voice.
- Not per-user or personalized. Everyone sees the same feed.
- No editorial CMS. The "content system" is a git trailer plus a build script.

## Core decision — `Release-Note:` trailer → build-time `whats-new.json`

**Capture.** A change is flagged as user-facing by adding a `Release-Note:` trailer to its squash-merge commit body — the friendly sentence lives next to the change, written at the moment it ships:

```
feat(web): search box over your own library (BOOKSHELF-52)

Release-Note: Find any book you own by title or author, right from the shelf.
```

Prior art: Kubernetes `release-note` blocks, GitLab `Changelog:` trailers. This is an adopted convention, not an invented one. It is **opt-in** — a commit with no trailer produces no feed entry, which is exactly how the "no empty releases" property is achieved.

**Authoring workflow — suggest at PR time.** The note is drafted at **pull-request creation**, not reconstructed later. Because a PR squash-merges into a single commit, the PR is that commit's future body — so PR creation is the moment to decide "does this change deserve a note, and what does it say?" The standing workflow (Phase 4, `docs/runbooks/pr-workflow.md`): before every `gh pr create`, propose a `Release-Note:` line for inclusion in the PR description (which becomes the squash commit body), **or** explicitly state "no user-facing note — internal/CI/infra change." This makes the capture step active (a decision on every PR) rather than passive (remembered at merge), which is what keeps the feed alive. A non-blocking reminder can extend the existing Pre-PR docs gate hook (`.claude/settings.json`), consistent with hook-safety (echo only — no `claude` re-entry).

**Generate.** A build-time script (`scripts/gen-whats-new.mjs`) re-derives the **entire** feed from git history on every build:

1. `git log` the full history, extract `Release-Note:` trailers with each commit's short SHA and author date.
2. Emit reverse-chronological `apps/web/public/whats-new.json`.

The feed is a pure function of git history — **no state file, self-healing, and fully decoupled from the ADR-017 tagging step** (which assigns the version tag only after smoke, i.e. after this script runs). Grouping is by **date**, not version, so the late/absent tag never matters. Runs before `vite build`; Vite copies `public/whats-new.json` to the dist root; the SPA fetches `/whats-new.json` at runtime.

**Surface.** A sparkle icon in `AppHeader` (`apps/web/src/components/AppHeader.tsx`), left of the theme toggle, with an "unseen" dot. Clicking opens a panel: a date-grouped feed, newest first, each entry a one-line human sentence. Passive — never interrupts.

**"Seen" tracking.** `localStorage` stores the `id` (short SHA) of the newest entry present when the panel was last opened. On load, entries appearing _before_ that id in feed order are "unseen" → the dot shows and those entries carry a "New" affordance. Per-device by design; the trade-off (dot re-lights on a new browser/device) is accepted for MVP.

### `whats-new.json` schema

```jsonc
{
  "generatedAt": "2026-07-03T12:00:00Z",
  "entries": [
    {
      "id": "a1b2c3d", // short commit SHA — stable, unique id for seen-tracking
      "date": "2026-07-03", // commit author date, YYYY-MM-DD (grouping key)
      "note": "Find any book you own by title or author, right from the shelf.",
      // "icon": "search"    // P1 — optional Tabler icon name
    },
  ],
}
```

P0 captures a **single sentence** per trailer (the `note`) — minimum friction. A separate bold title, longer description, or icon (as in the brainstorm mockup) are P1 enhancements, not required to ship.

## User Stories

- As a **returning user**, I want to see what's changed since I last looked, so I feel the app is actively improving and know about new capabilities.
- As a **first-time visitor** (a future stranger), I want to see a history of steady, recent improvements, so I trust this is a maintained, living product.
- As the **solo developer**, I want to flag a change as user-facing in one line at merge time, so keeping the feed current costs me almost nothing and never drifts from what actually shipped.
- As a **user on my phone**, I want the What's New panel to be reachable and readable on a small screen, so the feature isn't desktop-only.
- As a **user who has read everything**, I want the "new" indicator to clear once I've opened the panel, so it only signals genuinely unseen changes.

## Requirements

### Must-Have (P0)

**P0-1 — `Release-Note:` convention + PR-time authoring.** Documented in a runbook and the PR template. A `Release-Note:` trailer in a commit body flags that commit as a feed entry; its value is the displayed sentence. The note is authored at PR-creation time (see Authoring workflow above).

- [ ] Convention documented in `docs/runbooks/` and referenced from the PR template (a `Release-Note:` field/prompt in the template body).
- [ ] Trailer is optional; its absence produces no entry and no error.
- [ ] Phase-4 workflow (`docs/runbooks/pr-workflow.md`) requires a Release-Note decision before `gh pr create` — a suggested line, or an explicit "internal change, no note."
- [ ] Optional non-blocking reminder added to the Pre-PR docs gate hook (echo only, hook-safe).

**P0-2 — build-time generator (`scripts/gen-whats-new.mjs`).** Re-derives `apps/web/public/whats-new.json` from `git log` on every web build.

- [ ] Given a commit with `Release-Note: <text>`, when the script runs, then an entry with that commit's short SHA, date, and text appears in the output.
- [ ] Given a commit with no trailer, when the script runs, then no entry is produced for it.
- [ ] Given multiple `Release-Note:` trailers in one commit, then each becomes its own entry.
- [ ] Output is reverse-chronological by date.
- [ ] Wired into the web build ahead of `vite build` (script step in `apps/web/package.json` / deploy workflow) so the JSON is always current with the deployed commit.
- [ ] Deterministic: same history → byte-identical output (stable ordering, no timestamps in entries).

**P0-3 — What's New panel UI.** Sparkle icon in `AppHeader` opens a panel rendering the feed.

- [ ] Icon sits left of `ThemeToggle`, present in both the inline (`sm+`) nav and the mobile cluster.
- [ ] Panel groups entries by date, newest first; each entry shows its sentence.
- [ ] Empty/failed fetch: panel shows a graceful empty state; a missing/broken `whats-new.json` never breaks the header (error-boundary + fallback, per the app's async rules).
- [ ] Built from design-system primitives — `paper-*` surfaces, `slate-*` text (muted floor `slate-600 dark:slate-400`), existing radius/border tokens. No raw `bg-*` button classes.
- [ ] Works in light and dark mode.
- [ ] Accessible: icon has an `aria-label`; panel is keyboard-dismissible; the "new" state is not communicated by color alone (dot has a shape; entries use a "New" text affordance).

**P0-4 — unseen tracking.** `localStorage` high-water mark by entry `id`.

- [ ] Given unseen entries exist, when the header renders, then the dot is shown.
- [ ] Given the user opens the panel, when it closes (or on open), then the newest entry id is stored and the dot clears.
- [ ] Given a first-ever visitor with no stored value, then define the initial state explicitly (see Open Questions Q2).

### Nice-to-Have (P1)

- **P1-1 — richer entries**: optional bold title + description and/or a Tabler `icon` per entry (mockup treatment). Requires a slightly richer trailer format (e.g. `Release-Note: <title> | <detail>`), kept backward-compatible with the single-sentence P0 form.
- **P1-2 — icon inference**: auto-pick an icon from keywords when none is specified.
- **P1-3 — deep-link / standalone page**: a `/whats-new` route rendering the same feed — a shareable, cold-visit trust asset (SEO-friendly) for future strangers.
- **P1-4 — "new" accent color**: introduce one restrained accent purely for the unseen dot / "New" pill (the design system currently has no brand accent; red = error, green = success). See Open Questions Q1.

### Future Considerations (P2)

- **P2-1 — version-change "moment"**: a small celebratory toast/modal the first time a user loads a genuinely notable new build. The delight spike; deferred for interruption risk.
- **P2-2 — per-user seen-state** in DynamoDB for cross-device consistency, keyed on the Cognito user.
- **P2-3 — stale-tab live detection**: poll `whats-new.json` (or a version endpoint) to light the dot without a reload.
- **P2-4 — per-version grouping**: bucket entries under their release tag (walk `v*` tags) if version traceability is ever wanted, without changing the capture format.

## Success Metrics

Analytics go through `track()` → `POST /v1/events` (ADR-016); adding events requires updating both the client `AnalyticsEvent` union and the server `ALLOWED_EVENTS` allowlist.

**Leading indicators**

- **Panel open rate**: % of sessions that open What's New in the first 30 days. Target: ≥ 20% try it once; stretch ≥ 35%.
- **Dot → open conversion**: of sessions that render an unseen dot, % that open the panel. Target: ≥ 40%.
- **Pipeline liveness (process metric, no analytics needed)**: ≥ 1 `Release-Note:` entry per calendar month. If a month passes with zero, the convention isn't sticking — the single most important health check.

**Lagging indicators**

- **Qualitative**: for the current known audience, direct ask — did they notice, do they read it, does it make the app feel more alive? (n is small enough to just ask.)
- **Trust signal for cold visitors**: once P1-3 (standalone page) ships, track referral/landing views of `/whats-new`.

**Evaluate** at 2 weeks (leading + liveness) and monthly (liveness + qualitative).

## Open Questions

- **Q1 (design) — "new" accent color.** The design system has no brand accent. What color signals "new" without colliding with red (error) / green (success)? Options: a neutral `slate-900`/white dot, or introduce one restrained accent (P1-4). _Non-blocking_ — MVP can ship with a neutral dot.
- **Q2 (design/product) — first-visit initial state.** For a brand-new user with no `localStorage` value, do we (a) mark everything as seen (no dot on first load — quietest), or (b) show the dot to pull them into the feed once? Leaning (a). _Non-blocking._
- **Q3 (engineering) — trailer robustness.** How lenient is trailer parsing (case, whitespace, multi-line folding, multiple per commit)? Do we validate/lint the trailer in CI, or accept whatever's there? _Non-blocking_ — start permissive.
- **Q4 (engineering) — history depth & the first run.** Do we backfill by retroactively adding trailers to recent notable merges (via a one-time seed list in the generator, since we can't rewrite history), or start the feed empty from the first release that adopts the convention? _Non-blocking_ — a small seed list makes launch feel non-empty (see cheap test below).
- **Q5 (product) — should entries ever link out?** e.g. an entry linking to the relevant screen. Deferred, but the schema should not foreclose an optional `href`.

## Timeline Considerations

No hard deadline. Suggested phasing:

- **Phase 1 (P0)** — convention + generator + `whats-new.json` + passive panel + `localStorage` dot. The complete, shippable feature.
- **Phase 2 (P1)** — richer entries/icons, standalone `/whats-new` page, "new" accent color.
- **Phase 3 (P2)** — version-change moment, per-user seen-state, live tab detection.

**Dependencies**: none blocking. Builds on the existing Release Please / Conventional Commits flow (already live) and the existing web build/deploy pipeline.

**Cheapest pre-build validation** (do before Phase 1): retroactively write `Release-Note:` sentences for the last ~5 notable releases. If drafting 5 friendly one-liners feels tedious, the trailer convention will rot at scale — and the PR-label variant (from the brainstorm) should be reconsidered instead. This doubles as the Q4 seed list.
