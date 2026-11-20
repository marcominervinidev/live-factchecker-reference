#!/bin/sh
# Red before green (docs/process/test-strategy.md, rules in .claude/frozen/README.md): every frozen test file this
# branch brings must FAIL on the PR base for the right reason. The logic lives in tools/check_red_before_green.py
# (tasks, workspace roots, Python tests, bootstrap base); this entry point stays what ci.yml calls.
# Usage: sh tools/check_red_before_green.sh <base-ref>
set -eu
exec python3 -I "$(dirname "$0")/check_red_before_green.py" "$@"
