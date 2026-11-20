#!/bin/sh
# PreToolUse on every tool: non-blocking systemMessage with the limit watcher's level for this
# session (task #54). Fires at context_hint, context_block, session_soft, session_hard, week_soft,
# at most once per 10 minutes per session unless the level changed. Marker files live under
# ${LIMIT_WAECHTER_HOME:-~/.claude/limit-waechter}/hints/. Without a state file: silent.
. "$(dirname "$0")/lib.sh"
[ -f "$LIMIT_STATE" ] || exit 0
LW_HOME=${LIMIT_WAECHTER_HOME:-$HOME/.claude/limit-waechter}
sid=$(json .session_id | tr -cd 'A-Za-z0-9._-'); [ -n "$sid" ] || sid=unknown

# Own session entry first (context levels are per session), global level as fallback.
level=$(jq -r --arg s "$sid" '(.sessions[$s].level // .level) // empty' "$LIMIT_STATE" 2>/dev/null)
case "$level" in
  context_hint | context_block | session_soft | session_hard | week_soft) ;;
  *) exit 0 ;;
esac

marker="$LW_HOME/hints/$sid"
if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$level" ] && [ -z "$(find "$marker" -mmin +10 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$LW_HOME/hints" 2>/dev/null && printf '%s' "$level" >"$marker" 2>/dev/null

ctx=$(jq -r --arg s "$sid" '.sessions[$s].context_percentage // empty | tostring' "$LIMIT_STATE" 2>/dev/null)
fh=$(jq -r '.rate.five_hour.used_percentage // empty | tostring' "$LIMIT_STATE" 2>/dev/null)
sd=$(jq -r '.rate.seven_day.used_percentage // empty | tostring' "$LIMIT_STATE" 2>/dev/null)
reset=$(jq -r '.resets_at // empty' "$LIMIT_STATE" 2>/dev/null)
case "$level" in
  context_hint)  msg="limit-waechter: context fill of this session at ${ctx:-?} % (hint at 60). Write the open points as an issue comment, then compact." ;;
  context_block) msg="limit-waechter: context fill of this session at ${ctx:-?} % (block at 80). No new subagents until compacted: write the open points as an issue comment, then compact." ;;
  session_soft)  msg="limit-waechter: five-hour window at ${fh:-?} % (soft at 85, hard stop at 95, reset ${reset:-?}). Finish started work, start nothing large." ;;
  session_hard)  msg="limit-waechter: five-hour window at ${fh:-?} % (hard, reset ${reset:-?}). No new subagents: stop subagents, write the state to the issue, schedule the continuation, halt (CLAUDE.md, Limit watcher)." ;;
  week_soft)     msg="limit-waechter: seven-day window at ${sd:-?} % (soft, reset ${reset:-?}). No new subagents: give each subagent a deadline, collect reports, write the state to the issue, plan for the weekly reset (CLAUDE.md, Limit watcher)." ;;
esac
jq -n --arg m "$msg" '{systemMessage: $m}'
exit 0
