#!/bin/sh
# PreToolUse on Edit|Write: after gate 1 the paths in .claude/frozen/<issue>.json are frozen for
# every agent (ADR 0011). The manifests themselves are read-only unless the owner set
# FROZEN_UNLOCK=<issue> in the main session.
. "$(dirname "$0")/lib.sh"
file=$(json '.tool_input.file_path'); [ -n "$file" ] || exit 0
rel=$(rel_path "$file")

case "$rel" in
  .claude/frozen/*.json)
    issue=$(basename "$rel" .json)
    [ "${FROZEN_UNLOCK:-}" = "$issue" ] && exit 0
    deny "frozen-manifest: $rel is read-only for agents. The owner unlocks it with FROZEN_UNLOCK=$issue in the main session; the change is logged as an issue comment." ;;
esac

frozen_paths | while IFS= read -r p; do
  [ -n "$p" ] || continue
  case "$rel" in
    "$p" | "$p"/*)
      printf '%s\n' "$p" ;;
  esac
done | head -1 | grep -q . && deny "frozen-manifest: $rel is frozen by a gate-1 manifest (features, steps, red tests, contracts). Report it as BLOCKED; never adapt a frozen file."
exit 0
