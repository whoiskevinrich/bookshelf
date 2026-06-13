# Runbook: Cognito email-mutability migration (User Pool replacement)

**Status:** READY — blue/green CDK change (ADR-015) implemented + `cdk diff`-validated; execute the two-deploy cutover in Step 3 during a maintenance window
**Severity origin:** SEV1 — prod Google sign-in broken with `user.email: Attribute cannot be updated.`
**Owner:** Kevin Rich

## Why this exists

The Cognito User Pool was created with `email: { required: true, mutable: false }`. The Google
identity provider maps Google's email into that attribute, and **Cognito re-applies IdP attribute
mappings on every federated sign-in**. Writing an immutable attribute fails, so the _second_ Google
login (or the _first_ login that the PreSignUp Lambda links to an existing native account) returns:

```
error=invalid_request
error_description=user.email: Attribute cannot be updated.
```

The Hosted UI redirects back to `/auth/callback` with that error and no `code`. (The SPA now shows
an actionable error instead of an infinite spinner — shipped separately as the immediate mitigation.)

**The fix** is `email: { mutable: true }` in `packages/infra/lib/auth-stack.ts`. You **cannot** change
the mutability of a Cognito standard attribute in place — CloudFormation **replaces the UserPool**,
which issues brand-new `sub` values. Because all shelf data is partitioned by `USER#${sub}`
(`apps/api/src/lib/dynamo.ts`), the migration must **re-key DynamoDB from old sub → new sub, matched
by email**.

> ⚠️ **Do not merge the `mutable: true` CDK change to `main` outside this window.** Merging
> auto-deploys to dev and replaces the dev pool before the steps below run. Coordinate the merge +
> deploy + scripts as one operation, per environment.

## Impact during the window

- **Native (email/password) users:** must **reset their password** once (forced). Their `sub` and all
  data are preserved.
- **Google users:** sign in again via Google; data is reconnected by the lazy re-key (Step 6).
- **Downtime:** logins fail from the moment the pool is replaced until pre-provisioning (Step 4) and
  the re-key (Step 5) complete. Keep the window tight; announce it.

## Pre-flight

```powershell
# Authenticate to the target account (run once per environment: dev, then prod)
assume Sandbox/AWSPowerUserAccess          # dev
# (prod: use the prod profile / role)

$env:AWS_REGION = "us-west-2"
$OLD_POOL = "<existing UserPoolId>"        # from `cdk deploy` outputs / SSM before the change
```

Confirm you can list users and read the table:

```powershell
aws cognito-idp list-users --user-pool-id $OLD_POOL --max-items 1
aws dynamodb describe-table --table-name bookshelf --query "Table.TableName"
```

## Step 1 — Export every user from the OLD pool

Capture email, sub, status, and whether the account is Google-federated. Save to `users-old.json`.

```powershell
aws cognito-idp list-users --user-pool-id $OLD_POOL --output json `
  > migration/users-old-raw.json
```

Then normalize (Node — `migration/export.mjs`):

```js
import { readFileSync, writeFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("migration/users-old-raw.json", "utf8"));
const users = raw.Users.map((u) => {
  const attr = Object.fromEntries(u.Attributes.map((a) => [a.Name, a.Value]));
  const isGoogle =
    (u.Username || "").startsWith("Google_") || (attr.identities || "").includes("Google");
  return {
    email: (attr.email || "").toLowerCase(),
    oldSub: attr.sub,
    username: u.Username,
    status: u.UserStatus,
    isGoogle,
  };
}).filter((u) => u.email && u.oldSub);
writeFileSync("migration/users-old.json", JSON.stringify(users, null, 2));
console.log(`Exported ${users.length} users`);
```

> If the pool has >60 users, paginate with `--pagination-token` until `NextToken` is empty.

## Step 2 — Back up DynamoDB (rollback safety)

```powershell
aws dynamodb create-backup --table-name bookshelf `
  --backup-name "pre-cognito-migration-$(Get-Date -Format yyyyMMdd-HHmm)"
```

