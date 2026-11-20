#!/bin/sh
# PreToolUse: agents never read, print or write secrets (CLAUDE.md, Security).
. "$(dirname "$0")/lib.sh"
secrets_dir=${SECRETS_DIR:-$SECRETS_DIR_DEFAULT}
tool=$(json '.tool_name')

is_env_file() {
  case "$(basename -- "$1")" in .env.example) return 1 ;; .env | .env.*) return 0 ;; esac
  return 1
}
check_path() {
  [ -n "$1" ] || return 0
  case "$1" in
    "$secrets_dir"* | *"/.config/live-factchecker/secrets"* | "~/.config/live-factchecker/secrets"*)
      deny "guard-secrets: path is inside the secrets directory. Agents never touch secrets; ask the owner." ;;
  esac
  is_env_file "$1" && deny "guard-secrets: $1 is an .env file. Agents never read or write .env files."
  return 0
}

case "$tool" in
  Bash)
    cmd=$(json '.tool_input.command')
    printf '%s' "$cmd" | sed 's/\.env\.example//g' \
      | grep -Eq '(^|[^A-Za-z0-9_./-])(\./)?\.env(\.[A-Za-z0-9_-]+)?([^A-Za-z0-9_.-]|$)' \
      && deny "guard-secrets: command references an .env file."
    printf '%s' "$cmd" | grep -Eq 'live-factchecker/secrets|\$\{?SECRETS_DIR' \
      && deny "guard-secrets: command references the secrets directory."
    printf '%s' "$cmd" | grep -Eq '/run/secrets' \
      && deny "guard-secrets: command references secrets mounted in a container."
    printf '%s' "$cmd" | grep -Eq '(^|[;&|(]) *(make [^;&|]*secrets-init|((ba)?sh +)?(\./)?scripts/secrets-init\.sh)' \
      && deny "guard-secrets: command runs secrets-init; the owner does that."
    printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z_])(ANTHROPIC|GEMINI|DEEPGRAM|OPENAI|BRAVE)_API_KEY' \
      && printf '%s' "$cmd" | grep -Eq 'echo|printf|cat|env\b|printenv|export -p' \
      && deny "guard-secrets: command would print an API key."
    ;;
  *)
    check_path "$(json '.tool_input.file_path')"
    check_path "$(json '.tool_input.notebook_path')"
    check_path "$(json '.tool_input.path')"
    check_path "$(json '.tool_input.pattern')"
    ;;
esac
exit 0
