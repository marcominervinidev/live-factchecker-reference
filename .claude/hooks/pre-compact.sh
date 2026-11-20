#!/bin/sh
# PreCompact: append the git state to a scratch note so the agent can resume after compaction.
# Writing the open points into the issue is the agent's job before /compact (CLAUDE.md).
. "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 0
mkdir -p .claude/scratch
note=.claude/scratch/compact-$(date +%Y%m%d).md
{
  printf '\n## compaction (%s) %s\n' "$(json '.trigger')" "$(date -u +%FT%TZ)"
  printf 'branch: %s\nhead: %s\n' "$(git branch --show-current)" "$(git rev-parse --short HEAD 2>/dev/null)"
  printf 'uncommitted:\n%s\n' "$(git status --porcelain)"
} >> "$note"
exit 0