Confirm the backup reaches `AVAILABLE` before continuing.

## Step 3 — Deploy the pool replacement

> 🛑 **A naive `cdk deploy` of the `mutable: true` change FAILS.** This was proven during the dev
> rehearsal (2026-06-13). Replacing the UserPool in place is blocked by **two** structural issues —
> read this whole section before deploying. The old simplistic instruction ("just deploy, stacks
> rewire via CfnOutputs") was wrong.

### Blocker 1 — Cognito Hosted-UI domain prefix conflict

The pool owns a Hosted-UI domain (dev: managed prefix `bookshelf-<account>`; prod: custom domain
`auth.bookshelf.whoiskevinrich.com`). The UserPool has `removalPolicy: RETAIN`, so on replacement the
**old pool keeps owning the domain**. CloudFormation creates the new pool's domain _before_ deleting
the old one → the prefix is still taken → `Domain already exists` → rollback.

### Blocker 2 — In-use cross-stack exports

`bin/bookshelf.ts` passes `auth.userPoolId` / SpaClient / McpClient / hostedUiDomain straight into
ApiStack, McpStack, and WebStack. CDK turns those into auto-exports that the consumer stacks import
(verified — `BookshelfAuth:ExportsOutputRefUserPool…` is imported by **BookshelfApi, BookshelfMcp,
BookshelfWeb**). CloudFormation **forbids changing an export value while it is imported**, and a pool
replacement changes all four values → `Export … cannot be updated as it is in use` → rollback.

### Strategy: blue/green (parallel pool), driven by `-c authPool=…` (ADR-015)

The CDK app now implements the blue/green cutover (ADR-015). `AuthStack` builds a pool _generation_
selected by `-c authPool=legacy|cutover|green`; gen2 (green) has `email: mutable: true` and a distinct
Hosted-UI domain, so it stands up beside gen1 with no domain or in-use-export conflict. The API trusts
both issuers during the window. Validated against dev with `cdk diff`: legacy is a no-op, cutover adds
green + repoints consumers with **no** in-use-export removals.

**Deploy 1 — cutover** (creates green, repoints consumers, keeps gen1 live):

```powershell
$ctx = "-c env=dev -c version=$VERSION -c cloudfront-domain=$CLOUDFRONT_HOST"
pnpm --filter @bookshelf/infra exec cdk deploy --all --require-approval never -c authPool=cutover $ctx
# Capture the GREEN pool/client ids from the BookshelfAuth outputs (UserPoolIdOutput, etc.)
$NEW_POOL = "<green UserPoolId>"; $NEW_CLIENT = "<green SpaClient id>"
```

Then run Steps 4–6 (pre-provision native users, re-key DynamoDB by email, lazy-rekey Google users)
**against `$NEW_POOL`**.

> ⚠️ **Google OAuth redirect URI — REQUIRED, or Google sign-in fails with `Error 400:
redirect_uri_mismatch` (caught in the dev rehearsal).** The green pool has a _new_ Hosted-UI
> domain (dev: `bookshelf-<account>-g2.auth.<region>.amazoncognito.com`; prod: `auth2.bookshelf…`),
> and Cognito federates to Google with `https://<that-domain>/oauth2/idpresponse`. That URI is **not**
> in the Google OAuth client's allowlist until you add it. CDK does **not** manage this — do it
> manually in **Google Cloud Console → APIs & Services → Credentials →** the OAuth 2.0 Client whose
> id is in SSM `/bookshelf/google/client-id` → **Authorized redirect URIs**:
>
> ```
> https://<green-hosted-ui-domain>/oauth2/idpresponse
> ```
>
> Keep the old domain's URI too (harmless; aids rollback). Allow a minute for Google to propagate.

**Deploy 2 — green** (retires gen1 after verification). ⚠️ **Order matters — deploy consumers
BEFORE Auth.** Removing gen1 changes the Auth template to delete gen1's exports, but `cdk deploy
--all` updates Auth (the producer) first, while the consumer stacks still import gen1's SpaClient/
issuer → `Cannot delete export … as it is in use by BookshelfApi` → rollback. Deploy the consumers
first so they drop those imports, then Auth:

```powershell
# 1. Consumers drop the gen1 (secondary-issuer) imports
pnpm --filter @bookshelf/infra exec cdk deploy --exclusively BookshelfApi BookshelfMcp BookshelfWeb `
  --require-approval never -c authPool=green $ctx
# 2. Auth removes gen1 (RETAIN keeps the orphaned pool shell; gen1 domain is freed)
pnpm --filter @bookshelf/infra exec cdk deploy --exclusively BookshelfAuth --require-approval never `
  -c authPool=green $ctx
```

Rollback before Deploy 2 is trivial: redeploy `-c authPool=legacy` — gen1 never stopped serving and
its data is untouched. After cutover, update the local `apps/{api,web}/.env.local` with the green
pool/client ids (not CDK-managed).

> **Dev rehearsal result (2026-06-13): SUCCESS.** Executed cutover → migrate → green end-to-end
> against dev. Green pool `us-west-2_NxOrdblYM` (email **Mutable=true**) is live; the SPA `config.json`
> points to it; the native account's 75 shelf items were re-keyed to the new sub. Two findings folded
> in above/below: (1) the green deploy must be consumers-first; (2) see the linker note in Step 6.

> **Dev rehearsal status (2026-06-13):** pre-flight complete — old pool `us-west-2_QxAqa8b1Q`
> (2 accounts, both `whoiskevinrich@gmail.com`: one native CONFIRMED with 75 shelf items, one Google
> EXTERNAL_PROVIDER with 0; **unlinked**, confirming the linking failed on the immutable-email error).
> DynamoDB backup `pre-cognito-migration-dev-…` is `AVAILABLE`. The blue/green CDK change (ADR-015) is
> implemented and `cdk diff`-validated (legacy no-op; cutover clean). Live cutover deploy is the next
> step.

## Step 4 — Pre-provision NATIVE users into the new pool (deterministic re-key)

For each **non-Google** user, create a native account (suppress the default email; we drive the reset
ourselves) and capture the **new sub**. `migration/provision-native.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
const NEW_POOL = process.env.NEW_POOL;
const c = new CognitoIdentityProviderClient({});
const users = JSON.parse(readFileSync("migration/users-old.json", "utf8"));
const map = [];
for (const u of users.filter((x) => !x.isGoogle)) {
  const res = await c.send(
    new AdminCreateUserCommand({
      UserPoolId: NEW_POOL,
      Username: u.email,
      UserAttributes: [
        { Name: "email", Value: u.email },
        { Name: "email_verified", Value: "true" },
      ],
      MessageAction: "SUPPRESS", // no Cognito email; we send our own reset comms
    }),
  );
  const newSub = res.User.Attributes.find((a) => a.Name === "sub").Value;
  map.push({ email: u.email, oldSub: u.oldSub, newSub });
}
writeFileSync("migration/submap-native.json", JSON.stringify(map, null, 2));
console.log(`Provisioned ${map.length} native users`);
```

Each user lands in `FORCE_CHANGE_PASSWORD`. Trigger the reset path for them (admin-reset, or instruct
them to use **Forgot password**). Their `sub` is now fixed and known.

## Step 5 — Re-key DynamoDB for native users

Copy every item under `USER#<oldSub>` to `USER#<newSub>`. Only the partition key changes — sort keys
(`ENTRY#`, `SHELF#`, membership) and book metadata (`BOOK#<isbn>`, shared) are untouched.
`migration/rekey.mjs`:

```js
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
const TABLE = "bookshelf";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const map = JSON.parse(readFileSync(process.argv[2], "utf8")); // submap-*.json
for (const { oldSub, newSub } of map) {
  let ExclusiveStartKey,
    copied = 0;
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `USER#${oldSub}` },
        ExclusiveStartKey,
      }),
    );
    const items = (page.Items ?? []).map((it) => ({ ...it, PK: `USER#${newSub}` }));
    for (let i = 0; i < items.length; i += 25) {
      await doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: items.slice(i, i + 25).map((it) => ({ PutRequest: { Item: it } })),
          },
        }),
      );
    }
    copied += items.length;
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log(`${oldSub} → ${newSub}: copied ${copied} items`);
}
```

Run: `node migration/rekey.mjs migration/submap-native.json`. **Idempotent** — re-running overwrites
the same target items. Leave old `USER#<oldSub>` items in place until verification passes (rollback).

