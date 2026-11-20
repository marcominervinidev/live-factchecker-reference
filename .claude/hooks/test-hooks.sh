#!/bin/sh
# Regression test for the hooks: synthetic input, no real secrets, prints the decision per case.
# Usage: .claude/hooks/test-hooks.sh
set -u
HOOKS=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HOOKS/../.." && pwd)
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/lfc-hooks.XXXXXX"); trap 'rm -rf "$SCRATCH"' EXIT
fail=0
decision() { [ -s "$SCRATCH/out" ] || { echo allow; return; }; jq -r '.hookSpecificOutput.permissionDecision // "allow"' "$SCRATCH/out" 2>/dev/null || echo allow; }
expect() { # label expected-decision hook json [env]
  printf '%s' "$4" | env CLAUDE_PROJECT_DIR="$REPO" ${5:-} "$HOOKS/$3" >"$SCRATCH/out" 2>"$SCRATCH/err"; code=$?
  got=$(decision); [ "$code" = 2 ] && got=block
  if [ "$got" = "$2" ]; then v=ok; else v="FAIL (expected $2, got $got, exit $code)"; fail=1; fi
  printf '%-58s %-6s %s\n' "$1" "$got" "$v"
}
B='{"tool_name":"Bash","tool_input":{"command":"%s"}}'
E='{"tool_name":"Edit","tool_input":{"file_path":"%s"}}'
S="$HOME/.config/live-factchecker/secrets"

echo "== guard-secrets"
expect "Read .env"                       deny  guard-secrets.sh "$(printf "$E" "$REPO/.env")"
expect "Read .env.example"               allow guard-secrets.sh "$(printf "$E" "$REPO/.env.example")"
expect "Read secrets dir"                deny  guard-secrets.sh "$(printf "$E" "$S/anthropic_api_key")"
expect "Bash cat .env"                   deny  guard-secrets.sh "$(printf "$B" 'cat .env')"
expect "Bash echo \$ANTHROPIC_API_KEY"   deny  guard-secrets.sh "$(printf "$B" 'echo $ANTHROPIC_API_KEY')"
expect "Bash grep SECRETS_DIR Makefile"  allow guard-secrets.sh "$(printf "$B" 'grep SECRETS_DIR Makefile')"
expect "Bash docker exec cat /run/secrets" deny guard-secrets.sh "$(printf "$B" 'docker compose -p lfc-1-1 exec redis cat /run/secrets/x')"
expect "Bash pnpm test"                  allow guard-secrets.sh "$(printf "$B" 'pnpm test')"

echo "== git-pipe"
expect "git commit | tail"               deny  git-pipe.sh "$(printf "$B" 'git commit -m x | tail -1')"
expect "gh pr create | cat"              deny  git-pipe.sh "$(printf "$B" 'gh pr create --title x | cat')"
expect "git push --no-verify"            deny  git-pipe.sh "$(printf "$B" 'git push --no-verify')"
expect "git log | head"                  allow git-pipe.sh "$(printf "$B" 'git log --oneline | head -3')"
expect "git status && git commit"        allow git-pipe.sh "$(printf "$B" 'git status && git commit -m x')"

echo "== owner-stack"
expect "docker compose up (no project)"  deny  owner-stack.sh "$(printf "$B" 'docker compose up -d')"
expect "docker compose -p lfc-12-t1 up"  allow owner-stack.sh "$(printf "$B" 'docker compose -p lfc-12-t1 up -d')"
expect "COMPOSE_PROJECT_NAME=lfc-12-t1"  allow owner-stack.sh "$(printf "$B" 'COMPOSE_PROJECT_NAME=lfc-12-t1 docker compose up -d')"
expect "docker compose -p live-factchecker-v2 up" deny owner-stack.sh "$(printf "$B" 'docker compose -p live-factchecker-v2 up')"
expect "docker compose ps"               allow owner-stack.sh "$(printf "$B" 'docker compose ps')"
expect "docker run --name lfc-12-t1-x"   allow owner-stack.sh "$(printf "$B" 'docker run --rm --name lfc-12-t1-x alpine true')"
expect "docker run (no name)"            deny  owner-stack.sh "$(printf "$B" 'docker run --rm alpine true')"
expect "make up"                         deny  owner-stack.sh "$(printf "$B" 'make up')"
expect "make test-unit"                  allow owner-stack.sh "$(printf "$B" 'make test-unit')"

echo "== contracts"
expect "Edit packages/contracts/x.ts"    ask   contracts.sh "$(printf "$E" "$REPO/packages/contracts/src/x.ts")"
expect "Edit README"                     allow contracts.sh "$(printf "$E" "$REPO/README.md")"

