#!/bin/sh
# PreToolUse on Edit|Write: contracts are read-only for agents; a change needs the owner's word,
# an ADR, a version bump and contract tests (skill new-contract). CI enforces it regardless.
. "$(dirname "$0")/lib.sh"
file=$(json '.tool_input.file_path'); [ -n "$file" ] || exit 0
case "$(rel_path "$file")" in
  packages/contracts/*) ask "contracts: $(rel_path "$file") is a contract. Approve only if you agreed to this change (ADR, schemaVersion bump, contract tests; skill new-contract)." ;;
esac
exit 0
