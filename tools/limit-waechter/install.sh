#!/bin/sh
# Install the limit watcher as a launchd user agent and print the status-line settings snippet.
# Usage: tools/limit-waechter/install.sh [--dry-run]
# Touches: ~/Library/LaunchAgents/com.lfc.limit-waechter.plist, ${LIMIT_WAECHTER_HOME:-~/.claude/limit-waechter}/
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(cd "$DIR/../.." && pwd)
LW_HOME=${LIMIT_WAECHTER_HOME:-$HOME/.claude/limit-waechter}
LABEL=com.lfc.limit-waechter
AGENTS="$HOME/Library/LaunchAgents"
PLIST="$AGENTS/$LABEL.plist"
PYTHON=$(command -v python3 || true)
[ -n "$PYTHON" ] || { echo "install: python3 not found in PATH" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || echo "install: warning, jq not in PATH; statusline.sh needs it" >&2

render() {
  sed -e "s|__PYTHON__|$PYTHON|g" -e "s|__REPO_DIR__|$REPO_DIR|g" -e "s|__LW_HOME__|$LW_HOME|g" "$DIR/$LABEL.plist"
}

if [ "${1:-}" = "--dry-run" ]; then
  echo "# would write $PLIST:"; render; echo
else
  mkdir -p "$LW_HOME/sessions" "$AGENTS"
  chmod 700 "$LW_HOME"
  chmod +x "$DIR/statusline.sh" "$DIR/watch.py"
  render >"$PLIST"
  plutil -lint "$PLIST" >/dev/null
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed $PLIST (python: $PYTHON, state: $LW_HOME)"
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E 'state =|runs =|last exit' || true
fi

cat <<EOF

Add to ~/.claude/settings.json (merge with existing keys):
{
  "statusLine": {
    "type": "command",
    "command": "$DIR/statusline.sh",
    "refreshInterval": 60
  }
}

Check: tail -f $LW_HOME/events.log ; cat $LW_HOME/state.json
EOF
