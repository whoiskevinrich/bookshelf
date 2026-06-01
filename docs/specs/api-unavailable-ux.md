# Spec: API Unavailable UX

**Status:** Draft  
**Date:** 2026-05-31

---

## Problem Statement

When the Bookshelf API is unreachable (network error, server down, cold-start timeout), the app surfaces a bare red error string — "Failed to load shelf. Please refresh." — with no retry action, no context, and no indication of whether the failure is transient. Users are left staring at a broken page with no path forward. For a solo developer, this is also the first thing visible during local development when the API server isn't running yet.

---

## Goals

1. Users always have a clear, actionable path when the API is unavailable — never a dead end.
2. Transient failures (network hiccup, cold start) self-resolve without a full page reload.
3. Mutations that fail (add, move, remove) surface inline feedback without losing the user's intent.
4. The app distinguishes between "still loading" and "failed" — no false negatives.

## Non-Goals

- **Offline-first / local caching:** Serving stale shelf data from a local cache when the API is down is out of scope. The app requires the API; this spec improves the error experience, not the architecture.
- **Server health endpoint / status page:** A dedicated `/healthz` ping or public status page is a separate infrastructure concern.
- **Push notifications when API recovers:** Proactive "back online" toasts via WebSocket or polling are P2.
- **Partial degradation (read-only mode):** Showing cached shelf data while writes are blocked is a separate, more complex feature.

---

## User Stories

**As a user visiting my shelf when the API is down,**  
I want to see a clear explanation and a retry button  
so that I don't have to reload the whole page to try again.

**As a user whose shelf loaded successfully but whose add/move/remove action fails,**  
I want to see an inline error message near the action I took  
so that I understand what went wrong without losing my place on the page.

**As a user waiting for the shelf to load,**  
I want to see a loading skeleton that matches the page layout  
so that I know content is coming and the page isn't broken.

**As a developer running the app locally without the API,**  
I want a clear message telling me the API is unreachable  
so that I immediately know what to start, rather than debugging a generic error.

---

## Requirements

### Must-Have (P0)

**1. Retry button on shelf/wishlist load failure**

- When `GET /v1/shelf` fails, display an error state with a "Try again" button.
- Clicking "Try again" re-runs the query without a full page reload (TanStack Query `refetch`).
- Acceptance criteria:
  - [ ] Error state is visually distinct from empty state (icon + heading + body + button).
  - [ ] "Try again" is keyboard-focusable and accessible.
  - [ ] Clicking it triggers a new network request and shows a loading indicator.
  - [ ] If the retry succeeds, the shelf renders normally.
  - [ ] If the retry fails again, the error state remains (no infinite spinner).

**2. Inline error feedback for failed mutations**

- When add/move/remove fails, display an error message near the action that triggered it.
- The optimistic update is rolled back (already implemented via TanStack Query).
- Acceptance criteria:
  - [ ] Error message appears below or near the relevant action button.
  - [ ] Message text is specific: "Couldn't add book — please try again" (not generic "Error").
  - [ ] Error clears automatically after 5 seconds or when the user retries.
  - [ ] The failed action's button returns to its normal (non-pending) state.

**3. Loading skeleton for shelf sections**

- Replace "Loading your shelf…" text with a skeleton grid matching the ShelfBookCard layout.
- Acceptance criteria:
  - [ ] Skeleton shows the same two-column grid structure as the loaded shelf.
  - [ ] Skeleton animates (pulse) to signal activity.
  - [ ] Skeleton is removed as soon as data loads or an error occurs.
  - [ ] Skeleton is not shown during background refetches (only on initial/manual load).

### Nice-to-Have (P1)

**4. Automatic retry with backoff on network errors**

- Configure TanStack Query to retry up to 2 times on fetch failure before showing the error state.
- No retry on 4xx responses (those are not transient).
- Acceptance criteria:
  - [ ] Network errors trigger up to 2 automatic retries with exponential backoff (1s, 2s).
  - [ ] 4xx errors (401, 403, 404, 409) do not trigger automatic retries.
  - [ ] During retries, the loading skeleton remains visible (not the error state).

**5. Book search error state**

- When a search query fails, show an error message with a "Try again" link that re-runs the last query.
- Currently: error message only, no retry path.

### Future Considerations (P2)

- **"Back online" detection:** Use the `online` browser event to auto-retry after a network recovery.
- **Global error banner:** A dismissible banner for prolonged outages ("Having trouble connecting — your shelf may be out of date").
- **Mutation queue:** Queue failed mutations and replay them when the API becomes reachable.

---

## Success Metrics

| Metric                        | Target                                                      | Measurement                |
| ----------------------------- | ----------------------------------------------------------- | -------------------------- |
| Time-to-retry on load failure | User can initiate retry within 3 seconds of error appearing | Manual QA                  |
| Mutation error visibility     | Failed add/move/remove always surfaces a message            | Manual QA / component test |
| Loading skeleton renders      | Skeleton visible on every initial load before data arrives  | Manual QA                  |

---

## Open Questions

- **[Engineering]** Should the retry button show a count ("Try again (1/2)")? Or keep it simple and just show the button without countdown?
- **[Engineering]** What error copy should distinguish a network failure ("Can't reach the server") from a server error ("Something went wrong on our end")? The `fetch` call throws on network failure and returns a non-2xx status on server error — both are detectable.

---

## Implementation Notes

- TanStack Query retry config: set `retry: 2, retryDelay: (n) => 1000 * 2 ** n` for network errors; set `retry: false` (or a predicate) for 4xx errors. Configure at the `QueryClient` level in `main.tsx`.
- Loading skeleton: a new `ShelfSkeleton` component renders 4 placeholder cards (same dimensions as `ShelfBookCard`) using Tailwind's `animate-pulse` utility.
- Mutation errors: `useMoveShelfEntry` and `useRemoveFromShelf` already expose `isError` and `error` — thread these through `ShelfBookCard` props and render inline. `useAddToShelf` error is already surfaced in `ShelfPage`; refine the copy and add a dismiss timer.
- Retry button: `useShelf` returns `refetch` from `useInfiniteQuery` — pass it to the error state component.
