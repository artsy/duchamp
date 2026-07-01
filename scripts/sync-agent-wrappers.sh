#!/usr/bin/env bash
# Generates agent wrapper files from AGENTS.md in the current repo.
# This is the source of truth — update here to add/remove agent support.
# Called by .github/actions/sync-agent-wrappers in CI; run locally for dev.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
AGENTS_MD="$REPO_ROOT/AGENTS.md"
HEADER="<!-- Auto-generated from AGENTS.md — do not edit directly. Run: curl -sS https://raw.githubusercontent.com/artsy/duchamp/main/scripts/sync-agent-wrappers.sh | bash -->"

generate() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  { printf '%s\n\n' "$HEADER"; cat "$AGENTS_MD"; } > "$dest"
  echo "  wrote $dest"
}

echo "Syncing agent wrappers from AGENTS.md..."
generate "$REPO_ROOT/.cursorrules"
generate "$REPO_ROOT/.github/copilot-instructions.md"
echo "Done."
