#!/bin/sh
# Status-line command for Claude Code and collector of the limit watcher (task #54).
# Reads the status-line JSON on stdin, writes <HOME>/sessions/<session_id>.json atomically and
# prints one line for the status bar. Never fails the status line: always exit 0.
# HOME is ${LIMIT_WAECHTER_HOME:-~/.claude/limit-waechter}. Needs only /bin/sh, jq, date, mktemp.
LW_HOME=${LIMIT_WAECHTER_HOME:-$HOME/.claude/limit-waechter}

input=$(cat 2>/dev/null) || input=
if [ -z "$input" ] || ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  echo "LW: no status-line input"; exit 0
fi

sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9._-')
[ -n "$sid" ] || sid="pid-$$"
now=$(date +%s)

# 1. collect: whatever rate_limits and context_window fields exist; absent windows become null (not 0).
if mkdir -p "$LW_HOME/sessions" 2>/dev/null; then
  tmp=$(mktemp "$LW_HOME/sessions/.$sid.XXXXXX" 2>/dev/null) && {
    if printf '%s' "$input" | jq -c --arg sid "$sid" --argjson ts "$now" '{
        ts: $ts, session_id: $sid, version: (.version // null),
        model: (.model.display_name // .model.id // null), cwd: (.cwd // null),
        five_hour: (.rate_limits.five_hour // null),
        seven_day: (.rate_limits.seven_day // null),
        context_window: (.context_window // null)
      }' >"$tmp" 2>/dev/null; then
      mv -f "$tmp" "$LW_HOME/sessions/$sid.json" 2>/dev/null || rm -f "$tmp"
    else
      rm -f "$tmp"
    fi
  }
fi

# 2. display: model, five-hour %, week %, context %, watcher level.
line=$(printf '%s' "$input" | jq -r '
  def p: if . == null then "?" else (. | round | tostring) end;
  def t: if . == null then "" else (" (" + (. | strftime("%H:%M")) + ")") end;
  "[" + (.model.display_name // .model.id // "?") + "]"
  + " 5h " + (.rate_limits.five_hour.used_percentage | p) + "%" + (.rate_limits.five_hour.resets_at | t)
  + " | 7d " + (.rate_limits.seven_day.used_percentage | p) + "%"
  + " | ctx " + (.context_window.used_percentage | p) + "%"' 2>/dev/null) || line="[?]"
level=$(jq -r '.level // empty' "$LW_HOME/state.json" 2>/dev/null)
[ -n "$level" ] || level="n/a"
printf '%s | LW %s\n' "$line" "$level"
exit 0
