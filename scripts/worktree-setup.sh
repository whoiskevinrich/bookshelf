#!/usr/bin/env bash
# Thin bash wrapper — delegates to the PowerShell script via pwsh.
# Exists so the setup works whether the caller uses bash or PowerShell.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v pwsh &>/dev/null; then
  echo "ERROR: pwsh (PowerShell) not found. Run the setup manually:" >&2
  echo "  pwsh -File \"$SCRIPT_DIR/worktree-setup.ps1\"" >&2
  exit 1
fi

# Forward any arguments (e.g. -MainWorktree "C:\path") straight through to the .ps1
pwsh -File "$SCRIPT_DIR/worktree-setup.ps1" "$@"
