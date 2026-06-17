# Runbook: Run the MCP server locally and add it to Claude

How to run `apps/mcp` against the local API and register it with Claude Code (or
Claude Desktop / MCP Inspector) for hands-on testing — the end-to-end layer that
the automated unit/protocol tests in `apps/mcp/test/` can't cover.

> **Why this is fiddly:** the MCP server validates a Cognito **ID token** whose
> audience is the **`bookshelf-mcp`** app client — a different client from the
> web SPA. A token copied from the web app's `localStorage` will be rejected
> (`aud` mismatch). And the mcp client only allows the **authorization-code +
> PKCE** flow (`userPassword`/`userSrp` are disabled in `auth-stack.ts`), so you
> cannot mint a token with `aws cognito-idp initiate-auth`. The two supported
> paths below both work around this.

---

## 1. Create `apps/mcp/.env.local`

The MCP server reads its config at cold-start (`requireEnv` in `src/app.ts`); a
missing var throws immediately. The worktree-setup script copies this file from
the main worktree **if it exists there** — but it doesn't yet, so create it once.

Start from the template:

```powershell
Copy-Item apps/mcp/.env.example apps/mcp/.env.local
```

Then fill in the real values. The Cognito config comes from **AuthStack
CloudFormation exports** — there are no `/bookshelf/cognito/*` SSM parameters
(the AuthStack publishes CFN exports, not SSM, for these). With AWS credentials
active (`assume dev/AWSPowerUserAccess`):

```powershell
$region = "us-west-2"
function Get-CfnExport($name) {
  aws cloudformation list-exports --region $region `
    --query "Exports[?Name=='$name'].Value" --output text
}

$issuer      = Get-CfnExport BookshelfUserPoolIssuer     # full COGNITO_ISSUER URL
$mcpClientId = Get-CfnExport BookshelfMcpClientId        # mcp app client (token audience)
$hostedUi    = Get-CfnExport BookshelfHostedUiBaseUrl    # Cognito Hosted UI base URL

"$issuer`n$mcpClientId`n$hostedUi"   # sanity-check none are empty / 'None'
```

Available exports (from `packages/infra/lib/auth-stack.ts`):
`BookshelfUserPoolId`, `BookshelfUserPoolClientId` (the SPA client — **not** this),
`BookshelfMcpClientId`, `BookshelfHostedUiBaseUrl`, `BookshelfUserPoolIssuer`.

> If `Get-CfnExport` returns `None`, AuthStack isn't deployed in the account your
> credentials point at — confirm with `aws sts get-caller-identity` and that
> you assumed the dev account.

Fill `apps/mcp/.env.local` with those values:

```
# Cognito ID-token verification — audience MUST be the mcp client, not the SPA client
COGNITO_ISSUER=<BookshelfUserPoolIssuer>
COGNITO_CLIENT_ID=<BookshelfMcpClientId>
COGNITO_HOSTED_UI_BASE_URL=<BookshelfHostedUiBaseUrl>

# Point at the LOCAL dev API (defaults to 3001)
API_BASE_URL=http://localhost:3001

# REQUIRED for local OAuth discovery — if blank, the WWW-Authenticate header and
# the oauth-protected-resource `resource` field come out host-less and Claude's
# OAuth discovery breaks. Set it even though src/app.ts treats it as optional.
MCP_SERVER_URL=http://localhost:3002
```

`BookshelfUserPoolIssuer` already has the full
`https://cognito-idp.<region>.amazonaws.com/<user-pool-id>` form — paste it
straight into `COGNITO_ISSUER`, no assembly needed.

---

## 2. Start the API and MCP servers

The MCP server proxies the REST API, so the API must be up. The API talks to
real dev DynamoDB/Cognito and needs AWS credentials (see
[`local-dev.md`](local-dev.md)).

```powershell
assume dev/AWSPowerUserAccess
pnpm --filter @bookshelf/api dev          # API on http://localhost:3001
pnpm --filter @bookshelf/mcp dev          # MCP on http://localhost:3002
```

Smoke-check the MCP server is up (no auth needed for `/health`):

```powershell
curl http://localhost:3002/health         # -> {"status":"ok"}
```

---

## 3. Register with Claude Code

Two paths. **Path B (static token) is the quickest and most reliable for local
testing** because it sidesteps Cognito's callback-URL allowlist entirely. Use
Path A when you want to exercise the real OAuth experience.

### Path A — native OAuth (the "real" client experience)

```powershell
claude mcp add --transport http bookshelf-local http://localhost:3002/mcp
```

On first tool use, Claude Code reads the `/.well-known/*` discovery docs and runs
the authorization-code + PKCE flow against the Cognito Hosted UI.

⚠️ **Callback-URL gotcha — verify before relying on this.** The `bookshelf-mcp`
Cognito client only registers these redirect URIs (`auth-stack.ts`):

- `http://localhost:54321/callback` — Claude **Desktop**
- `http://localhost:3000/callback` — MCP Inspector / local dev

Cognito requires an **exact** redirect-URI match (no wildcard ports). If Claude
Code (CLI) uses a redirect URI not in that list, the Hosted UI returns
`redirect_mismatch` and the flow dies. To fix: add Claude Code's actual callback
URL to the `callbackUrls` array in
`packages/infra/lib/auth-stack.ts` (the `McpClient` block), then redeploy:

