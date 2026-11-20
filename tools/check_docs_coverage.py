#!/usr/bin/env python3
"""Every workspace directory has prose an agent can work from, and a rule that covers it.

Checks each first-level directory under apps/, services/, packages/ and tests/ (owner decision
2026-10-19, process map "Testteam" follow-up):
  1. it has a README.md with the four sections `## Purpose`, `## Boundaries`, `## Pitfalls`, `## Commands`;
  2. some `.claude/rules/*.md` covers it through a `paths:` glob or names it in its `## File map`.

Usage: python3 -I tools/check_docs_coverage.py [--root DIR]
Exit 1 with one line per gap. Stdlib only; runs in stage 0 and in the pre-commit hook.
"""
import fnmatch, pathlib, re, sys

WORKSPACES = ("apps", "services", "packages", "tests")
SECTIONS = ("## Purpose", "## Boundaries", "## Pitfalls", "## Commands")
SKIP = {"fixtures", "node_modules", "reports"}


def rule_globs_and_maps(root: pathlib.Path):
    globs, maps = [], []
    for rule in sorted((root / ".claude" / "rules").glob("*.md")):
        text = rule.read_text(encoding="utf-8")
        fm = re.match(r"---\n(.*?)\n---", text, re.S)
        if fm:
            globs += re.findall(r'^\s*-\s*"([^"]+)"', fm.group(1), re.M)
        m = re.search(r"^## File map\n(.*?)(?=^## |\Z)", text, re.M | re.S)
        if m:
            maps.append(m.group(1))
    return globs, maps


def covered(rel: str, globs, maps) -> bool:
    probe = rel + "/x"
    for g in globs:
        if fnmatch.fnmatch(probe, g) or fnmatch.fnmatch(rel, g.rstrip("/*")):
            return True
    return any(f"`{rel}/" in m or f"`{rel}`" in m for m in maps)


def check(root: pathlib.Path):
    gaps = []
    globs, maps = rule_globs_and_maps(root)
    for ws in WORKSPACES:
        base = root / ws
        if not base.is_dir():
            continue
        for d in sorted(p for p in base.iterdir() if p.is_dir() and p.name not in SKIP and not p.name.startswith(".")):
            rel = f"{ws}/{d.name}"
            readme = d / "README.md"
            if not readme.is_file():
                gaps.append(f"{rel}: README.md missing (sections {', '.join(SECTIONS)})")
            else:
                text = readme.read_text(encoding="utf-8")
                missing = [s for s in SECTIONS if not re.search(rf"^{re.escape(s)}\s*$", text, re.M)]
                if missing:
                    gaps.append(f"{rel}/README.md: missing {', '.join(missing)}")
            if not covered(rel, globs, maps):
                gaps.append(f"{rel}: no .claude/rules/*.md covers it (paths: glob or ## File map entry)")
    return gaps


def main(argv):
    root = pathlib.Path(argv[argv.index("--root") + 1]) if "--root" in argv else pathlib.Path(__file__).resolve().parents[1]
    gaps = check(root)
    for g in gaps:
        print(g)
    if gaps:
        print(f"{len(gaps)} documentation gap(s)", file=sys.stderr)
        return 1
    print("docs coverage ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
