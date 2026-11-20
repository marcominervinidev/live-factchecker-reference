#!/bin/sh
# Stop: the unit tests of the workspaces changed on this branch must be green, and no frozen file
# may be in the diff, before the agent finishes. Skips when nothing changed since the last green run.
. "$(dirname "$0")/lib.sh"
[ "$(json '.stop_hook_active')" = "true" ] && exit 0
cd "$REPO_ROOT" || exit 0

changed=$( { git diff --name-only origin/main...HEAD; git status --porcelain | cut -c4-; } 2>/dev/null | sort -u)
[ -n "$changed" ] || exit 0

hit=$(printf '%s\n' "$changed" | frozen_changed)
if [ -n "$hit" ]; then
  printf 'Frozen files changed (gate-1 manifest):\n%s\nRevert them and report BLOCKED instead.\n' "$hit" >&2
  exit 2
fi

code_changed=$(printf '%s\n' "$changed" | grep -E '^(apps|services|packages)/.*\.(ts|tsx|js|mjs|json)$' || true)
[ -n "$code_changed" ] || exit 0
state_file=$(git rev-parse --git-path lfc-stop-hook-state)
fingerprint=$( { git rev-parse HEAD; git diff; git status --porcelain; } | git hash-object --stdin)
[ -f "$state_file" ] && [ "$(cat "$state_file")" = "$fingerprint" ] && exit 0

[ -x "$REPO_ROOT/scripts/tb" ] || { jq -n '{systemMessage:"stop-tests skipped: scripts/tb not present yet"}'; exit 0; }
if ! out=$("$REPO_ROOT/scripts/tb" pnpm --filter "...[origin/main]" --if-present test:unit 2>&1); then
  printf 'Unit tests of affected workspaces are failing. Fix them before finishing:\n%s\n' "$(printf '%s' "$out" | tail -40)" >&2
  exit 2
fi
printf '%s' "$fingerprint" > "$state_file"
exit 0
