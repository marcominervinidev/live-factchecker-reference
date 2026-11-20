#!/bin/sh
# ci-local (ticket #68 AC6): the required checks of ci.yml and pr.yml on this checkout before a push, so a push is
# not the first run. Node and Python checks in the toolbox (scripts/tb), scanners in tool images pinned like the
# workflows (tools/check_ci_pins.py keeps them equal), stages 2a and 3 on throwaway stacks of COMPOSE_PROJECT_NAME.
# No GitHub: the base is the local BASE (default origin/main, fetch it first). Every check runs; the summary lists
# each exit code and exit 1 means one failed. Not here, CI only: Sonar, Fallow, image build with Trivy, Trivy on the
# third-party images, stage 2b (browsers), PR title.
# Usage: make ci-local [BASE=<ref>]   (the Makefile passes LFC_RUN, empty on the CI runner, and MAKE)
set -u
# Ctrl-C and TERM end the run through the EXIT trap below (stack down, temp dir gone), with the usual exit codes.
trap 'exit 130' INT
trap 'exit 143' TERM

GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
HADOLINT_IMAGE=hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d
SEMGREP_IMAGE=semgrep/semgrep:1.178.0@sha256:32e459968daabe7ab86968184a29109b9564aa00392401156f9788452b42786b
# The runner's python3 (ubuntu-24.04: 3.12.3) for the Golden Set harness: under the toolbox's 3.11 its mock-run
# regression hash differs. The full image, not slim: since #67 the harness tests need git (the report names the
# measured commit). One python pin for every use (tools/check_ci_pins.py).
PYTHON_IMAGE=python:3.12.3-bookworm@sha256:25dee7f137aa44c4962d21346385737eb81954b6f06f519fcc348b67f6483d3c

RUN=${LFC_RUN-scripts/tb}
MAKE=${MAKE:-make}
base=${BASE:-origin/main}
git rev-parse --verify --quiet "$base^{commit}" >/dev/null || {
  echo "ci-local: base $base not found (git fetch origin main)" >&2
  exit 2
}
# ci-local checks what a push would send: the toolbox, the scanners and the stacks read the working tree, so it must
# equal HEAD (untracked files included; git-ignored ones do not count).
dirty=$(git status --porcelain --untracked-files=normal)
if [ -n "$dirty" ]; then
  echo "ci-local: the working tree differs from HEAD; commit first, ci-local checks what you push:" >&2
  printf '%s\n' "$dirty" >&2
  exit 2
