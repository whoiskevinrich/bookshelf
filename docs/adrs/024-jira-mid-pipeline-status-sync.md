# ADR-024: Mid-Pipeline Jira Status Sync — On Dev, Ready for Release, and the QA Gate

**Status**: Accepted
**Date**: 2026-07-04
**Relates to**: [ADR-022](022-jira-release-sync.md) (sync → `Done` on prod promote — this ADR extends it backward through the pipeline), [ADR-023](023-worktree-ticket-branch-enforcement.md) (the branch key this relies on), [ADR-020](020-release-please-promotion-gate.md) (dev-continuous / Release-Please prod gate). Tracks BOOKSHELF-77.

## Context

ADR-022 closed the **last** edge — a ticket moves to `Done` when its code is verifiably live in prod. But every edge _before_ `Done` is still manual, and in practice it doesn't happen: at the time of writing, BOOKSHELF-75/4/56/52/53/54 were all merged (some shipped) yet stuck in `In Progress`/`In Review`.

The root cause is a **missing status**. The workflow is `To Do → In Progress → In Review → Done`, so there is no state meaning "merged, deployed to dev, awaiting a human to QA it." A ticket therefore sits in `In Review` through PR-open, merge, dev-deploy, _and_ QA — right up until a prod promote sweeps it to `Done`. Two consequences:

- **"What needs human QA?" is unanswerable** — the QA queue is invisible, conflated with code review.
- **"Can the Release-Please PR be merged?" is a judgment call**, not a query — there's no state that means "QA-passed, cleared for prod."

Goal: keep status in lock-step with pipeline position with **exactly one human touch — the QA sign-off** — reusing ADR-022's machinery rather than inventing a parallel one.

## Decision

**Add two statuses and automate the edges into them, leaving one manual gate.**

### New statuses (both `In Progress` category)

- **`On dev`** — merged, deployed to dev, smoke-passed, awaiting human QA.
- **`Ready for release`** — QA passed; cleared for the next prod release.

### Edge map (actor in bold)

| Edge                         | Trigger                                                 | Actor                              |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `In Review → On dev`         | dev deploy succeeds **and smoke passes** (`deploy.yml`) | **automated** (this ADR)           |
| `On dev → Ready for release` | QA sign-off                                             | **human — the one gate**           |
| `On dev → In Progress`       | QA fails (kickback)                                     | **human**                          |
| `Ready for release → Done`   | prod promote smoke-passes                               | **automated** (ADR-022, unchanged) |

Optional upstream edges (`branch push → In Progress`, `PR opened → In Review`) are **deferred** — they're polish, not required for the QA-tracking goal, and the branch guard already pins the key regardless.

### Release-gate tie-in

The Release-Please PR is merge-ready exactly when `status = "Ready for release"` is non-empty; those tickets _are_ its contents. The "should I cut the release?" decision becomes a JQL query.

### Where and when

The `→ On dev` step hooks at the **end of `deploy.yml`, gated on smoke success** — the same seam as the existing `Record last good dev SHA` step (`if: steps.smoke.outcome != 'failure'`). A ticket reaches `On dev` only when its code is live on dev _and_ smoke-passed, mirroring ADR-022's "only when verifiably live" principle one environment earlier. A failed dev deploy (which auto-rolls-back per ADR-020) never advances a ticket.

### How

- **Key source is the merge-commit subject** (`github.event.head_commit.message`), matched with the same `\bBOOKSHELF-\d+\b` regex as ADR-022 — **not** a PR-API lookup. The squash subject already carries the key (`… (BOOKSHELF-75) (#103)`), and ADR-022's sync already depends on keys-in-subjects, so this is consistent and needs no extra API call. (A `gh pr view <sha> --json headRefName` fallback to the branch name is a documented hardening option if a subject ever lacks its key — see Alternatives.)
- **Shared helpers, no duplication.** Extract the Jira REST core (`buildAuth`, `currentStatus`, `findTransitionId` by _destination status_, `transition`, idempotent `syncOne`, soft-fail) into `scripts/lib/jira-sync.mjs`. `jira-release-sync.mjs` is refactored to import it (key source = release body, target = `Done`); a new `jira-dev-sync.mjs` imports it (key source = commit message, target = `On dev`). `JIRA_TARGET_STATUS` is already env-configurable, so the only real difference between the two entry points is where the keys come from.
- **Idempotent + soft-fail preserved.** Already-`On dev` is a no-op; a missing secret / Jira outage / unreachable transition logs a `::warning::` and exits 0. A dev deploy that already succeeded and smoke-passed must never red-build over a Jira hiccup (same principle as ADR-022 / ADR-017).
- **Single owner per edge.** The `→ On dev` edge is owned solely by `deploy.yml`. Do **not** also add a Jira Automation rule for it — two owners would double-fire and race.

