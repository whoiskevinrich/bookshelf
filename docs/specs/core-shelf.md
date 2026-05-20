# Spec: Core Shelf

**Status:** Draft  
**Date:** 2026-05-14  
**Author:** Solo developer

---

## Problem Statement

Book readers have no lightweight, personal tool for tracking which books they own and which ones they want to read next. Spreadsheets and notes apps work but have no book metadata, cover art, or ISBN awareness. The core shelf feature gives users a structured, searchable personal library — owned books on one side, wishlist on the other — and gives prospective users a live demo of what they are signing up for.

---

## Goals

1. A new visitor can understand the product's value within 30 seconds by browsing a populated demo shelf — no account required.
2. At least 20% of visitors who view the demo shelf sign up for an account (demo-to-signup conversion).
3. At least 60% of new accounts add at least one book within their first session (activation rate).
4. An authenticated user can add, categorize, move, and remove books from their shelf in under 60 seconds per action.
5. The shelf correctly reflects distinct Owned and Want states — the two are never conflated in the data or the UI.

---

## Non-Goals

- **Social features** (sharing shelves, following other users, reviews): out of scope for v1; requires separate auth and data model decisions.
- **Reading progress / currently reading state**: a third shelf state is a future consideration; v1 has only Owned and Want.
- **Custom shelves / tags / collections**: users cannot organize beyond Owned and Want in v1.
- **Book editing**: users cannot edit book metadata (title, author, cover). Metadata comes from the provider and is read-only.
- **Bulk import** (Goodreads CSV, etc.): valuable but complex; deferred to a future spec.

---

## User Stories

### Unauthenticated visitor

- As a visitor, I want to see a pre-populated shelf with real book covers and metadata so that I can understand what the product does before creating an account.
- As a visitor, I want to see both an Owned section and a Want section in the demo so that I understand the two-state model.
- As a visitor, I want a clear call-to-action to sign up after exploring the demo so that signing up feels like a natural next step.

### Authenticated user — adding books

- As a signed-in user, I want to search for a book by title or author so that I can find books even when I do not know the ISBN.
- As a signed-in user, I want to enter an ISBN or ASIN directly so that I can add a specific edition quickly.
- As a signed-in user, I want to choose Owned or Want when adding a book so that it lands in the correct shelf section from the start.
- As a signed-in user, I want to see cover art, title, and author in search results so that I can confirm I am adding the right book.
- As a signed-in user, I want to be warned if I try to add a book I already have on my shelf so that I do not create duplicates.

### Authenticated user — managing the shelf

- As a signed-in user, I want to see my Owned and Want books in separate sections so that I can tell at a glance what I own vs. what I want.
- As a signed-in user, I want to move a book from Want to Owned (and vice versa) so that I can update my shelf when I buy a book.
- As a signed-in user, I want to remove a book from my shelf so that I can correct mistakes or remove books I no longer track.
- As a signed-in user, I want to see a cover image for each book on my shelf so that my shelf is visually scannable.
- As a signed-in user, I want a broken-image fallback when a cover is unavailable so that the shelf does not look broken.
- As a signed-in user, I want to see an empty-state message when my shelf has no books so that I know how to add my first one.

---

## Requirements

### Must-Have (P0)

**Demo shelf (unauthenticated)**

