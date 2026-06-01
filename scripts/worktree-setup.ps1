# worktree-setup.ps1
# Copies .env.local files from the main worktree into the current worktree.
# Run once after creating a new worktree for full-stack (real API + Cognito) development.
# For frontend-only dev, use: pnpm --filter @bookshelf/web dev:mock

param(
  [string]$MainWorktree = "G:\source\bookshelf"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$pairs = @(
  @{ Src = "$MainWorktree\apps\api\.env.local"; Dst = "$Root\apps\api\.env.local" },
  @{ Src = "$MainWorktree\apps\web\.env.local"; Dst = "$Root\apps\web\.env.local" }
)

$copied = 0
foreach ($pair in $pairs) {
  if (-not (Test-Path $pair.Src)) {
    Write-Warning "Source not found, skipping: $($pair.Src)"
    continue
  }
  if (Test-Path $pair.Dst) {
    Write-Host "Already exists, skipping: $($pair.Dst)"
    continue
  }
  Copy-Item $pair.Src $pair.Dst
  Write-Host "Copied: $($pair.Src) -> $($pair.Dst)"
  $copied++
}

if ($copied -eq 0) {
  Write-Host "`nNothing to copy. For frontend-only dev without .env.local, run:"
  Write-Host "  pnpm --filter @bookshelf/web dev:mock"
} else {
  Write-Host "`nDone. Start the stack with:"
  Write-Host "  docker compose up -d   # DynamoDB Local"
  Write-Host "  pnpm --filter @bookshelf/api dev"
  Write-Host "  pnpm --filter @bookshelf/web dev"
}
