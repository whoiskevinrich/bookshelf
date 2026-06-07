# ADR-009: Deployment Environment Selection — Typed Config via Context

**Status**: Accepted
**Date**: 2026-06-04

## Context

Adding the production custom-domain topology (ADR-008) introduced per-environment
differences: prod has a custom domain and self-signup enabled, dev has neither.
The first implementation expressed these as independent CDK context flags —
`-c domain=bookshelf.whoiskevinrich.com` and `-c allowSelfSignUp=true` — passed at
deploy time.

That has two weaknesses:

1. **Stringly-typed and unchecked.** `tryGetContext("domain")` is `any`; a typo or
   omission is silent.
2. **A dangerous footgun.** Prod requires *several* flags. If `promote.yml` (or a
   manual run) omits one, prod silently deploys part of the **dev** topology — no
   custom domain, CORS wide open, self-signup off — with no error.

The question raised: should environments be modelled with **CDK Stages**
(`cdk.Stage`) instead of context?

Deployment context that constrains the answer: deploys run via **GitHub Actions
assuming a separate AWS account per environment via OIDC** (`deploy.yml` → dev,
`promote.yml` → prod). The project does **not** use CDK Pipelines, and
deliberately keeps AWS account IDs out of source control (account is resolved
ambiently from the assumed role).

### Options

| Option | Mechanics | Fit for this project |
| --- | --- | --- |
| **Independent context flags (original)** | `-c domain=… -c allowSelfSignUp=…` | Works, but stringly-typed and forgettable — the footgun above. |
| **Literal `cdk.Stage` per environment** | `class BookshelfStage extends cdk.Stage`; instantiate Dev + Prod | Idiomatic *for CDK Pipelines*, which is the unit Stages feed. Renames stacks (path-prefixed), changes every `cdk deploy` selector to `Prod/…`, and pushes toward committing account IDs. High churn against live `RETAIN` resources, near-zero benefit without Pipelines. |
| **Typed `EnvConfig` selected by one flag (chosen)** | `-c env=dev\|prod` indexes a typed config map; stacks stay top-level | Atomic environment selection, type-safe, no stack renames, account stays ambient. Minimal CI change. |

## Decision

Model the environment as a single typed selector: `-c env=dev|prod` indexes an
`EnvConfig` record in `bin/bookshelf.ts`. One selector applies **all** of an
environment's traits atomically (region, `domain?`, `allowSelfSignUp`), so prod
can no longer be half-configured by a forgotten flag.

Stacks remain instantiated at the app top level (not wrapped in a `cdk.Stage`):

- `account` is **not** pinned in config — it stays ambient (resolved from the
  OIDC-assumed role), keeping account IDs out of source.
- `version` remains a separate per-deploy context input (it is the S3 build
  prefix, an artifact trait, not an environment trait).

A literal `cdk.Stage` is explicitly **not** adopted now: under the GitHub-Actions
per-account model it adds stack-rename and deploy-selector churn for no benefit.
Its real value is as the deployment unit of CDK Pipelines — if that is adopted
later, promoting the existing factory wiring into a `BookshelfStage` is a small,
localized change (revisit then).

## Consequences

- Deploys select an environment with `-c env=dev|prod`. `deploy.yml` uses
  `env=dev`; `promote.yml` uses `env=prod`. The prod runbook
  (`docs/runbooks/prod-domain-setup.md`) uses `-c env=prod` throughout.
- The old `-c domain` and `-c allowSelfSignUp` flags are removed; their values are
  now properties of the prod `EnvConfig`.
- Adding a future environment (e.g. `staging`) or a second app's config is a typed
  entry in the `ENVIRONMENTS` map, not a new set of flags.
- Stack names are unchanged (no `Stage` path prefix), so existing dev stacks and
  their `RETAIN` resources are preserved, and `cdk deploy <StackName>` selectors
  stay as documented.
- An unknown `-c env` value fails fast with a clear error rather than silently
  defaulting to a partial topology.
