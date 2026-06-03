# Spec: About Page

**Status:** Draft  
**Author:** Kevin Rich  
**Date:** 2026-06-02

---

## Problem Statement

Bookshelf is a real, usable app — but its origin story is unusual: it was built almost entirely through conversation with Claude Code, as a live experiment in how far AI-assisted development can go. Right now there is no place in the app that acknowledges this. Visitors who stumble onto the site or sign up have no context for what the project really is. An About page makes the experiment transparent and honest about what they are looking at.

---

## Goals

1. **Transparency** — visitors understand this is both a real app and an AI-assisted coding experiment, not a commercial product.
2. **Context for the experiment** — readers come away understanding what "built with Claude Code" actually means in practice.
3. **No second-class citizen** — the page feels like a natural part of the app, not a bolted-on afterthought (matches Slate Blue theme, dark mode, typography).
4. **Navigability** — the page is reachable from the landing page header and footer; authenticated users can reach it from the app header too.

---

## Non-Goals

- **Not a blog or changelog** — no post history, versioning, or ongoing narrative. One static page.
- **Not a technical deep-dive** — no architecture diagrams, infrastructure docs, or code snippets. Link out if needed.
- **Not a marketing page** — no call-to-action to sign up. The About page is informational only.
- **Not a contact form** — out of scope; a GitHub link is sufficient.

---

## User Stories

**As a curious visitor**, I want to understand why this app exists so that I can decide whether it is worth exploring or signing up.

**As a developer or AI enthusiast**, I want to read about the experiment in detail so that I can understand what was and was not done by AI, and what the experience was like.

**As an authenticated user**, I want to reach the About page from the app header so that I can share it with others or re-read it without signing out.

**As a skeptic**, I want to see honest acknowledgment of the limitations of AI-assisted development so that I can trust that the author is not overhyping the experiment.

---

## Requirements

### Must-Have (P0)

- **Route:** `/about` — public, no auth required.
- **Content — dual nature intro:** A short lede (2–3 sentences) that names both things: (a) a usable book-tracking app, (b) a live experiment in building with Claude Code.
- **Content — the experiment:** A section explaining the experiment: what "built with Claude Code" means, roughly what was and was not written by the author versus the AI, and the honest goal (get as far as possible).
- **Content — what the app does:** One paragraph covering the actual product: track owned books and a want-to-read list.
- **Content — author credit:** A line crediting Kevin Rich with a link to GitHub or a personal site.
- **Design parity:** Page uses the same layout primitives as `LandingPage.tsx` — `min-h-screen bg-white dark:bg-slate-900`, `max-w-5xl mx-auto px-6`, Slate Blue color tokens, dark mode throughout.
- **Header:** The landing page header (with Sign in / Sign up links + ThemeToggle) appears on the page for unauthenticated users. Authenticated users see `AppHeader`.
- **Landing page header link:** "About" text link added to the landing page `<nav>` pointing to `/about`.
- **Acceptance criteria:**
  - [ ] `/about` renders without auth and without redirect.
  - [ ] Page is visually consistent with `LandingPage` (same header, same background, same font sizing).
  - [ ] Dark mode works on all text and background elements.
  - [ ] "About" link visible in landing page nav.
  - [ ] Authenticated users can reach `/about` from `AppHeader`.

### Nice-to-Have (P1)

- **AppHeader nav link:** "About" added to `AppHeader` so authenticated users can navigate to it without signing out.
- **Footer on landing page:** Simple footer with "About" link — useful if the main nav gets cluttered.
- **"View source" link:** Link to the GitHub repo so readers can inspect the code.

### Future Considerations (P2)

- **Progress log** — a timeline of what was built and when, to make the experiment narrative more vivid. Out of scope for v1; would require ongoing maintenance.
- **Stats block** — lines of code, commits, tokens used. Interesting but hard to keep accurate.

---

## Content Draft

### Page title

> About Bookshelf

### Lede

> Bookshelf is two things at once: a real, usable app for tracking the books you own and want to read — and a live experiment in how far you can get building a web app almost entirely through conversation with Claude Code.

### The experiment

> The goal was simple: start from nothing and build as much of a production-quality web app as possible using Claude Code as the primary development tool. That means the architecture decisions, the CDK infrastructure, the API, the authentication flow, and the React frontend were all shaped through back-and-forth with an AI — not by writing code from scratch in an editor.
>
> Some things still required human judgment: deciding what to build, reviewing what the AI produced, catching mistakes, and steering when it went off course. But the heavy lifting — scaffolding, implementation, debugging — was largely delegated.
>
> This page exists because it seemed dishonest not to say so.

### What it does

> The app itself is straightforward: sign up, add books to your shelf (ones you own) or your wishlist (ones you want to read), and keep track of both. Nothing more.

### Credit

> Built by [Kevin Rich](https://github.com/whoiskevinrich). Source on [GitHub](https://github.com/whoiskevinrich/bookshelf).

---

## Success Metrics

This page has no quantitative success target — it is a transparency and polish feature. Success is qualitative:

- The page exists and is reachable.
- It reads honestly and does not overstate the AI's role.
- It is visually indistinguishable in quality from the rest of the app.

---

## Open Questions

- **[Kevin]** Is the GitHub repo public? If not, the "view source" P1 link and the GitHub credit link should be omitted or replaced with a personal site URL.
- **[Kevin]** Should authenticated users see "About" in `AppHeader`? (P1 — not blocking.)

---

## Timeline Considerations

No hard deadline. This is a self-contained UI feature with no backend changes and no API dependencies. Can ship in one PR alongside the implementation.