### Credentials

Reuse the existing `vars.JIRA_BASE_URL` + `secrets.JIRA_USER_EMAIL` + `secrets.JIRA_API_TOKEN` from ADR-022. They must be made available to the **`dev`** GitHub environment (previously only the `prod`/promote job consumed them). No new AWS/OIDC permissions — the step talks only to the Jira REST API.

### Manual dependency (BOOKSHELF-80)

The two statuses and their transitions must be added first in Jira's **team-managed workflow UI** — a REST transition `400`s if the destination isn't reachable from the current status. The script **soft-fails (warns, no-op) until they exist**, so the code can ship before the Jira config lands without red-building a deploy.

## Alternatives considered

- **Resolve the key via the merged PR's head branch** (`gh pr view <sha> --json headRefName`). More robust if a commit subject omits its key, but adds an API call and diverges from ADR-022's mechanism. The branch guard (ADR-023) already makes subject-keys reliable (branch → PR title → squash subject), so this is deferred as a fallback, not the default.
- **Jira-native automation** (GitHub-for-Jira app + Automation rules). Near-zero code for branch/PR edges, but it **can't observe "dev deploy + smoke passed"** — the exact signal that defines `On dev`. Rejected for this edge; it could still drive the deferred upstream edges if wanted.
- **One combined status** instead of two. Collapsing `On dev` and `Ready for release` loses the ability to answer "what's QA'd and awaiting release?" as a query — which is the entire point of the release-gate tie-in.
- **Auto-advance `On dev → Ready for release`.** That transition _is_ the QA sign-off — the one deliberate human step. Automating it defeats the goal.

## Implementation

- **`scripts/lib/jira-sync.mjs`** (new) — shared, dependency-free Jira REST helpers + key extraction.
- **`scripts/jira-release-sync.mjs`** — refactored to import the shared lib (behaviour unchanged; still targets `Done` from the release body).
- **`scripts/jira-dev-sync.mjs`** (new) — scans a commit message for keys, transitions each to `On dev`; same idempotent + soft-fail contract; honours `DRY_RUN`.
- **`.github/workflows/deploy.yml`** — new `Sync Jira tickets → On dev` step gated `if: steps.smoke.outcome != 'failure'`, passing the Jira vars/secrets and the head-commit message.
- **Jira** (manual, BOOKSHELF-80) — add `On dev` + `Ready for release` statuses and transitions; a saved "Needs QA" board filter (`status = "On dev"`).
- **Docs** — this ADR + a `docs/decisions.md` row; note the dev-env secrets in `docs/runbooks/cicd-setup.md`; reconcile BOOKSHELF-70's release-please framing.

## Consequences

**Good**

- "What needs human QA?" becomes a saved query (`status = "On dev"`); a merged ticket surfaces there automatically.
- `Done` regains an honest meaning (live in prod); the QA queue and the release-ready set are each independently queryable.
- Reuses ADR-022's proven idempotent/soft-fail machinery; the shared lib removes the near-duplicate script.

**Trade-offs**

- Still depends on the Jira key being in the commit subject — the same dependency as ADR-022, which ADR-023 makes reliable.
- Requires a one-time Jira workflow edit (new statuses/transitions) that code cannot perform; the script no-ops until it's done.
- Widens the Jira token's exposure from the `prod` environment to `dev` as well (same credential).
- Forward-only within the automated edges; the QA-fail kickback and any rollback reversal remain manual (rollback reversal is out of scope — cf. BOOKSHELF-78).
