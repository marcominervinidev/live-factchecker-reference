#!/usr/bin/env bash
# Contract check (.claude/rules/contracts.md, ticket #25 AC12), run by pr.yml against the PR base. A change set
# that changes a schema under packages/contracts/src passes only with
#   1. its own commit: a commit that changes a schema touches nothing outside packages/contracts/;
#   2. an ADR reference: that commit's message names "ADR NNNN" and docs/adr/NNNN-*.md is added or changed
#      in the change set;
#   3. a higher schemaVersion in every changed schema that existed before; a changed shared building block
#      (an existing file without schemaVersion, e.g. common.ts) needs a bump of an existing schema;
#   4. contract tests: a changed packages/contracts/**/*.test.ts.
# Not schema changes: tests, src/testing/, src/index.ts (re-exports). Paths are read NUL-separated; an unusual
# path (anything but letters, digits, . _ / -) fails the check. Runs under bash 3.2 (macOS host) too.
# A renamed schema is compared with its old path. Usage: scripts/check-contract-change.sh <base-ref>
set -euo pipefail
# Byte semantics for the path check below: in a UTF-8 locale [A-Za-z] would also match umlauts.
export LC_ALL=C

base=${1:?usage: check-contract-change.sh <base-ref>}
mb=$(git merge-base "$base" HEAD)

plain() {
  case "$1" in
    *[!A-Za-z0-9._/-]*) echo "contract check FAILED: unusual path: $(printf '%s' "$1" | tr -c 'A-Za-z0-9._/-' '?')" >&2; exit 1 ;;
  esac
}
# Paths from a git command run with -z, one per line once each is known to be plain.
paths() { git -c core.quotePath=false "$@" | while IFS= read -r -d '' path; do plain "$path"; echo "$path"; done; }
# "<path> <path at the base>" per file changed under packages/contracts; the two differ for a rename.
changes() {
  git -c core.quotePath=false diff --name-status -z -M "$mb" HEAD -- packages/contracts \
    | while IFS= read -r -d '' status && IFS= read -r -d '' path; do
      old=$path
      case "$status" in R*) IFS= read -r -d '' path ;; esac
      plain "$old" && plain "$path" && echo "$path $old"
    done
}
# Schema files among lines whose first field is a path: tests, src/testing/ and src/index.ts are not schemas.
schemas_in() { awk '$1 ~ /^packages\/contracts\/src\/.*\.ts$/ && $1 !~ /\.test\.ts$|\/testing\/|^packages\/contracts\/src\/index\.ts$/'; }

contract_files=$(changes)
schemas=$(printf '%s\n' "$contract_files" | schemas_in)
if [ -z "$schemas" ]; then
  echo "contract check: no schema changes"
  exit 0
fi
echo "contract check: schema files changed (path, path at the base):"
printf '  %s\n' "$schemas"

errors=''
fail() { errors="${errors}  - $1"$'\n'; }
adrs=$(paths diff --name-only -z --diff-filter=AM "$mb" HEAD -- docs/adr)

for commit in $(git rev-list "$mb..HEAD"); do
  [ -n "$(paths diff-tree --no-commit-id --name-only -z -r "$commit" -- packages/contracts/src | schemas_in)" ] || continue
  short=$(git rev-parse --short "$commit")
  others=$(git diff-tree --no-commit-id --name-only -z -r "$commit" | tr '\0' '\n' | grep -vc '^packages/contracts/' || true)
  [ "$others" -eq 0 ] || fail "$short changes a schema together with $others file(s) outside packages/contracts/"
  adr=$(git log -1 --format=%B "$commit" | grep -oE 'ADR [0-9]{4}' | head -n 1 | cut -c5- || true)
  if [ -z "$adr" ]; then
    fail "$short changes a schema, but its message names no ADR (ADR NNNN)"
  elif ! printf '%s\n' "$adrs" | grep -q "^docs/adr/$adr-"; then
    fail "$short names ADR $adr, which this change set does not add or change under docs/adr/"
  fi
done

printf '%s\n' "$contract_files" | grep -qE '\.test\.ts( |$)' || fail "no contract test changed (packages/contracts/**/*.test.ts)"

# Highest `schemaVersion: z.literal(N)` in a file at a revision; empty if none.
version_at() {
  git show "$1:$2" 2>/dev/null | grep -oE 'schemaVersion: z\.literal\([0-9]+\)' | grep -oE '[0-9]+' | sort -n | tail -n 1 || true
}

bumped=0
shared=''
while read -r file before; do
  old=$(version_at "$mb" "$before")
  new=$(version_at HEAD "$file")
  if [ -z "$old" ] && [ -z "$new" ]; then
    if git cat-file -e "$mb:$before" 2>/dev/null; then shared="$shared $file"; fi
  elif [ -z "$old" ]; then
    echo "  $file: new schema (schemaVersion $new), not a bump"
  elif [ -z "$new" ]; then
    bumped=1 # a removed schema
  elif [ "$new" -gt "$old" ]; then
    echo "  $file: schemaVersion $old -> $new"
    bumped=1
  else
    fail "$file: schema changed, but schemaVersion went from $old to $new (must be higher)"
  fi
done <<< "$schemas"
[ -z "$shared" ] || [ "$bumped" -eq 1 ] || fail "shared building blocks changed without a schemaVersion bump of an existing schema:$shared"

if [ -n "$errors" ]; then
  printf 'contract check FAILED (.claude/rules/contracts.md, skill new-contract):\n%s' "$errors" >&2
  exit 1
fi
echo "contract check: ok"
