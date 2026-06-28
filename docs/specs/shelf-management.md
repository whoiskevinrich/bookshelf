# Spec: Shelf Management

**Status:** Ready for implementation  
**Date:** 2026-06-23  
**Author:** Solo developer

---

## Problem Statement

Users can create named shelves and add books to them, but every shelf renders as a flat horizontal row on a single page. There is no way to open a shelf in full detail, and destructive actions (delete) are immediate with no confirmation. The shelf list page is becoming the only surface for all shelf operations — rename, delete, add/remove books — which is cluttered and will not scale as books and shelves accumulate. This spec defines three foundational improvements: a dedicated full-page view per shelf, an inline rename interaction, and a guarded delete flow.

---

## Goals

1. A user can navigate to a stable URL for any shelf and see all its books in a full-page layout, making the page bookmarkable and shareable in a future sharing feature.
2. A user can rename a shelf without leaving the page, with immediate feedback if the name is taken or invalid.
3. A user cannot accidentally delete a shelf: the confirmation dialog echoes the shelf name and book count before proceeding.
4. All three interactions are accessible from both the library overview page and the dedicated shelf page.
5. The dedicated shelf page is the foundation for future features (rename, delete, share, auto-shelves) — its route and layout must accommodate those use cases without redesign.

---

## Non-Goals

- **Shareable/public shelf URLs**: read-only public views are a separate feature (see Backlog: "Shareable shelves"). This spec defines the authenticated single-shelf route only.
- **Shelf cover images or metadata beyond name**: a custom shelf icon or description field is future scope.
- **Sorting and filtering books within a shelf**: the shelf page shows books in add-order for v1; sort/filter is a separate backlog item.
- **Moving books between shelves from the dedicated page**: books can be removed from the shelf but cross-shelf move is deferred.
- **Auto-shelves (system-generated)**: this spec covers user-created shelves only; auto-shelves from tags/attributes are a separate ADR-gated epic.

---

## User Stories

### Opening a shelf

- As a user, I want to click a shelf row and open it full-page so that I can browse all its books without the distraction of other shelves.
- As a user, I want each shelf to have a stable URL (`/shelves/:shelfId`) so that I can return to it directly and use my browser's back button.
- As a user, I want the shelf page to show the shelf name, book count, and all books so that I have complete context at a glance.
- As a user, I want a "Back to library" link on the shelf page so that I can return to the overview without pressing the browser back button.
- As a user, I want to see an empty state when a shelf has no books so that I know how to add the first one.

### Renaming a shelf

- As a user, I want to rename a shelf inline (without a navigation step) so that I can fix a typo or change my mind about a name quickly.
- As a user, I want to see an error if I try to give a shelf a name I have already used so that I understand why the rename did not save.
- As a user, I want to cancel a rename and restore the original name if I change my mind so that I do not have to re-type.

### Deleting a shelf

- As a user, I want to be asked to confirm before a shelf is deleted so that I cannot remove a shelf by accident.
- As a user, I want the confirmation dialog to show me the shelf name and how many books are in it so that I understand exactly what I am about to lose.
- As a user, I want deleting a shelf to only remove the shelf and its membership records — not the books themselves from my main library — so that my book collection is not affected.

---

## Requirements

### Must-Have (P0)

**Dedicated shelf page (`/shelves/:shelfId`)**

- [ ] Route `/shelves/:shelfId` renders a full-page view for the given shelf, fetching data from `GET /v1/shelves/:shelfId/books`.
- [ ] The page title is the shelf name; the document `<title>` follows the pattern `{shelf name} — Bookshelf`.
- [ ] Navigating to a non-existent shelf ID (shelf deleted, wrong ID) shows a "Shelf not found" error state with a link back to the library.
- [ ] A "Back to library" breadcrumb/link navigates to `/shelf` without a full-page reload.
- [ ] Books are displayed using the existing `ShelfBookCard` component in horizontal scroll rows (matching the library page layout).
- [ ] The shelf page shows a book count: `{n} book` / `{n} books`.
- [ ] An empty shelf shows the `ShelfEmptyState` component with copy adjusted for named shelves ("This shelf is empty. Add books from your library.").
- [ ] The shelf page shows `ShelfSkeleton` while loading and `ShelfErrorState` on fetch failure, consistent with the library page.
- [ ] On the library overview, each shelf row has a click target (e.g. the shelf name or a chevron) that navigates to `/shelves/:shelfId`.
- [ ] The dedicated shelf page is authenticated; unauthenticated access redirects to `/auth/login`.

**Rename shelf**