```powershell
pnpm --filter @bookshelf/infra cdk deploy BookshelfAuth
```

### Path B — static bearer token via the Hosted UI (works today)

Mint an ID token by hand through the auth-code flow using the already-registered
`http://localhost:3000/callback`, then hand it to Claude as a fixed header.

```powershell
$HostedUi    = "<COGNITO_HOSTED_UI_BASE_URL>"
$McpClientId = "<mcp-client-id>"
$Redirect    = "http://localhost:3000/callback"

# 1. PKCE verifier + S256 challenge
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$verifier  = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$sha       = [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier))
$challenge = [Convert]::ToBase64String($sha).TrimEnd('=').Replace('+','-').Replace('/','_')

# 2. Open the authorize URL — log in, then the browser redirects to
#    http://localhost:3000/callback?code=XXXX (the page won't load; copy the code
#    from the address bar).
Start-Process "$HostedUi/oauth2/authorize?response_type=code&client_id=$McpClientId&redirect_uri=$Redirect&scope=openid+email+profile&code_challenge_method=S256&code_challenge=$challenge"

# 3. Exchange the code for tokens (public client + PKCE — no client secret)
$code = Read-Host "Paste the code from the redirect URL"
$resp = Invoke-RestMethod -Method Post -Uri "$HostedUi/oauth2/token" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body @{
    grant_type    = "authorization_code"
    client_id     = $McpClientId
    code          = $code
    redirect_uri  = $Redirect
    code_verifier = $verifier
  }
$idToken = $resp.id_token
```

Register the server with the token as a static header (Claude skips OAuth when an
`Authorization` header is supplied):

```powershell
claude mcp add --transport http bookshelf-local http://localhost:3002/mcp `
  --header "Authorization: Bearer $idToken"
```

⚠️ **ID tokens expire after 1 hour** (`idTokenValidity` in `auth-stack.ts`).
Re-run the exchange and `claude mcp remove bookshelf-local` / re-add to refresh.
For longer sessions use Path A, which refreshes automatically.

---

## 4. Verify end-to-end

You can confirm the token + server work before involving Claude. The transport
**requires** `Accept: application/json, text/event-stream` (it returns `406`
otherwise — see the protocol tests):

```powershell
curl -X POST http://localhost:3002/mcp `
  -H "Authorization: Bearer $idToken" `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expect a JSON-RPC response listing the 8 tools (`list_shelf`, `add_book`,
`update_book_status`, `remove_book`, `set_notes`, `search_books`,
`lookup_book_isbn`, `lookup_book_asin`).

Then in Claude Code, run `/mcp` to confirm `bookshelf-local` is connected, and
walk the happy path conversationally:

> search for "Project Hail Mary" → add it as `want` → list my shelf → mark it
> `owned` → set a note → remove it

Also exercise the edge cases the protocol tests assert: adding the same book
twice (409 → "already on your shelf"), and an empty shelf.

---

## Troubleshooting

| Symptom                                                                                    | Likely cause                                                                                         | Fix                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COGNITO_ISSUER is not set` (server won't boot)                                            | `.env.local` missing/incomplete                                                                      | Step 1 — set all required vars                                                                                                                                               |
| `401 Invalid or expired token` on every call                                               | Token's `aud` is the SPA client, or it expired                                                       | Mint against the **mcp** client (Path B); tokens last 1h                                                                                                                     |
| `401` even with a fresh token                                                              | `token_use` is `access`, not `id`                                                                    | Use `id_token` from the exchange, not `access_token`                                                                                                                         |
| Tools return `API error (401): Invalid or expired token` (server itself accepts the token) | The API doesn't trust the mcp client audience — `COGNITO_MCP_CLIENT_ID` missing/unset in the API env | Set `COGNITO_MCP_CLIENT_ID` (the mcp client) in `apps/api/.env.local` and **restart the API** (tsx watch doesn't reload on `.env` edits); prod needs the `ApiStack` redeploy |
| `406 Not Acceptable`                                                                       | Missing `text/event-stream` in `Accept`                                                              | Add both media types to the `Accept` header                                                                                                                                  |
| `redirect_mismatch` at the Hosted UI                                                       | Redirect URI not registered on the mcp client                                                        | Use `:3000/callback`, or add the URI to `auth-stack.ts` + redeploy AuthStack                                                                                                 |
| Claude's OAuth discovery fails / loops                                                     | `MCP_SERVER_URL` blank                                                                               | Set `MCP_SERVER_URL=http://localhost:3002`                                                                                                                                   |
| `Network error` in a tool result                                                           | API not running on `:3001`                                                                           | Start `@bookshelf/api`; check `API_BASE_URL`                                                                                                                                 |
| `GET /mcp` → 405                                                                           | Expected — SSE/sessions are intentionally unsupported (stateless Lambda)                             | Not a bug; clients must POST                                                                                                                                                 |

---

## Related

- [`local-dev.md`](local-dev.md) — AWS credentials and the dev stack
- [`apps/mcp/.env.example`](../../apps/mcp/.env.example) — the env template
- `apps/mcp/test/` — Layer 1–3 automated coverage (unit, app/transport, protocol)
- `packages/infra/lib/auth-stack.ts` — Cognito mcp client + callback URLs
- `packages/infra/lib/mcp-stack.ts` — deployed MCP Lambda + API Gateway