- [ ] The landing page (`/`) renders a read-only demo shelf without requiring login.
- [ ] The demo shelf is pre-populated with a curated set of Sci-Fi and Fantasy books (see [Demo Seed Data](#demo-seed-data)).
- [ ] The demo shelf displays both an Owned section and a Want section, each with at least 4–5 books.
- [ ] Demo shelf books show: cover image, title, author(s), and shelf status badge (Owned / Want).
- [ ] The demo shelf is entirely read-only — no add, remove, or move controls are visible or functional.
- [ ] A prominent "Sign up to build your shelf" CTA is displayed alongside the demo.
- [ ] Broken cover images in the demo show a placeholder (book icon or similar).

**Authentication gate**

- [ ] Shelf management routes (`/shelf`, `/wishlist`, `/search`) redirect unauthenticated users to `/auth/login`.
- [ ] After login/signup, the user is redirected back to the shelf page.

**Book search and add**

- [ ] A search interface accepts a free-text query (title or author) and calls `GET /v1/books/search`.
- [ ] Search results display: cover image, title, author(s), and publication year.
- [ ] Selecting a search result prompts the user to choose a status: Owned or Want.
- [ ] An ISBN-13, ISBN-10, or ASIN can be entered directly to add a specific book.
- [ ] ISBN input is validated: length (10 or 13 digits) and check digit verified before the API call.
- [ ] If the book already exists on the user's shelf, a warning is shown and the add is blocked.
- [ ] Successfully added books appear on the shelf immediately (optimistic UI update).

**Shelf display**

- [ ] Authenticated shelf shows two distinct sections: Owned and Want.
- [ ] Each section shows: cover image, title, author(s), and action controls (move, remove).
- [ ] Empty Owned section shows: "You have not added any owned books yet. Search to add one."
- [ ] Empty Want section shows: "Your wishlist is empty. Search for books to add."
- [ ] Broken cover images show a fallback placeholder.

**Shelf actions**

- [ ] Remove: user can remove a book from the shelf entirely, with a confirmation prompt.
- [ ] Move: user can change a book's status between Owned and Want without removing it.
- [ ] All shelf mutations go through `POST /v1/shelf`, `PATCH /v1/shelf/{isbn}`, and `DELETE /v1/shelf/{isbn}`.

**API (consumed by UI and future MCP server)**

- [ ] `GET /v1/shelf` — returns the authenticated user's shelf entries (all statuses).
- [ ] `POST /v1/shelf` — adds a book; body `{ isbn: string, status: "owned" | "want" }`.
- [ ] `PATCH /v1/shelf/{isbn}` — updates status; body `{ status: "owned" | "want" }`.
- [ ] `DELETE /v1/shelf/{isbn}` — removes the entry.
- [ ] `GET /v1/books/search?q=` — searches the active book provider; returns `BookSearchResult[]`.
- [ ] All endpoints except `GET /v1/books/search` require a valid Cognito JWT (`Authorization: Bearer`).
- [ ] All shelf endpoints scope data to the authenticated user's Cognito sub; a user cannot read or modify another user's shelf.
- [ ] `POST /v1/shelf` returns 409 if the (user, isbn) pair already exists.

---

### Nice-to-Have (P1)

- [ ] Search results are debounced (300ms) to reduce API calls during typing.
- [ ] Shelf entries are sorted: most recently added first.
- [ ] Book count displayed per section ("12 owned · 7 wanted").
- [ ] The demo shelf is visually distinguished from the authenticated shelf (e.g., "Demo" watermark or banner) so users do not confuse it with their own data.
- [ ] Search supports ASIN in addition to ISBN for direct lookup.

---

### Future Considerations (P2)

- Currently Reading status (third shelf state between Owned and Want).
- Reading notes or personal tags per book.
- Bulk import from Goodreads CSV export.
- Sort and filter controls on the shelf (by title, author, date added).
- Public shelf URLs (shareable read-only view of a user's shelf).

---

## Demo Seed Data

The demo shelf is hard-coded at build time — not stored in DynamoDB. These books are used for the unauthenticated tour.

### Owned

| Title | Author | ISBN-13 |
|-------|--------|---------|
| Dune | Frank Herbert | 9780441013593 |
| Neuromancer | William Gibson | 9780441569595 |
| The Left Hand of Darkness | Ursula K. Le Guin | 9780441478125 |
| Project Hail Mary | Andy Weir | 9780593135204 |
| The Name of the Wind | Patrick Rothfuss | 9780756404741 |

### Want

| Title | Author | ISBN-13 |
|-------|--------|---------|
| The Way of Kings | Brandon Sanderson | 9780765326355 |
| The Fifth Season | N.K. Jemisin | 9780316229296 |
| Children of Time | Adrian Tchaikovsky | 9781447273295 |
| A Fire Upon the Deep | Vernor Vinge | 9780812515282 |
| Piranesi | Susanna Clarke | 9781635575644 |

> Cover images fetched from Google Books API at build time and bundled as static assets — no CDN dependency at runtime for the demo.

---

## Success Metrics

### Leading indicators (measure within first 2 weeks post-launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Demo shelf page views | Baseline established | Analytics page view event on `/` |
| Demo-to-signup conversion | ≥ 20% of demo viewers | Signups / demo page views (same session) |
| Search-to-add completion | ≥ 70% of searches result in an add | `POST /v1/shelf` / `GET /v1/books/search` ratio |
| Add errors (duplicate, ISBN invalid) | < 5% of add attempts | 409 + 400 response rate on `POST /v1/shelf` |

### Lagging indicators (measure at 30 and 90 days)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Activation rate (≥1 book added in first session) | ≥ 60% of new accounts | Users with ≥1 shelf entry / total signups |
| D7 retention (user returns within 7 days) | ≥ 30% | Sessions with userId in 7-day window post-signup |
| Median shelf size at D30 | ≥ 5 books | DynamoDB: count of shelf entries per user at 30 days |

---

## Open Questions

| # | Question | Owner | Blocking? |
|---|----------|-------|-----------|
| 1 | Should the demo shelf cover images be fetched live from Google Books (simple) or pre-fetched and bundled as static assets (faster, no API key exposure)? Pre-fetched is recommended but adds a build step. | Engineering | Yes — affects build pipeline |
| 2 | Does the demo CTA go to `/auth/signup` or `/auth/login` (with a signup link)? | Product | No |
| 3 | Should `GET /v1/shelf` include book metadata (title, authors, cover URL) inline, or return only ISBNs and require a separate book lookup? Inline is simpler for the UI and MCP. | Engineering | Yes — affects API contract |
| 4 | What is the ISBN check digit validation approach? (Mod-10 for ISBN-10, Mod-11 for ISBN-13 — confirm library vs. hand-rolled) | Engineering | No |
| 5 | Is there a rate limit on the Google Books API free tier that could affect demo page load if covers are fetched live? | Engineering | Yes — if pre-fetching is chosen, when does the fetch run? |

---

## Timeline Considerations

- No hard external deadline; this is the first feature so it sets the pace.
- The API (P0 endpoints) should be built and testable before the web UI, per the API-first architecture decision in ADR-001.
- Demo seed data ISBNs should be validated against the Google Books API before committing — confirm all 10 books have cover images.
- The MCP server (`apps/mcp`) is not in scope for this spec but the API surface defined here is what MCP tools will call. No breaking changes to the API contract after the MCP spec is written.
