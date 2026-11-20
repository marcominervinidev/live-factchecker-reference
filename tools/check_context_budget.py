#!/usr/bin/env python3
"""The files Claude loads into context stay short (owner decision 2026-10-19).

Budgets in lines: CLAUDE.md 120, .claude/rules/*.md 80, .claude/agents/*.md 120, .claude/skills/*/SKILL.md 100.
Over budget means: shorten, or move detail into a document the file points to.

Usage: python3 -I tools/check_context_budget.py [--root DIR]
Exit 1 with one line per file over budget. Stdlib only; runs in stage 0 and in the pre-commit hook.
"""
import pathlib, sys

BUDGETS = (
    ("CLAUDE.md", 120),
    (".claude/rules/*.md", 80),
    (".claude/agents/*.md", 120),
    (".claude/skills/*/SKILL.md", 100),
)


def check(root: pathlib.Path):
    over = []
    for pattern, limit in BUDGETS:
        for f in sorted(root.glob(pattern)):
            with f.open(encoding="utf-8") as fh:
                n = sum(1 for _ in fh)
            if n > limit:
                over.append(f"{f.relative_to(root)}: {n} lines, budget {limit}")
    return over


def main(argv):
    root = pathlib.Path(argv[argv.index("--root") + 1]) if "--root" in argv else pathlib.Path(__file__).resolve().parents[1]
    over = check(root)
    for o in over:
        print(o)
    if over:
        print(f"{len(over)} file(s) over the context budget", file=sys.stderr)
        return 1
    print("context budget ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
