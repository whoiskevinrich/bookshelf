# Spec: CI/CD Pipeline

**Status**: Draft  
**Date**: 2026-05-30  
**Author**: Kevin Rich

---

## Problem Statement

Without an automated CI/CD pipeline, deploying changes to the Bookshelf app requires manual steps that are error-prone and slow. There is no gate preventing broken code from reaching any environment, no audit trail of what version is running where, and no safe path to promote a verified build from sandbox to production. Every deployment is a manual, potentially inconsistent act.

## Goals

1. Every pull request is automatically validated — lint, format, type-check, tests, CDK synthesis, and version uniqueness — before any reviewer sees it.
2. Every merge to `main` is automatically deployed to the development sandbox within 5 minutes, with the deployed commit tagged for rollback.
3. Promotion to production is a deliberate, one-click action that reuses the same artifact already validated in sandbox.
4. The version in `package.json` is always unique and can be bumped automatically without manual edits.
5. A broken PR check never reaches `main`; a broken sandbox deploy never reaches production.

## Non-Goals

- **Blue/green or canary deployments**: Not needed at current scale; a full redeploy is acceptable.
- **Multi-region deployment**: Single-region (us-east-1) for now; multi-region is a future infrastructure decision.
- **Slack/PagerDuty notifications**: Nice-to-have for a future iteration; not blocking on this spec.
- **Preview environments per PR**: Useful eventually, but out of scope — CDK teardown logic and cost management add significant complexity.
- **Secrets rotation automation**: Secrets are managed in AWS Secrets Manager manually; rotation automation is a separate concern.

---

## User Stories

### Engineer (primary persona)

- As an engineer, I want my PR to automatically run linters, formatters, and tests so that I get fast feedback without manually running these locally.
- As an engineer, I want CDK synthesis to run on every PR so that I know my infrastructure changes are valid before merging.
- As an engineer, I want the CI system to reject a PR whose `package.json` version already exists as a git tag so that every deployment is uniquely identifiable.
- As an engineer, I want `main` to automatically deploy to the development sandbox after merge so that my changes are live for testing without any manual action.
- As an engineer, I want the deployed commit on `main` to be tagged with its version so that I can roll back to any prior version by tag.
- As an engineer, I want to trigger a production promotion by running a workflow (manually or via tag) so that I have explicit control over what reaches production.
- As an engineer, I want to be able to bump the patch/minor/major version automatically via a workflow input so that I do not need to manually edit `package.json` and push.

---

## Requirements

### Must-Have — P0

#### Pull Request Checks

| Requirement         | Acceptance Criteria                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| CDK synthesis       | `cdk synth` runs against all stacks; workflow fails if synthesis fails                                        |
| Lint                | ESLint runs across all packages; workflow fails on any error                                                  |
| Format              | Prettier check runs; workflow fails if any file would be reformatted                                          |
| Unit tests          | Vitest runs across all packages; workflow fails if any test fails                                             |
| Unique version gate | Workflow reads `version` from root `package.json`; fails if a git tag `v{version}` already exists in the repo |

All checks run in parallel where possible. A failing check blocks merge (branch protection rule required — documented in runbook, not enforced by the workflow file itself).

#### Merge to Main — Auto Deploy

| Requirement               | Acceptance Criteria                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Deploy to sandbox         | On push to `main`, CDK deploys all stacks to the `dev` AWS account/environment                                     |
| Tag on success            | After a successful sandbox deploy, the workflow creates and pushes a git tag `v{version}` from root `package.json` |
| Deploy failure visibility | If the CDK deploy fails, the workflow job fails (no silent failures); the tag is NOT created                       |

#### Promotion Workflow

| Requirement        | Acceptance Criteria                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Manual trigger     | A separate GitHub Actions workflow (`promote.yml`) accepts a version input and can be triggered via `workflow_dispatch` |
| Promote by version | Workflow checks out the commit at tag `v{version}`, then runs CDK deploy targeting the `prod` AWS account/environment   |
| No re-synthesis    | Promotion deploys the same CDK app code that was already validated; it does not re-run PR checks                        |
| Confirmation step  | Workflow prints the version being promoted and the target environment before deploying (visible in the Actions UI)      |

#### Automatic Version Bump

| Requirement          | Acceptance Criteria                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Bump workflow        | A `version-bump.yml` workflow accepts `bump-type` input (`patch` \| `minor` \| `major`)                                                   |
| Updates package.json | Uses `npm version` (or `pnpm version`) to update the root `package.json` version field                                                    |
| Opens PR             | Commits the version bump and opens a PR against `main` so the change goes through the normal PR gate (including the unique-version check) |

