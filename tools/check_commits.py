#!/usr/bin/env python3
"""Conventional Commits with known scopes (docs/process/pr-format.md), stdlib only.

Reads `types`, `scopes` and `properNouns` from commitlint.config.mjs so hook, CI and commitlint agree.
  python3 -I tools/check_commits.py "origin/main..HEAD"   # every commit in the range
  python3 -I tools/check_commits.py --file .git/COMMIT_EDITMSG   # commit-msg hook
  python3 -I tools/check_commits.py --title "feat(gateway): accept uploads"   # PR title (squash title)
`wip:` is allowed on task branches only (never in --title); merge commits are skipped.
The subject starts in lower case unless its first word is an acronym (`CI`) or a proper noun from the list
(`Sonar project key ...`). Two commits on main (867b1f9, c60867a) predate this allowance and the ruleset and
fail the old rule; history is not rewritten, and CI checks only `origin/main..HEAD`.
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
HEADER = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[a-z0-9-]+)\))?(?P<bang>!)?: (?P<subject>\S.*)$")


def config(root=ROOT):
    text = (root / "commitlint.config.mjs").read_text(encoding="utf-8")
    def arr(name):
        m = re.search(rf"export const {name}\s*=\s*\[(.*?)\];", text, re.S)
        return re.findall(r"'([^']+)'", m.group(1)) if m else []
    return arr("types"), arr("scopes"), arr("properNouns")


def check_header(header: str, *, allow_wip: bool, types, scopes, proper_nouns=()) -> str | None:
    if header.startswith("Merge ") or header.startswith("Revert \""):
        return None
    if header.startswith("wip:"):
        return None if allow_wip else "wip: commits are allowed on task branches only"
    m = HEADER.match(header)
    if not m:
        return "not `<type>(<scope>): <subject>`"
    if m["type"] not in types:
        return f"unknown type `{m['type']}` (allowed: {', '.join(types)})"
    if not m["scope"]:
        return "scope missing (workspace or repo area, see commitlint.config.mjs)"
    if m["scope"] not in scopes:
        return f"unknown scope `{m['scope']}` (allowed: {', '.join(scopes)})"
    if len(header) > 100:
        return "header longer than 100 characters"
    first = m["subject"].split()[0]
    if first.isalpha() and first.istitle() and len(first) > 1 and first not in proper_nouns:
        return "subject starts with a capital letter (lower case unless an acronym or a proper noun from commitlint.config.mjs)"
    return None


def main(argv):
    types, scopes, nouns = config()
    problems = []
    if "--title" in argv:
        header = argv[argv.index("--title") + 1].strip()
        p = check_header(header, allow_wip=False, types=types, scopes=scopes, proper_nouns=nouns)
        if p:
            problems.append(f"PR title `{header}`: {p}")
    elif "--file" in argv:
        header = pathlib.Path(argv[argv.index("--file") + 1]).read_text(encoding="utf-8").splitlines()[0].strip()
        p = check_header(header, allow_wip=True, types=types, scopes=scopes, proper_nouns=nouns)
        if p:
            problems.append(f"`{header}`: {p}")
    else:
        rng = argv[0] if argv else "origin/main..HEAD"
        out = subprocess.run(["git", "log", "--format=%h%x00%s", rng], capture_output=True, text=True, check=True).stdout
        for line in out.splitlines():
            sha, _, header = line.partition("\0")
            p = check_header(header, allow_wip=True, types=types, scopes=scopes, proper_nouns=nouns)
            if p:
                problems.append(f"{sha} `{header}`: {p}")
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} commit message problem(s)", file=sys.stderr)
        return 1
    print("commit messages ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