## Step 6 — Google users: lazy re-key by email

Google users cannot be pre-provisioned (an `AdminCreateUser` shell is `FORCE_CHANGE_PASSWORD`, and the
PreSignUp linker only links to `CONFIRMED` natives — so the Google login would create a _different_
sub and re-orphan the data). Instead, re-key them **after** they sign in to the new pool:

> ⚠️ **Linker finding (dev rehearsal 2026-06-13):** the PreSignUp linker matches
> `u.Username === email` (`packages/infra/lambda/pre-signup/index.js`). But in an email-alias pool,
> `AdminCreateUser` gives the pre-provisioned native account a **UUID username** (email is only an
> alias) and `FORCE_CHANGE_PASSWORD` status — so even after the native user resets their password and
> becomes `CONFIRMED`, the linker's `Username === email` check never matches a pre-provisioned account,
> and a returning Google user gets a brand-new sub instead of linking. **Before the prod cutover, fix
> the linker to match on the `email` attribute (via `ListUsers` filter) rather than `Username`.** In
> dev this was harmless (the Google account had 0 shelf items).

1. After cutover, periodically list the new pool's Google users and build `submap-google.json` by
   matching email back to `users-old.json` (`oldSub`):

   ```js
   // migration/build-google-submap.mjs — lists NEW_POOL, joins to users-old.json by email
   // emits [{ email, oldSub, newSub }] for users present in both, then run rekey.mjs on it.
   ```