echo "== frozen-manifest (scratch manifest)"
mkdir -p "$SCRATCH/repo/.claude/frozen" "$SCRATCH/repo/features"
printf '{"issue":123,"paths":["features/claims.feature","tests/acceptance/123"]}' > "$SCRATCH/repo/.claude/frozen/123.json"
F='{"tool_name":"Edit","tool_input":{"file_path":"%s"}}'
R="$SCRATCH/repo"
expect "Edit frozen feature"             deny  frozen-manifest.sh "$(printf "$F" "$R/features/claims.feature")" "CLAUDE_PROJECT_DIR=$R"
expect "Edit file under frozen dir"      deny  frozen-manifest.sh "$(printf "$F" "$R/tests/acceptance/123/a.ts")" "CLAUDE_PROJECT_DIR=$R"
expect "Edit unrelated src"              allow frozen-manifest.sh "$(printf "$F" "$R/src/a.ts")" "CLAUDE_PROJECT_DIR=$R"
expect "Edit manifest without unlock"    deny  frozen-manifest.sh "$(printf "$F" "$R/.claude/frozen/123.json")" "CLAUDE_PROJECT_DIR=$R"
expect "Edit manifest with FROZEN_UNLOCK" allow frozen-manifest.sh "$(printf "$F" "$R/.claude/frozen/123.json")" "CLAUDE_PROJECT_DIR=$R FROZEN_UNLOCK=123"

echo "== limit-guard (scratch state)"
printf '{"level":"session_hard","resets_at":"2026-10-18T20:00:00Z"}' > "$SCRATCH/state.json"
A='{"tool_name":"Agent","tool_input":{"prompt":"x"}}'
expect "Agent while session_hard"        deny  limit-guard.sh "$A" "LIMIT_WAECHTER_STATE=$SCRATCH/state.json"
printf '{"level":"ok"}' > "$SCRATCH/state.json"
expect "Agent while ok"                  allow limit-guard.sh "$A" "LIMIT_WAECHTER_STATE=$SCRATCH/state.json"
expect "Agent without state file"        allow limit-guard.sh "$A" "LIMIT_WAECHTER_STATE=$SCRATCH/none.json"

echo "== test-integrity"
T='{"tool_name":"Edit","tool_input":{"file_path":"%s","new_string":"%s"}}'
W='{"tool_name":"Write","tool_input":{"file_path":"%s","content":"%s"}}'
expect "it.skip in unit test"             deny  test-integrity.sh "$(printf "$T" "$REPO/services/a/src/x.test.ts" 'it.skip(\"drops\", () => {})')"
expect "describe.only in unit test"       deny  test-integrity.sh "$(printf "$T" "$REPO/services/a/src/x.test.ts" 'describe.only(\"x\", () => {})')"
expect "xit in unit test"                 deny  test-integrity.sh "$(printf "$T" "$REPO/services/a/src/x.test.ts" 'xit(\"x\", () => {})')"
expect "@quarantine in feature"           deny  test-integrity.sh "$(printf "$W" "$REPO/tests/api/features/live.feature" '@issue-12 @quarantine\\nScenario: x')"
expect "test.fixme in step file"          deny  test-integrity.sh "$(printf "$T" "$REPO/tests/e2e/steps/live.ts" 'test.fixme()')"
expect "plain it in unit test"            allow test-integrity.sh "$(printf "$T" "$REPO/services/a/src/x.test.ts" 'it(\"drops a duplicate\", () => {})')"
expect "skipWhile in production code"     allow test-integrity.sh "$(printf "$T" "$REPO/services/a/src/x.ts" 'list.skip(1)')"
expect "@quarantine with owner unlock"    allow test-integrity.sh "$(printf "$W" "$REPO/tests/api/features/live.feature" '@quarantine')" "QUARANTINE_BY_OWNER=1"

echo "== stop-tests"
expect "stop_hook_active is a no-op"     allow stop-tests.sh '{"stop_hook_active":true}'
FR="$SCRATCH/frozen-repo"; mkdir -p "$FR/.claude/frozen" "$FR/features"
( cd "$FR" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base \
  && git update-ref refs/remotes/origin/main HEAD && printf 'Feature: x\n' > features/x.feature \
  && h=$( (sha256sum features/x.feature 2>/dev/null || shasum -a 256 features/x.feature) | cut -d' ' -f1) \
  && printf '{"issue":9,"paths":["features/x.feature"],"sha256":{"features/x.feature":"%s"}}' "$h" > .claude/frozen/9.json \
  && git add -A && git -c user.email=t@t -c user.name=t commit -q -m frozen )
