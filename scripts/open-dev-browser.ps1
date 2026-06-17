<#
.SYNOPSIS
  Open the Bookshelf dev app in an isolated Microsoft Edge window/profile.

.DESCRIPTION
  Uses a DEDICATED Edge profile (separate from your everyday browser) so that:
    - Its cookies / Amplify session / saved logins are sandboxed and persist
      across sessions (profile lives under %LOCALAPPDATA%, not %TEMP%, so it
      survives Windows temp cleanups).
    - You can grant Claude computer-use to "Microsoft Edge" ONLY, and your
      everyday Chrome stays masked out of screenshots. Computer-use scoping is
      per-application, not per-profile — using a separate browser app is the way
      to isolate it.

  Unlike a browser entry in .claude/launch.json, this is launched outside the
  preview system, so there is no port collision with the Vite dev server and no
  machine-specific path committed to git.

  Requires the web dev server on http://localhost:3000 first. This script checks
  and fails fast (instead of opening a blank ERR_CONNECTION_REFUSED window).
  Start it with: preview_start web  — or:  pnpm --filter @bookshelf/web dev
#>

$ErrorActionPreference = 'Stop'

$url = 'http://localhost:3000/'
$profileDir = Join-Path $env:LOCALAPPDATA 'bookshelf-dev-edge'

# Fail fast if the dev server isn't reachable — the #1 cause of a blank window.
try {
  Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
  Write-Warning "Dev server not reachable at $url."
  Write-Warning "Start it first (preview_start web, or: pnpm --filter @bookshelf/web dev), then re-run."
  exit 1
}

# Resolve Edge across the two standard install locations.
$edge = @(
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) {
  Write-Error "Microsoft Edge not found in the standard install locations."
  exit 1
}

# If a window on this profile is already open, a second launch hands off and
# exits — so reuse it rather than spawning a duplicate.
$existing = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like "*$profileDir*" }
if ($existing) {
  Write-Host "An isolated Edge window for this profile is already open ($profileDir)."
  exit 0
}

Start-Process $edge -ArgumentList @(
  "--app=$url",
  "--user-data-dir=$profileDir",
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-features=msImplicitSignin'
)
Write-Host "Opened Bookshelf in isolated Edge profile: $profileDir"
