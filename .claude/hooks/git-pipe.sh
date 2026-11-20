#!/bin/sh
# PreToolUse on Bash: a state-changing git or gh command never ends in a pipe; the pipe's exit code
# would mask a failed commit or push (three incidents in live-factcheck).
. "$(dirname "$0")/lib.sh"
cmd=$(json '.tool_input.command'); [ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -Eq '(^|[;&(]|&&|\|\|) *(git +(commit|push|merge|rebase|reset|checkout|switch|stash|tag|cherry-pick|am|worktree|branch +-[dDm])|gh +(pr +(create|merge|edit|close|ready)|issue +(create|edit|close|comment|reopen)|api +-X +(POST|PATCH|PUT|DELETE)|release))[^|;&]*\|' \
  && deny "git-pipe: a state-changing git or gh command ends in a pipe. Run it alone, judge success by its exit code and full output, pass bodies via --body-file."
printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z])git +[^;&|]*--no-verify' \
  && deny "git-pipe: --no-verify is forbidden; every commit runs the pre-commit hook."
printf '%s' "$cmd" | grep -Eq 'core\.hooksPath' \
  && deny "git-pipe: changing core.hooksPath is forbidden."
exit 0