---

### Nice-to-Have — P1

| Requirement              | Notes                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Job summaries            | GitHub Actions job summaries with a table of check results and CDK stack change sets |
| Cache pnpm store         | Cache the pnpm store between runs to reduce install time                             |
| Concurrency groups       | Cancel in-progress runs on the same branch when a new push arrives                   |
| Deployment status badges | `README.md` shields.io badges for sandbox and prod deployment status                 |

---

### Future Considerations — P2

| Requirement                | Notes                                                      |
| -------------------------- | ---------------------------------------------------------- |
| Preview environments       | Ephemeral CDK stack per PR; torn down on close             |
| Slack deploy notifications | Post to a channel on sandbox deploy and prod promotion     |
| Automated release notes    | Generate a changelog from conventional commits on each tag |

---

## Workflow Architecture

```
┌─────────────────────────────┐
│   Pull Request              │
│                             │
│  ┌────────┐  ┌──────────┐  │
│  │  Lint  │  │  Tests   │  │
│  │ Format │  │CDK Synth │  │
│  └────────┘  └──────────┘  │
│        ┌───────────┐        │
│        │ Version   │        │
│        │   Gate    │        │
│        └───────────┘        │
└─────────────────────────────┘
            │ merge
            ▼
┌─────────────────────────────┐
│  push to main               │
│                             │
│  CDK deploy → dev           │
│  (on success) git tag v{n}  │
└─────────────────────────────┘
            │ promote
            ▼
┌─────────────────────────────┐
│  promote.yml (manual)       │
│                             │
│  input: version             │
│  checkout tag v{version}    │
│  CDK deploy → prod          │
└─────────────────────────────┘
```

---

## AWS Credentials

GitHub Actions authenticates to AWS via **OIDC** — both the `dev` and `prod` accounts already have a GitHub OIDC Identity Provider configured. No long-lived access keys are stored anywhere; workflows assume an IAM role per account using `aws-actions/configure-aws-credentials`.

**Two separate AWS accounts**: `dev` (sandbox) and `prod` (production). CDK stacks are deployed with explicit `env: { account, region }` per target.

Required GitHub Actions variables (not secrets — these are not sensitive):

| Variable            | Value                                             |
| ------------------- | ------------------------------------------------- |
| `AWS_REGION`        | `us-east-1`                                       |
| `AWS_ROLE_ARN_DEV`  | ARN of the IAM role to assume in the dev account  |
| `AWS_ROLE_ARN_PROD` | ARN of the IAM role to assume in the prod account |

Each IAM role must have a trust policy scoped to this repository (e.g. `repo:your-org/bookshelf:*`). PR checks (`cdk synth`) assume the dev role since synthesis does not deploy anything. The runbook will document the required IAM policies for each role.

---

## Success Metrics

### Leading (within 1 week of shipping)

- All PRs show green/red check status within 5 minutes of push
- Zero manual deployments to sandbox after pipeline is live
- Unique version gate catches at least one attempted duplicate before it merges

### Lagging (within 1 month)

- Time from merge to sandbox live: p95 < 8 minutes
- Zero production deployments that bypass the sandbox promotion gate
- Rollback time (checkout tag + deploy) < 15 minutes

---

## Open Questions

| Question                                                                                     | Owner       | Blocking?                                            |
| -------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------- |
| ~~Separate AWS accounts vs. single account?~~ **Resolved: separate accounts (dev + prod)**   | —           | —                                                    |
| Should the version bump PR require a specific reviewer or can it auto-merge?                 | Engineering | No                                                   |
| Should `promote.yml` also run a smoke test (e.g., curl the health endpoint) after deploying? | Engineering | No — nice-to-have for P1                             |
| What is the GitHub branch protection rule configuration? Document in runbook.                | Engineering | No — needed before go-live, not before spec approval |

---

## Timeline Considerations

- No external deadline; this unblocks all future feature work.
- Suggested order: PR checks → sandbox auto-deploy → tag → version bump workflow → promotion workflow.
- OIDC credential upgrade (P2) can follow once the basic pipeline is stable.

---

## Related Documents

- [ADR-001: Tech Stack](../adrs/001-tech-stack.md)
- Runbook to be created: `docs/runbooks/cicd-setup.md` (IAM policy, branch protection, secrets setup)
