#!/bin/sh
# PreToolUse on Agent: no new subagents while the limit watcher reports level session_hard or
# week_soft globally, or context_block for this session (research #53, task #54).
# Without a state file the hook allows everything.
. "$(dirname "$0")/lib.sh"
[ -f "$LIMIT_STATE" ] || exit 0
level=$(jq -r '.level // empty' "$LIMIT_STATE" 2>/dev/null)
case "$level" in
  session_hard | week_soft)
    reset=$(jq -r '.resets_at // empty' "$LIMIT_STATE" 2>/dev/null)
    deny "limit-guard: usage level $level (reset $reset). No new subagents: write the state to the issue, stop or wind down running agents, schedule the continuation (CLAUDE.md, Limit watcher)." ;;
esac
# Context fill is per session: deny on this session's own entry, or on the global level when the
# state carries no entry for this session (older watcher or unknown session id).
sid=$(json .session_id)
own=$(jq -r --arg s "$sid" '.sessions[$s].context_level // empty' "$LIMIT_STATE" 2>/dev/null)
if [ "$own" = context_block ] || { [ -z "$own" ] && [ "$level" = context_block ]; }; then
  ctx=$(jq -r --arg s "$sid" '.sessions[$s].context_percentage // empty | tostring' "$LIMIT_STATE" 2>/dev/null)
  deny "limit-guard: context fill of this session at ${ctx:->=80} % (level context_block). No new subagents: write the open points as an issue comment, then compact (CLAUDE.md, Limit watcher)."
fi
exit 0
