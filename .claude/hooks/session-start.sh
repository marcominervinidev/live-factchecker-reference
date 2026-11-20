#!/bin/sh
# SessionStart: show branch, the issues assigned to the owner and the open frontier. Never fails
# without network; gh output is informational.
. "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 0
printf 'live-factchecker-v2 on branch %s\n' "$(git branch --show-current 2>/dev/null)"
if command -v gh >/dev/null 2>&1; then
  mine=$(timeout 8 gh issue list --assignee @me --state open --json number,title --jq '.[] | "  #\(.number) \(.title)"' 2>/dev/null)
  [ -n "$mine" ] && printf 'Assigned issues:\n%s\n' "$mine"
fi
open_manifests=$(ls "$FROZEN_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$open_manifests" != "0" ] && printf 'Frozen manifests open: %s (see .claude/frozen/)\n' "$open_manifests"
printf 'Rules: CLAUDE.md. Roles: docs/process/rollen.md. One issue per session.\n'
exit 0
