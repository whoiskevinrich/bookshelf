---
# Flightplan worklog — one epic, one worklog, one definition of done.
# Copy to <worklog.dir>/<KEY>.md (SessionStart scaffolds this automatically if missing).
# Schema + design: see the Flightplan plugin's own README and ADR-001 (in the plugin repo).
key: BOOKSHELF-117 # the tracker key; must match the branch key regex
status:
  in-progress # DERIVED from the Gates below — nothing settled is todo, some movement
  # is in-progress, all settled with a release_note is in-review. Only
  # `done` and `released` are read from here (a merge and a release are
  # facts the checklist can't see). Any other value is ignored, so this
  # field cannot drift. If the status looks wrong, a gate is wrong.
profile:
  fix # the gate posture (see flightplan.yaml `postures:`). Which gates this
  # epic HAS — a judgment, so no hook sets it. SessionStart prompts every
  # session until it does, and the Gates rows below are trimmed to match.
depends-on: [] # [KEY-…] cross-epic deps that must land first
release_note: Book lookups no longer hang when the book catalogue is slow to answer — you get a Try again option within seconds instead.
# approved:                  # the owner's sign-offs on `approve: true` gates (ADR-007). [x] means the
#   design:                  # artifact is committed; THIS means the owner looked and said yes. Written
#     on: 2026-09-20         # only by /implement (which asks) or /handoff (for a yes given this session);
#     at: 3f2a9c1            # `at` is the commit the yes was given against — change the artifact after it
# and the sign-off is stale: re-confirmed with the diff, never revoked.
---

# BOOKSHELF-117 · E2E addBookByIsbn stuck on "Searching…"

Done means the intermittent `addBookByIsbn` timeout is fixed at its root cause, not hidden behind a
longer wait, and `e2e-deployed` stays clean for 5 nightly runs in a row.

**Design package:** [BOOKSHELF-117](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-117) (bug ticket, no spec/ADR) · fix [#146](https://github.com/whoiskevinrich/bookshelf/pull/146) · What's New seed [#148](https://github.com/whoiskevinrich/bookshelf/pull/148) <!-- links; source of truth for *what*; this file is source of truth for *where it stands* -->

**Root cause (evidence in #146):** the Google Books `fetch` in `fetchVolumes` had no timeout. A
stalled upstream connection hung the request until the 29s Lambda timeout (dev logs:
`Status: timeout`, 29000ms, lined up with the failing tests), leaving BookSearch on "Searching…".
It hit the localhost job too, so it was never deployed-only.

## Gates — definition of done

<!-- These rows are GENERATED at scaffold time from flightplan.yaml `gates:`, filtered to the
     `postures:` default — the list below is only what you get with no config. Once `profile:` is
     set, trim them to that posture. States: [ ] not started · [/] in progress · [~] deliberately
     skipped · [x] done. [~] and [x] both count as SETTLED — an epic can reach a full count with a
     documented skip (ADR-004). PostToolUse(Skill) flips a gate to [/] when its skill runs; ONLY
     /handoff writes [~] or [x]. -->

- [x] backend — per-attempt 3s abort timer in `apps/api/src/lib/books/providers/google-books.ts` (#146, `76971e1`)
- [~] frontend — no change needed; BookSearch already shows the 502 as an error with "Try again"
- [x] testing `testing-strategy` — 3 unit tests in `apps/api/test/lib/books/google-books.test.ts`; the two hang tests fail on the old code

<!-- Deliberate-skip example — always say why; `until:` records what would reopen the concern later
     (as a fresh up-next item or its own issue — the gate itself stays settled):
- [~] security `security-review` — until: a mutation endpoint exists (read-only slice so far) -->

## Up next — ordered (position = priority)

<!-- Numbered queue. Position is the priority — no P1/P2 tags. Each item: [gate] one-liner — file path.
     ⛔ marks blocked (say on what). → KEY promotes a separable item to its own issue.
     The top item is surfaced in the SessionStart banner, clipped if long (the trailing path
     survives; the middle is dropped) — so keep it to one line.
     The CHECKBOX settles an item and nothing else does: [x] done, [~] dropped, same states as a gate
     row. A strikethrough is emphasis, not a state — `~~half~~ now do the rest` is a live item
     (ADR-008). This queue holds LIVE work only: delete a done item, move a dropped one to
     ## Dropped at the end of this file (ADR-010). The banner counts any settled item left here. -->

1. [ ] [testing] Confirm 5 nightly `e2e-deployed` runs in a row with no `addBookByIsbn` flake, then close BOOKSHELF-117 — `.github/workflows/e2e.yml` ⛔ waits on nightlies from 2026-09-28

## Session log — append-only (cap: last 8 sessions; older → archive/)

<!-- One entry per session, newest at the top. PostToolUse(Skill) creates the entry + appends the
     `- skills:` line mechanically; /handoff writes the `- handoff:` sentence the next SessionStart
     banner echoes. Shape:
### 2026-07-10 · what happened this session
- skills: write-spec, architecture
- handoff: the sentence the next session should wake up to
-->

### 2026-09-27 · session

- skills: handoff
- handoff: Root cause found and fixed (upstream fetch had no timeout, #146) and the What's New note recovered (#148), both merged. The only thing left is watching 5 nightly e2e-deployed runs: check `gh run list --workflow e2e.yml` from 2026-09-28, and if an addBookByIsbn "Searching…" failure recurs, pull the dev Lambda logs for that minute first.

## Dropped — newest first (the reason is the point)

<!-- Up-next items decided AGAINST, moved here by /handoff when dropped (ADR-010). Done items are
     deleted instead — git and the session log already record them; a dropped item has no other
     record, so its reason lives here. Shape:
- [~] [testing] <thing you decided not to do> — dropped 2026-07-29, <why>
-->
