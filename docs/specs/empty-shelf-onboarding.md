# Spec: Empty Shelf Onboarding State

**Status:** Draft  
**Date:** 2026-05-31

---

## Problem Statement

A new user who signs up and lands on `/shelf` sees two section headers with terse fallback text ("No books owned yet. Add one above!"). There is no warmth, no orientation, and no clear starting point. The app has a full book search feature directly available, but nothing invites the user to use it. First impressions matter most — a blank shelf with dry placeholder text creates doubt about whether the app is worth building a habit around.

---

## Goals

1. New users understand what to do next within 5 seconds of landing on an empty shelf.
2. The empty state prompts at least one book-add action in the same session for new users.
3. The experience feels personal and encouraging, matching the tone of a product built for book lovers.

## Non-Goals

- **Guided onboarding flow / wizard:** A multi-step tour or modal walkthrough is out of scope — the shelf itself should feel self-explanatory with good empty-state design alone.
- **Personalised book suggestions:** Recommending specific books to add is a separate feature requiring recommendation infrastructure.
- **Different messages per session count:** Tracking whether a user has visited before and varying the message accordingly is over-engineered for v1.
- **Animated illustrations:** Motion/Lottie assets add complexity; static copy and simple iconography are sufficient.

---

## User Stories

**As a new user who just signed up,**  
I want to see a welcoming prompt on my empty shelf  
so that I know exactly what to do and feel excited to start building my collection.

**As a returning user whose shelf is still empty,**  
I want to see the same encouraging prompt  
so that I'm reminded there's a quick action available rather than staring at a blank page.

**As a user who has books on their shelf,**  
I want the empty-state prompt to disappear completely  
so that it doesn't clutter my shelf once I've gotten started.

---

## Requirements

### Must-Have (P0)

**1. Whole-shelf empty state replaces section-level placeholders**

When both Owned and Want to Read are empty (total = 0), render a single centred empty-state panel instead of two section headers with per-section fallback text.

- Acceptance criteria:
  - [ ] Empty-state panel shown when `owned.length === 0 && want.length === 0`.
  - [ ] Panel is NOT shown once any book has been added (either section non-empty).
  - [ ] Section-level fallback text ("No books owned yet…") remains for the case where one section has books and the other is empty.

**2. Encouraging copy with a clear CTA**

The panel must include:
- A headline: warm and playful, reinforces what Bookshelf is for.
- A short supporting line: practical — tells the user what the app can track.
- A primary CTA button: opens the Add a book search inline (same action as the "Add a book" header button), so the user doesn't have to scroll up.

Suggested copy (can be adjusted during implementation):
- Headline: **"Your shelf is empty — let's fix that."**
- Subline: *"Add the books you own, and the ones you're dreaming of reading next."*
- CTA: **"Add your first book →"**

- Acceptance criteria:
  - [ ] Headline, subline, and CTA button are all present and readable.
  - [ ] CTA button opens the BookSearch panel (same as clicking "Add a book" in the header).
  - [ ] Copy fits on one screen without scrolling on mobile (≥ 375px wide).

### Nice-to-Have (P1)

**3. A small decorative element**

A simple emoji or unicode book icon (e.g. 📚) above the headline to give the state visual warmth without requiring image assets.

**4. Transition to populated state**

When the user adds their first book from the empty-state CTA, the shelf smoothly transitions to the normal populated view without a jarring full reload (already handled by TanStack Query optimistic updates).

### Future Considerations (P2)

- **Context-aware copy:** Different headline for "owned" vs "want" sections when only one is empty.
- **Quick-add suggestions:** Surface 3–5 popular sci-fi/fantasy titles as one-click add buttons below the CTA.
- **Confetti / celebration on first add:** A micro-interaction to celebrate the user's first book add.

---

## Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Empty-state → first book add (same session) | ≥ 60% of new users | Manual review / future analytics |
| Empty-state renders correctly | Shown on empty shelf, absent on non-empty shelf | QA |

---

## Implementation Notes

- Condition: `!isLoading && !isError && owned.length === 0 && want.length === 0`
- CTA button calls `setShowSearch(true)` — same handler as the "Add a book" header button; no new state needed.
- The `ShelfSection` components still render for the per-section empty state (one section has books, other is empty) — the whole-shelf empty state is an additional guard above them.
- No new API calls required; `total` from the shelf response could be used as an alternative condition (`total === 0`) but the client-side `owned.length + want.length` check is simpler and avoids a cross-page dependency.
