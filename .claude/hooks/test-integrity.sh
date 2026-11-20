#!/bin/sh
# PreToolUse on Edit|Write|MultiEdit: no agent turns a test off to get green. Writing `.skip(`, `.only(`,
# `.todo(`, `.fixme(`, `xit(`, `xdescribe(`, `@quarantine` or `@wip` into a test or feature file is denied
# unless the owner set QUARANTINE_BY_OWNER=1 in the main session (test team decision 2026-10-18).
. "$(dirname "$0")/lib.sh"
[ "${QUARANTINE_BY_OWNER:-}" = "1" ] && exit 0
file=$(json '.tool_input.file_path'); [ -n "$file" ] || exit 0
rel=$(rel_path "$file")

case "$rel" in
  *.test.ts|*.test.tsx|*.spec.ts|*.feature|tests/*|*/steps/*|*/step-definitions/*) ;;
  *) exit 0 ;;
esac

# Edit: new_string; MultiEdit: every new_string; Write: content.
new=$(printf '%s' "$hook_input" | jq -r '[.tool_input.new_string?, .tool_input.content?, (.tool_input.edits[]?.new_string?)] | map(select(. != null)) | join("\n")')
[ -n "$new" ] || exit 0

if printf '%s' "$new" | grep -Eq '\.(skip|only|todo|fixme)\(|(^|[^A-Za-z])x(it|describe|test)\(|@quarantine|@wip|test\.fixme'; then
  deny "test-integrity: $rel would get a skipped, only, todo, fixme or quarantined test. Agents never turn tests off; report why the test is wrong. The owner quarantines with QUARANTINE_BY_OWNER=1 and an issue with an expiry date."
fi
exit 0