expect "frozen file committed unchanged on task branch" allow stop-tests.sh '{}' "CLAUDE_PROJECT_DIR=$FR"
printf 'Feature: y\n' > "$FR/features/x.feature"
expect "frozen file edited after gate 1"  block stop-tests.sh '{}' "CLAUDE_PROJECT_DIR=$FR"
# expect_msg checks for a systemMessage instead of a decision.
expect_msg() { # label yes|no hook json [env]
  printf '%s' "$4" | env CLAUDE_PROJECT_DIR="$REPO" ${5:-} "$HOOKS/$3" >"$SCRATCH/out" 2>"$SCRATCH/err"; code=$?
  if [ -s "$SCRATCH/out" ] && jq -e '.systemMessage' "$SCRATCH/out" >/dev/null 2>&1; then got=yes; else got=no; fi
  if [ "$got" = "$2" ] && [ "$code" = 0 ]; then v=ok; else v="FAIL (expected $2, got $got, exit $code)"; fail=1; fi
  printf '%-58s %-6s %s\n' "$1" "$got" "$v"
}

echo "== limit-guard context levels (scratch state)"
LW="LIMIT_WAECHTER_STATE=$SCRATCH/state.json LIMIT_WAECHTER_HOME=$SCRATCH/lw"
A1='{"tool_name":"Agent","session_id":"s1","tool_input":{"prompt":"x"}}'
A2='{"tool_name":"Agent","session_id":"s2","tool_input":{"prompt":"x"}}'
printf '{"level":"context_block","sessions":{"s1":{"level":"context_block","context_level":"context_block","context_percentage":83},"s2":{"level":"ok","context_level":"ok","context_percentage":12}}}' > "$SCRATCH/state.json"
expect "Agent while own session context_block" deny  limit-guard.sh "$A1" "$LW"
expect "Agent in other session while s1 blocks" allow limit-guard.sh "$A2" "$LW"
printf '{"level":"context_block"}' > "$SCRATCH/state.json"
expect "Agent while global context_block, no detail" deny limit-guard.sh "$A1" "$LW"
printf '{"level":"context_hint","sessions":{"s1":{"level":"context_hint","context_level":"context_hint","context_percentage":65}}}' > "$SCRATCH/state.json"
expect "Agent while context_hint"          allow limit-guard.sh "$A1" "$LW"
printf '{"level":"week_soft","resets_at":"2026-10-20T00:00:00+02:00"}' > "$SCRATCH/state.json"
expect "Agent while week_soft"             deny  limit-guard.sh "$A1" "$LW"

echo "== context-hint (scratch state, marker dir)"
R1='{"tool_name":"Read","session_id":"s1","tool_input":{"file_path":"/x"}}'
printf '{"level":"context_hint","rate":{"five_hour":{"used_percentage":40},"seven_day":{"used_percentage":50}},"sessions":{"s1":{"level":"context_hint","context_level":"context_hint","context_percentage":65}}}' > "$SCRATCH/state.json"
expect_msg "hint at context_hint, first call"      yes context-hint.sh "$R1" "$LW"
expect_msg "hint repeated within 10 min: silent"   no  context-hint.sh "$R1" "$LW"
printf '{"level":"context_block","rate":{"five_hour":{"used_percentage":40}},"sessions":{"s1":{"level":"context_block","context_level":"context_block","context_percentage":82}}}' > "$SCRATCH/state.json"
expect_msg "level changed to context_block: message" yes context-hint.sh "$R1" "$LW"
expect     "context-hint never denies"              allow context-hint.sh "$R1" "$LW"
printf '{"level":"session_soft","resets_at":"2026-10-19T20:00:00+02:00","rate":{"five_hour":{"used_percentage":87}}}' > "$SCRATCH/state.json"
expect_msg "session_soft without session entry"     yes context-hint.sh "$R1" "$LW"
printf '{"level":"ok"}' > "$SCRATCH/state.json"
expect_msg "ok: silent"                             no  context-hint.sh "$R1" "$LW"
expect_msg "without state file: silent"             no  context-hint.sh "$R1" "LIMIT_WAECHTER_STATE=$SCRATCH/none.json LIMIT_WAECHTER_HOME=$SCRATCH/lw"

[ "$fail" = 0 ] && echo "all hook cases ok" || { echo "hook cases FAILED"; exit 1; }