fi
common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
gitdir=$(git rev-parse --absolute-git-dir)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ci-local.XXXXXX") && tmp=$(cd "$tmp" && pwd -P) || exit 2
# Set before a throwaway stack starts, cleared once it is down: an interrupted run takes its stack down on the way out.
stack_up=
cleanup() {
  if [ -n "$stack_up" ]; then
    echo "ci-local: taking the throwaway stack of ${COMPOSE_PROJECT_NAME:-?} down" >&2
    "$MAKE" --no-print-directory ci-stack-down >/dev/null 2>&1 || echo "ci-local: ci-stack-down failed, see docker compose ls" >&2
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT
# The tool images (Semgrep, the Golden Set harness) read an export of HEAD's tracked files, never the checkout with
# its node_modules, .secrets or .git: git archive writes exactly HEAD, which the clean tree above equals.
src=$tmp/src
mkdir "$src" && git archive --format=tar -o "$tmp/src.tar" HEAD && tar -xf "$tmp/src.tar" -C "$src" || exit 2
results=
failed=0
total=0

# tb <command...>: in the toolbox, or directly where LFC_RUN is empty (CI runner).
tb() {
  if [ -n "$RUN" ]; then "$RUN" "$@"; else "$@"; fi
}
# check <name> <command...>: runs the command without stdin, records its exit code and seconds.
check() {
  name=$1
  shift
  printf '\n== %s\n' "$name"
  t0=$(date +%s)
  "$@" </dev/null
  rc=$?
  total=$((total + 1))
  [ "$rc" -eq 0 ] || failed=$((failed + 1))
  results="$results$(printf '%4s %5ss  %s' "$rc" "$(($(date +%s) - t0))" "$name")
"
}
skip() {
  results="$results$(printf '%4s %6s  %s (%s)' - '' "$1" "$2")
"
}
# tool <docker run arguments...>: a tool image without capabilities, privilege gain or root, removed afterwards.
tool() {
  docker run --rm --cap-drop ALL --security-opt no-new-privileges:true --user "$(id -u):$(id -g)" -e HOME=/tmp "$@"
}
# gitleaks sees the git metadata only (read-only, at its host path; GIT_DIR is this checkout's, inside the common dir
# for a worktree) plus its two config files from the export, as ci.yml reads them from the checkout. No network.
# gitleaks exits 0 when git fails under it ("stderr is not empty", 0 commits scanned): that counts as a failure here.
gitleaks_history() {
  out=$(tool --network none -v "$common:$common:ro" -v "$src/.gitleaks.toml:/cfg/.gitleaks.toml:ro" \
    -v "$src/.gitleaksignore:/cfg/.gitleaksignore:ro" -e GIT_DIR="$gitdir" \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
    "$GITLEAKS_IMAGE" git --redact --no-banner --no-color --config /cfg/.gitleaks.toml \
    --gitleaks-ignore-path /cfg/.gitleaksignore --log-opts=HEAD "$gitdir" 2>&1)
  rc=$?
  printf '%s\n' "$out"
  case "$out" in
    *" ERR "* | *" 0 commits scanned"*)
      echo "gitleaks: git failed or no commit scanned" >&2
      return 1
      ;;
  esac
  return $rc
}
hadolint_all() {
  st=0
  for file in $(git ls-files '**/Dockerfile' 'Dockerfile'); do
    echo "-- $file"
    tool -i --network none "$HADOLINT_IMAGE" hadolint - <"$file" || st=1
  done
  return $st
}
# Semgrep reads the export read-only at /src (it insists on that path); it needs the network for its rule packs. Its
# report goes to JSON; the text output would show the matched lines, a secret included. tools/check_semgrep_report.py
# (#187) evaluates it from the export in the pinned Python image, without network: rule, path and line per finding,
# type, path and rule per error; red on a finding, an error outside the Golden Set pages, a bad report or a non-zero
# Semgrep exit code, which it gets as --semgrep-exit. Its exit code is the check's.
# --timeout 30 (per rule and file; Semgrep's default is 5 s): under machine load single files timed out at 5 s and
# turned the check red with no change to the code. Owner decision 2026-11-19 ("187 a", fixed limit ~30 s), #200.
semgrep_scan() {
  mkdir -p "$tmp/semgrep"
  tool -v "$src:/src:ro" -v "$tmp/semgrep:/out" -w /src "$SEMGREP_IMAGE" semgrep scan --timeout 30 --error \
    --metrics=off --quiet --json -o /out/semgrep.json --config p/typescript --config p/nodejsscan \
    --config p/dockerfile --config p/github-actions --config p/secrets
  rc=$?
  tool --network none -v "$src:/src:ro" -v "$tmp/semgrep:/out:ro" -w /src "$PYTHON_IMAGE" \
    python3 -I tools/check_semgrep_report.py --semgrep-exit "$rc" /out/semgrep.json
}
# As ci.yml golden-mock, on the export (the harness writes its budget lock next to evals/budget.json). No network.
golden_mock() {
  [ -f evals/run.py ] || {
    echo "no evals/run.py"
    return 0
  }
  # The export has no .git, so the harness runs on a copy inside a throwaway repository with one empty commit: its
  # commit test needs a checkout, not this one's history (the report's commit line is not checked here).
  # shellcheck disable=SC2016 # $(mktemp -d) runs in the container
  tool --network none -v "$src:/src:ro" "$PYTHON_IMAGE" \
    sh -c 'w=$(mktemp -d) && cp -R /src/evals "$w/" && cd "$w" &&
      git init -q && git -c user.name=ci-local -c user.email=ci-local@invalid commit -q --allow-empty -m export &&
      cd evals && python3 -I -m unittest discover -s tests &&
      python3 -I run.py run --config configs/baseline.json --golden golden --out "$(mktemp -d)" --mock'
}
# One line "<stage> <workspace> <script>" per entry of the CI test matrices.
affected() {
  # shellcheck disable=SC2016 # $1 is the base, expanded by bash in the toolbox
  tb bash -o pipefail -c 'node scripts/ci/affected.ts "$1" |
    jq -Rr "sub(\"^[a-z]+=\"; \"\") | fromjson | .[] | \"\(.stage) \(.name) \(.script)\""' _ "$base" >"$tmp/affected"
}
docs_flag() { tb node scripts/ci/docs-only.ts "$base" >"$tmp/docs"; }
stack_tests() {
  stack_up=1
  LFC_STACK_TEST=1 "$MAKE" --no-print-directory ci-secrets ci-stack-up test-api test-e2e
  rc=$?
  if "$MAKE" --no-print-directory ci-stack-down; then stack_up=; else [ "$rc" -ne 0 ] || rc=1; fi
  return $rc
}
# make test-integration takes its Redis down itself (trap); the flag covers a signal that hits this script first.
integration() {
  stack_up=1
  WS=$1 "$MAKE" --no-print-directory test-integration
  rc=$?
  stack_up=
  return $rc
}