2. `node migration/rekey.mjs migration/submap-google.json` — idempotent; run it a few times over the
   first 24–48h as Google users return, then once more at the end of the grace period.

> Optional deterministic alternative (more code, no grace period): temporarily relax the PreSignUp
> `UserStatus === "CONFIRMED"` check to also link `FORCE_CHANGE_PASSWORD` shells during the window,
> pre-provision Google users too, and re-key them in Step 5. Only do this if a grace period is
> unacceptable — it weakens the linking safety the comment in `pre-signup/index.js` documents.

## Step 7 — Comms

Send before the window: "Bookshelf sign-in will be briefly unavailable on <date/time> for a security
update. Afterwards, email/password users will be asked to reset their password once; Google sign-in
users just sign in again. Your library is unaffected." Include the password-reset link.

## Step 8 — Verify

- Native user: Forgot password → set new password → log in → library intact.
- Google user: sign in with Google twice in a row (the previously-failing case) → no error → after the
  Step 6 re-key, library intact.
- `/auth/callback` no longer errors for either path.
- Re-run `migration/rekey.mjs` and confirm item counts match the old pool's.

## Rollback

Before cutover completes, rollback is clean because the old pool is **retained** and old DynamoDB
items are untouched:

1. Revert the CDK change (`email: mutable: false` … or better, redeploy the previous AuthStack
   template) so the app points back at `$OLD_POOL`.
2. Old users + their `USER#<oldSub>` data are intact — no restore needed.
3. Only discard the new pool and the copied `USER#<newSub>` items.

After users have reset passwords against the new pool, rollback means those resets are lost — treat
Step 4 as the point of no return and verify Step 3 thoroughly first.

## Cleanup (after verification, both environments)

- Delete old `USER#<oldSub>` items (script: same query, `DeleteRequest`) once counts are confirmed.
- Delete the retained old User Pool.
- Delete the DynamoDB backup per retention policy.
- Remove the `migration/` scripts/exports (they contain emails — do not commit `users-old*.json`).
