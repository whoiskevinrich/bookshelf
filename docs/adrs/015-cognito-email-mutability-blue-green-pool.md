# ADR-015: Cognito email-mutability fix via blue/green parallel pool

**Status**: Accepted — implemented and `cdk diff`-validated (legacy no-op; cutover clean). Live cutover pending.
**Date**: 2026-06-13

## Context

The Cognito User Pool was created with `email: { required: true, mutable: false }`. The
Google IdP maps Google's email into that attribute, and Cognito **re-applies IdP attribute
mappings on every federated sign-in**. Writing an immutable attribute fails, so the second
Google login — or the first login the PreSignUp Lambda links to an existing native account —
returns `invalid_request` / `user.email: Attribute cannot be updated.`, which surfaces to the
SPA at `/auth/callback`. This was the SEV1 login incident (2026-06-13). The frontend half (an
infinite spinner) shipped separately; this ADR covers the backend root cause.

The fix is `email: { mutable: true }`. But **you cannot change the mutability of a Cognito
standard attribute in place** — CloudFormation replaces the `AWS::Cognito::UserPool`. A naive
`cdk deploy` of that change was attempted as a dev rehearsal and **fails for two independent,
verified reasons**:

1. **Hosted-UI domain prefix conflict.** The pool owns a domain (dev: managed prefix
   `bookshelf-<account>`; prod: custom `auth.bookshelf.whoiskevinrich.com`). The pool has
   `removalPolicy: RETAIN`, so on replacement the old pool keeps the domain; CloudFormation
   creates the new pool's domain before deleting the old → prefix taken → rollback.
2. **In-use cross-stack exports.** `bin/bookshelf.ts` passes `auth.userPoolId` / SpaClient /
   McpClient / hostedUiDomain into ApiStack, McpStack, WebStack. CDK turns these into
   auto-exports the consumers import (verified: `…ExportsOutputRefUserPool…` is imported by
   BookshelfApi, BookshelfMcp, BookshelfWeb). CloudFormation forbids changing an export value
   while it is imported → rollback.

Additionally, all shelf data is partitioned by `USER#${sub}` (`apps/api/src/lib/dynamo.ts`),
and a new pool issues **new `sub` values**, so users _and their data_ must be migrated, not
just re-pointed.

## Options considered

| Option                                    | Mechanics                                                                                        | Verdict                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In-place replacement** (flip `mutable`) | One `cdk deploy`                                                                                 | **Rejected** — fails on both blockers above; no data migration path.                                                                                                        |
| **Decouple exports to SSM, then replace** | Consumers read pool IDs from SSM params instead of cross-stack refs; then replace pool           | Removes blocker 2 but not blocker 1 (domain), still an in-place pool replace with a hard cutover and no rollback while the single pool is mid-replace. Larger blast radius. |
| **Blue/green parallel pool** (chosen)     | Stand up a 2nd pool (mutable, own domain) beside the old; repoint consumers; migrate; retire old | No export conflict (new pool → new export names), no domain conflict (new prefix/host), and the old pool stays fully live for instant rollback until cutover is verified.   |

## Decision

Replace the pool via a **blue/green cutover**, executed as **two deploys** plus a data
migration, gated by a new typed context flag in `bin/bookshelf.ts`:

`-c authPool=legacy` (default) · `-c authPool=cutover` · `-c authPool=green`

`AuthStack` is refactored so its pool/IdP/clients/domain/triggers are produced by a private
`createPoolGeneration(generation)` helper, with construct IDs and the Cognito managed-domain
prefix suffixed by generation (`-g2`). The stack exposes the **active** generation's
`userPoolId` / client IDs / issuer / hostedUiDomain as its outputs.

1. **Deploy 1 — `authPool=cutover`.** Declares **both** generations: legacy (gen1, retained,
   email immutable — untouched, still serving) **and** green (gen2, `email: mutable: true`, new
   domain prefix/host). Outputs expose **green**, so ApiStack/McpStack/WebStack repoint to it in
   the same `cdk deploy --all`. No export-value change (gen1 exports simply stop being imported;
   gen2 adds new exports), no domain conflict (gen2 uses a distinct prefix). The API's
   audience check already accepts an array of client IDs, so widen `COGNITO_ISSUER` handling to
   trust **both** issuers during the window (small `auth.ts` change) so existing sessions don't
   hard-break mid-cutover.
2. **Migrate** users + data into the green pool (runbook Steps 1–6): native users
   pre-provisioned (forced password reset, deterministic re-key of `USER#${sub}` by email);
   Google users re-key lazily by email after re-auth.
3. **Deploy 2 — `authPool=green`.** Drops the legacy generation from the stack. `RETAIN` keeps
   the orphaned old pool shell (rollback-of-last-resort); its clients/domain/IdP/triggers
   (DESTROY) are removed, freeing the old prefix. Revert `auth.ts` to a single issuer.

Rollback before Deploy 2 is trivial: redeploy `authPool=legacy` — the old pool never stopped
serving and its data is untouched.

## Consequences

- **Two coordinated deploys per environment**, with the data migration in between, run inside a
  maintenance window per `docs/runbooks/cognito-email-mutable-migration.md` (which this ADR's
  Step-3 strategy replaces).
- **Native users reset their password once** (AdminCreateUser cannot carry password hashes).
  Google users just re-authenticate.
- **The green pool's Hosted-UI domain differs** from the original during/after cutover (dev:
  `bookshelf-<account>-g2`; prod: a `auth2.` host, or reclaim `auth.` in a later deploy once the
  legacy custom domain is freed). The SPA's `oauth.domain` is wired from the stack output, so it
  follows automatically.
- A new regression test already pins `email` mutable; add a synth test asserting the cutover
  state produces **two** `AWS::Cognito::UserPool` resources and distinct domain prefixes.
- After cutover, update the gitignored local `apps/{api,web}/.env.local` with the green pool/client
  IDs (not CDK-managed).

## Status / next steps

Dev rehearsal pre-flight is complete (user export captured; DynamoDB backup `AVAILABLE`); the
in-place deploy was correctly **not** attempted. Implementation of the `authPool` generation
refactor + the dual-issuer `auth.ts` change is the next unit of work, after which the dev
rehearsal re-runs against the blue/green path.
