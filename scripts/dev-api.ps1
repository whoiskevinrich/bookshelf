# dev-api.ps1 — Start the API dev server with fresh AWS credentials.
#
# Granted's `assume` function is defined in $PROFILE. This script sources
# it explicitly because PowerShell doesn't load profiles in non-interactive
# (-File) sessions. Without it, `assume` calls the raw binary which sets
# credentials only in its own process, not the calling shell.

if (Test-Path $PROFILE) { . $PROFILE }

assume dev/AWSPowerUserAccess

# `assume`'s failure is non-terminating in PowerShell, so a stale/expired SSO
# session doesn't stop the script here — it would otherwise fall through to
# `pnpm dev` and serve a credential-less API where every DynamoDB call 500s.
# Verify the credentials actually resolve before starting the server.
aws sts get-caller-identity | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "AWS credentials are missing or expired. Run 'assume dev/AWSPowerUserAccess' and try again."
    exit 1
}

pnpm --filter @bookshelf/api run dev
