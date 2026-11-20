#!/usr/bin/env python3
"""PR size in production lines (docs/process/pr-format.md): warn over 400, block over 800. Stdlib only.

Usage: python3 -I tools/check_pr_size.py <base> <head>
Counts added plus deleted lines from `git diff --numstat base...head`, excluding tests, fixtures, lockfiles,
generated files, docs, evidence, CI configuration and the eval harness under evals/ (measurement tooling, not product
code; its gate is the eval report), and every path a frozen-test manifest (`.claude/frozen/*.json`
at <head>) lists: those are the test designer's files, not the implementer's production code. Exit 1 over the block limit; a warning is printed (and
written to GITHUB_STEP_SUMMARY when present) over the warn limit.
"""
import json, os, pathlib, re, subprocess, sys

WARN, BLOCK = 400, 800
EXCLUDE = re.compile(
    r"(^|/)(tests?|__tests__|fixtures|evidence|docs|reports)/"
    r"|\.(test|spec)\.[cm]?[jt]sx?$|\.feature$"
    r"|(^|/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|.*\.snap|.*\.min\.[jc]ss?|.*\.generated\..*)$"
    r"|\.(md|svg|png|jpg|jpeg|gif|webp|opus|wav|mp3|json|jsonl|csv|txt)$"
    r"|^\.github/|^\.claude/|^evals/|^lefthook\.yml$|^commitlint\.config\.mjs$"
)


def frozen_paths(head, manifests, show):
    """Paths listed by the frozen-test manifests at head; show(spec) returns `git show spec`."""
    paths = set()
    for name in manifests:
        paths.update(json.loads(show(f"{head}:.claude/frozen/{name}")).get("paths", []))
    return paths


def production_lines(numstat: str, frozen=frozenset()):
    total, rows = 0, []
    for line in numstat.splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or parts[0] == "-":
            continue
        added, deleted, path = int(parts[0]), int(parts[1]), parts[2]
        if EXCLUDE.search(path) or path in frozen:
            continue
        total += added + deleted
        rows.append((path, added + deleted))
    return total, sorted(rows, key=lambda r: -r[1])


def main(argv):
    base, head = (argv + ["origin/main", "HEAD"])[:2]
    numstat = subprocess.run(["git", "diff", "--numstat", f"{base}...{head}"], capture_output=True, text=True, check=True).stdout
    git = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True, check=True).stdout
    names = [n for n in git("ls-tree", "--name-only", f"{head}:.claude/frozen").split() if n.endswith(".json")] \
        if subprocess.run(["git", "cat-file", "-e", f"{head}:.claude/frozen"], capture_output=True).returncode == 0 else []
    total, rows = production_lines(numstat, frozen_paths(head, names, lambda spec: git("show", spec)))
    top = "\n".join(f"  {n:5d}  {p}" for p, n in rows[:10])
    msg = f"production lines changed: {total} (warn {WARN}, block {BLOCK})\n{top}"
    print(msg)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if total > BLOCK:
        print(f"PR too large: {total} > {BLOCK}. Split it: one task per PR.", file=sys.stderr)
        if summary:
            pathlib.Path(summary).write_text(f"### PR size\n\n**Blocked:** {total} production lines (limit {BLOCK}).\n", encoding="utf-8")
        return 1
    if total > WARN:
        print(f"::warning::PR has {total} production lines (over {WARN}); consider splitting.")
        if summary:
            pathlib.Path(summary).write_text(f"### PR size\n\n**Warning:** {total} production lines (over {WARN}).\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
