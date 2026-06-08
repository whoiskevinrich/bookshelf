# dev-api.ps1 — Start the API dev server with fresh AWS credentials.
#
# Granted's `assume` function is defined in $PROFILE. This script sources
# it explicitly because PowerShell doesn't load profiles in non-interactive
# (-File) sessions. Without it, `assume` calls the raw binary which sets
# credentials only in its own process, not the calling shell.

if (Test-Path $PROFILE) { . $PROFILE }

assume Sandbox/AWSPowerUserAccess

pnpm --filter @bookshelf/api run dev