check "toolbox: pnpm install --frozen-lockfile" tb pnpm install --frozen-lockfile
check "repo: hook regression test" tb sh .claude/hooks/test-hooks.sh
check "repo: agent models in sync" tb python3 -I tools/sync_agent_models.py --check
check "repo: docs coverage" tb python3 -I tools/check_docs_coverage.py
check "repo: context budget" tb python3 -I tools/check_context_budget.py
check "repo: tool image pins" tb python3 -I tools/check_ci_pins.py
check "repo: tool tests" tb python3 -I -m unittest discover -s tools/tests
check "repo: limit watcher tests" tb python3 -I -m unittest discover -s tools/limit-waechter/tests
check "repo: commit messages $base..HEAD" tb python3 -I tools/check_commits.py "$base..HEAD"
check "repo: gitleaks (full history)" gitleaks_history
check "pr: size (production lines)" tb python3 -I tools/check_pr_size.py "$base" HEAD
check "pr: eval report" tb python3 -I tools/check_eval_report.py "$base" HEAD
check "pr: contract check" tb scripts/check-contract-change.sh "$base"
check "stage 0: typecheck" tb pnpm typecheck
check "stage 0: lint" tb pnpm lint
check "stage 0: format" tb pnpm format:check
check "stage 0: dependency-cruiser" tb pnpm depcruise
check "Golden Set stage 1 (harness tests, mock run)" golden_mock
check "affected workspaces since $base" affected
while read -r stage ws script; do
  case "$stage" in
    1) check "stage 1: $ws" tb pnpm --filter "$ws" run "$script" ;;
    *) ;;
  esac
done <"$tmp/affected"
check "red before green" tb sh tools/check_red_before_green.sh "$base"
check "pr: hadolint" hadolint_all
check "pr: semgrep" semgrep_scan
while read -r stage ws _; do
  case "$stage" in
    2a) check "stage 2a: $ws (throwaway Redis)" integration "$ws" ;;
    1) ;;
    *) skip "stage $stage: $ws" "CI only, the toolbox has no browsers" ;;
  esac
done <"$tmp/affected"
check "docs-only flag since $base" docs_flag
if [ "$(cat "$tmp/docs")" = docs_only=true ]; then
  skip "stages 3 and 4: stack tests" "documentation only, skipped as in pr.yml"
else
  check "stages 3 and 4: stack tests (throwaway stack)" stack_tests
fi
# Required in CI, not here: named in every summary so a green ci-local is never read as a green PR.
skip "pr: Fallow audit (new findings only)" "CI only"
skip "pr: image build + Trivy" "CI only"
skip "pr: Trivy on the third-party images" "CI only"
skip "pr: PR title (Conventional Commit)" "CI only"
skip "ci: SonarQube Cloud (advisory)" "CI only"

printf '\n== ci-local summary: base %s (%s), HEAD %s\nexit  time  check\n%s' \
  "$base" "$(git rev-parse --short "$base")" "$(git rev-parse --short HEAD)" "$results"
echo "ci-local: $failed of $total checks failed"
[ "$failed" -eq 0 ]
