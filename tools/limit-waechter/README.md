# Limit watcher

## Purpose
Deterministic watcher (no agent) for the Claude Code usage windows and the context fill of each session (task "Limit-Wächter bauen" of the process map; research `docs/research/limit-waechter.md` in the planning repo). `statusline.sh` is the status-line command and collects the status-line JSON per session; `watch.py` runs every 60 s under launchd, computes levels with hysteresis and writes `state.json`, which the hooks `limit-guard.sh` and `context-hint.sh` read.

## Boundaries
Levels: `session_hard` (five-hour window ≥ 95 %), `week_soft` (seven-day ≥ 99 %), `context_block` (session context ≥ 80 %), `context_hint` (≥ 60 %), `session_soft` (five-hour ≥ 85 %, informational), `ok`; a level clears 5 points below its threshold. `limit-guard.sh` denies the Agent tool at `session_hard`, `week_soft` and the session's own `context_block`; `context-hint.sh` adds a non-blocking message at most every 10 minutes per session. The watcher never stops a session itself; the main session follows the rule in `CLAUDE.md` (Limit watcher). Delivery into a running session's inbox socket is best effort: the wire format is undocumented.

## Pitfalls
- The status-line data exists only for claude.ai Pro/Max logins and only after the first API answer of a session; windows can be missing. Values drift between parallel terminals; the watcher takes the maximum.
- `~/.claude.json` `cachedUsageUtilization` is an undocumented fallback, refreshed only by `/usage`.
- State lives outside the repo (`${LIMIT_WAECHTER_HOME:-~/.claude/limit-waechter}`); never commit it.
- Python stdlib only, `python3 -I`; shell needs jq.

## Commands
- Install (owner, once): `tools/limit-waechter/install.sh` (prints the `statusLine` snippet for `~/.claude/settings.json`); `--dry-run` shows the plist. Remove: `tools/limit-waechter/uninstall.sh`.
- Check: `cat ~/.claude/limit-waechter/state.json`, `tail -f ~/.claude/limit-waechter/events.log`.
- Dry run without side effects: `LIMIT_WAECHTER_HOME=$TMPDIR/lw python3 -I tools/limit-waechter/watch.py --dry-run`.
- Tests: `python3 -I -m unittest discover -s tools/limit-waechter/tests`; hooks: `sh .claude/hooks/test-hooks.sh`.
