#!/bin/sh
# Remove the limit watcher launchd agent. Keeps the state directory (delete it by hand if wanted).
set -eu
LABEL=com.lfc.limit-waechter
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "removed $PLIST"
echo "state left in ${LIMIT_WAECHTER_HOME:-$HOME/.claude/limit-waechter}; remove the statusLine key from ~/.claude/settings.json if no longer wanted"