- [ ] The shelf header (on both the library overview row and the dedicated shelf page) shows an explicit pencil/edit icon next to the shelf name; clicking it opens a text field beneath or beside the name.
- [ ] The edit field is pre-populated with the current shelf name and receives focus immediately on activation.
- [ ] Saving calls `PATCH /v1/shelves/:shelfId` with `{ name }`.
- [ ] On success the UI updates the displayed name immediately and closes the edit field.
- [ ] On a 409 response the field stays open and shows an inline error: "You already have a shelf with this name."
- [ ] On any other error (network failure, non-2xx) the field reverts to the original name and shows an inline error message near the field.
- [ ] Pressing Escape cancels the rename and restores the original name without an API call.
- [ ] The field enforces the same constraints as the API: 1–100 characters (non-empty after trim); the save action is disabled for an empty or overlong name.
- [ ] The rename control is accessible: the edit field has a visible label or `aria-label`; keyboard users can reach the edit icon via Tab and activate it with Enter or Space.

**Delete shelf with confirmation**

- [ ] The delete control is visible on the shelf row (library overview) and on the dedicated shelf page header, matching the existing `SectionHeader` delete button pattern.
- [ ] Clicking delete opens a confirmation dialog — not an immediate deletion.
- [ ] The confirmation dialog body echoes: the shelf name and the book count in the shelf.
- [ ] The dialog has two actions: a destructive "Delete shelf" button and a "Cancel" button.
- [ ] Confirming calls `DELETE /v1/shelves/:shelfId` and, on success: removes the shelf row from the library overview (optimistic) or silently redirects to `/shelf` if triggered from the dedicated shelf page — no toast or success banner.
- [ ] On error, the dialog closes and an inline error message appears near the shelf header.
- [ ] The dialog is accessible: focus moves into it on open; Escape dismisses it; focus returns to the triggering element on close.
- [ ] Deleting a shelf does not remove the books from the user's main shelf (`/v1/shelf`) — only the shelf membership records are removed. The UI must not suggest otherwise in the dialog copy.

---

### Nice-to-Have (P1)

- [ ] The dedicated shelf page supports add-to-shelf: a mini `BookSearch` panel lets users add any book already on their main library to this shelf (calls `POST /v1/shelves/:shelfId/books/:isbn`).
- [ ] The dedicated shelf page supports remove-from-shelf per book card (calls `DELETE /v1/shelves/:shelfId/books/:isbn`), in addition to the remove-from-main-library action already on `ShelfBookCard`.
- [ ] The library overview shelf rows gain a "Rename" option in a kebab/context menu to reduce header clutter alongside the existing drag handle and delete button.
- [ ] Rename validation gives a specific "already used" error client-side (by comparing against the locally cached shelf list) before the API call, as a fast-path complement to the server-side 409.

---

### Future Considerations (P2)

- Shelf description / notes field on the dedicated page.
- Sort and filter controls on the dedicated shelf page (by title, author, date added).
- Drag-to-reorder books within a shelf.
- Shelf cover or color accent picker.
- Shareable public URL for the shelf (a later spec gates this behind auth and rate-limiting work).

---

## API Surface

One API change is required (Q3): `PATCH /v1/shelves/:shelfId` and `POST /v1/shelves` must enforce per-user name uniqueness and return **409** when a shelf with the same name already exists for that user. All other endpoints are already implemented as-is.

| Endpoint                                  | Change                         | Purpose                                                 |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| `GET /v1/shelves`                         | None                           | Load all shelves with book IDs for the library overview |
| `GET /v1/shelves/:shelfId/books`          | None                           | Load full book entries for the dedicated shelf page     |
| `POST /v1/shelves`                        | **Add uniqueness check → 409** | Create shelf; reject duplicate names per user           |
| `PATCH /v1/shelves/:shelfId`              | **Add uniqueness check → 409** | Rename; reject duplicate names per user                 |
| `DELETE /v1/shelves/:shelfId`             | None                           | Delete shelf + membership records (not books)           |
| `POST /v1/shelves/:shelfId/books/:isbn`   | None                           | (P1) Add a book to the shelf                            |
| `DELETE /v1/shelves/:shelfId/books/:isbn` | None                           | (P1) Remove a book from the shelf                       |

**MCP URL stability (Q2):** The `/shelves/:shelfId` route is MCP-stable. MCP tools that need to link to a shelf should construct the URL as `{appBaseUrl}/shelves/{shelfId}` using the shelf ID returned by `GET /v1/shelves`. Do not change this path structure without a coordinated MCP tool update.

---

## Success Metrics

### Leading indicators (measure within first 2 weeks post-ship)

