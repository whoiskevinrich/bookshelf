# Runbook: Cognito email-mutability migration (User Pool replacement)

**Status:** Ready to execute in a maintenance window
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

### Required strategy: blue/green (parallel pool), not in-place replacement

Because the pool identity is woven into three other stacks **and** the domain, the only safe path is a
**blue/green** cutover. Outline (to be finalized as its own change — do NOT hand-run a `cdk deploy`
until the CDK app implements this):

1. **Add a second, mutable-email UserPool** in `BookshelfAuth` alongside the old one, with a
   **distinct** Hosted-UI domain (new prefix in dev; a temporary `auth2.` host in prod). New pool →
   new export names, so no in-use-export conflict.
2. **Re-point ApiStack / McpStack / WebStack** consumers at the new pool's outputs and deploy them.
   The audience-validation list in `apps/api/src/middleware/auth.ts` already accepts multiple client
   IDs, so it can trust both pools during the cutover.
3. **Migrate** users + data into the new pool (Steps 4–6).
4. **Verify**, then **remove the old pool** (and free its domain; reclaim the original prefix/host on
   the new pool only if desired) in a final deploy.

Rollback at any point before step 4 is trivial: the old pool is still live and still wired up.

After cutover, update the two local env files for local dev (`apps/api/.env.local`,
`apps/web/.env.local`) with the new pool/client IDs (these are not managed by CDK).

> **Dev rehearsal status (2026-06-13):** pre-flight complete — old pool `us-west-2_QxAqa8b1Q`
> (2 accounts, both `whoiskevinrich@gmail.com`: one native CONFIRMED with 75 shelf items, one Google
> EXTERNAL_PROVIDER with 0; **unlinked**, confirming the linking failed on the immutable-email error).
> DynamoDB backup `pre-cognito-migration-dev-…` is `AVAILABLE`. Deploy **not** attempted — blocked as
> above; needs the blue/green CDK change first.

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
