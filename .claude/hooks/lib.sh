# Shared helpers for the Claude Code hooks of live-factchecker-v2.
# Hooks are comfort and early warning only; the real guards are lefthook and CI (CLAUDE.md).
# Requires only /bin/sh, git and jq.

REPO_ROOT=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
SECRETS_DIR_DEFAULT="$HOME/.config/live-factchecker/secrets"
FROZEN_DIR="$REPO_ROOT/.claude/frozen"
LIMIT_STATE="${LIMIT_WAECHTER_STATE:-$HOME/.claude/limit-waechter/state.json}"
OWNER_PROJECTS='live-factchecker-v2|live-factchecker|lfc-owner'

hook_input=$(cat)
json() { printf '%s' "$hook_input" | jq -r "$1 // empty"; }

# Deny a PreToolUse call with a reason (JSON decision, exit 0) so the agent sees why.
deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}
ask() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
  exit 0
}

# All paths frozen by open manifests (one per line, repo-relative).
frozen_paths() {
  [ -d "$FROZEN_DIR" ] || return 0
  for m in "$FROZEN_DIR"/*.json; do
    [ -f "$m" ] || continue
    jq -r '.paths[]? // empty' "$m" 2>/dev/null
  done
}

# Frozen files that differ from their gate-1 content, from the candidates on stdin (one per line).
# A manifest with a "sha256" map is checked by content, so frozen files committed on the task branch
# by the main session pass; a manifest without it falls back to "any change is a hit".
frozen_changed() {
  candidates=$(cat)
  [ -d "$FROZEN_DIR" ] || return 0
  for m in "$FROZEN_DIR"/*.json; do
    [ -f "$m" ] || continue
    if jq -e '.sha256' "$m" >/dev/null 2>&1; then
      jq -r '.sha256 | to_entries[] | "\(.key) \(.value)"' "$m" | while read -r p want; do
        [ -f "$REPO_ROOT/$p" ] || continue
        got=$( (sha256sum "$REPO_ROOT/$p" 2>/dev/null || shasum -a 256 "$REPO_ROOT/$p") | cut -d' ' -f1)
        [ "$got" = "$want" ] || printf '%s\n' "$p"
      done
    else
      jq -r '.paths[]? // empty' "$m" | while IFS= read -r p; do
        [ -n "$p" ] || continue
        printf '%s\n' "$candidates" | while IFS= read -r f; do
          case "$f" in ("$p" | "$p"/*) printf '%s\n' "$f" ;; esac
        done
      done
    fi
  done | sort -u
}

rel_path() { printf '%s' "${1#"$REPO_ROOT"/}"; }

toolbox_running() {
  [ -n "${LFC_TOOLBOX:-}" ] && [ "$(docker inspect -f '{{.State.Running}}' "$LFC_TOOLBOX" 2>/dev/null)" = "true" ]
}
in_toolbox() { docker exec -w /workspace "$LFC_TOOLBOX" "$@"; }