| Metric                     | Target                                                                          | Measurement                                                                |
| -------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Shelf page navigation rate | ≥ 40% of users with ≥1 shelf open the dedicated page within their first session | `track("shelf_opened")` analytics event / users with shelves               |
| Rename completion rate     | ≥ 80% of rename interactions complete successfully (no revert)                  | `track("shelf_renamed")` success / rename-initiated                        |
| Delete-cancel rate         | ≥ 20% of delete-dialog opens result in cancel (confirmation is doing its job)   | dialog-cancel / dialog-open; if <5% the dialog may not be prominent enough |
| Delete error rate          | < 2% of confirmed deletes return an error                                       | `DELETE /v1/shelves/:shelfId` 5xx / total deletes                          |

### Lagging indicators (measure at 30 days)

| Metric                    | Target                                         | Measurement                               |
| ------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Named shelf adoption      | ≥ 50% of active users have ≥2 named shelves    | DynamoDB: count of shelf items per userId |
| Accidental-delete reports | 0 support contacts about unexpected shelf loss | Manual review                             |

---

## Open Questions

All questions resolved.

| #   | Question                                                                               | Resolution                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Inline editable title vs. explicit edit icon + field?                                  | **Explicit edit icon + field** — more discoverable for new users.                                                                                                    |
| Q2  | Should the MCP server expose the shelf URL?                                            | **Yes.** MCP is central to the project; `/shelves/:shelfId` is a stable, MCP-referenced path. See API Surface note.                                                  |
| Q3  | Per-user name uniqueness: API-enforced or client-side only?                            | **API-enforced** — `POST /v1/shelves` and `PATCH /v1/shelves/:shelfId` return 409 on duplicate names. Client-side check is a fast-path complement, not a substitute. |
| Q4  | Post-delete navigation from dedicated shelf page: toast + redirect or silent redirect? | **Silent redirect** to `/shelf` — no toast or success banner.                                                                                                        |

## Implementation Decisions

Resolved during design handoff; record here so implementation does not re-derive them.

**`ShelfEmptyState` on `SingleShelfPage`**

Pass a real `onAdd` handler — do not suppress the CTA. In P0 the handler navigates to `/shelf` (the library, where books can be added to the shelf via the existing add flow). When P1 lands (add-to-shelf panel on the dedicated page), replace the handler with one that opens the local panel — no component change required.

```tsx
// P0
<ShelfEmptyState onAdd={() => navigate("/shelf")} />

// P1 (future swap — same component, different handler)
<ShelfEmptyState onAdd={() => setShowAddPanel(true)} />
```

Copy overrides for the named-shelf empty state:

- Heading: `"This shelf is empty."`
- Body: `"Add books from your library to get started."`
- CTA: `"Go to library →"` (P0) → `"Add a book →"` (P1)

`ShelfEmptyState` needs to accept optional `heading`, `body`, and `cta` props, defaulting to the existing library copy so all other uses are unaffected.

**`ShelfNameEditor` — `className` on the name display**

The component accepts a `className` prop applied to the idle name element. Callers supply their own typography; no `variant` enum.

```tsx
// SingleShelfPage (page title)
<ShelfNameEditor
  shelfId={shelfId}
  name={name}
  className="text-xl font-semibold text-slate-900 dark:text-white"
/>

// ShelfPage SectionHeader (section label)
<ShelfNameEditor
  shelfId={shelfId}
  name={name}
  className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400"
/>
```

**Analytics events — wire in this PR**

Add to the client `AnalyticsEvent` union (`apps/web/src/lib/analytics.ts`) and the server `ALLOWED_EVENTS` allowlist:

| Event name        | Fired when                                       | Payload                                  |
| ----------------- | ------------------------------------------------ | ---------------------------------------- |
| `"shelf_opened"`  | User navigates to `/shelves/:shelfId` (on mount) | `{ shelfId: string }`                    |
| `"shelf_renamed"` | `useUpdateShelf` mutation succeeds               | `{ shelfId: string }`                    |
| `"shelf_deleted"` | `useDeleteShelf` mutation succeeds               | `{ shelfId: string, bookCount: number }` |

`"shelf_deleted"` is added here opportunistically — it costs nothing and is useful for the accidental-delete lagging metric.

---

## Timeline Considerations

- No hard deadline; sequence these three tasks together as a single small feature (estimate: **M** total, ≈ 1–2 days).
- Implement in this order: (1) API uniqueness enforcement on `POST`/`PATCH /v1/shelves`, (2) dedicated shelf page route, (3) rename and delete UX on the shelf page.
- Rename and delete depend on the shelf page existing — do not build them before the route is wired.
- Shareable shelves (separate backlog item) depend on `/shelves/:shelfId` existing and being stable; do not change this path structure without a coordinated MCP tool update.
- The open-book-details feature (separate backlog item) will also land on the dedicated shelf page eventually — design the layout with a book detail side-panel in mind.
