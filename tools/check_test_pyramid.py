#!/usr/bin/env python3
"""Advisory: does a ticket's test design follow the pyramid (owner, 2026-10-25)?

Target per ticket and overall: 80 % stage 1 (unit), 15 % stages 2a-3 (integration, API), at most 5 % stage 4
(end-to-end); acceptance cases are not counted. Warns only when a ticket has at least 20 tests and the share is
grossly off: stage 1 below 60 % or stage 4 above 10 %. Always exits 0.

The frozen manifest (.claude/frozen/<issue>.json) lists paths, not stages, so the stage comes from the path
(assumption, .claude/frozen/README.md): `*.test.ts(x)` is stage 1 and counts its `it`/`test` calls; a `.feature`
file counts its `Scenario`, `Scenario Outline` and `Example` lines and is stage 2a under services/*/features/, 2b
under apps/*/tests/, 3 under tests/api/, 4 under tests/e2e/; anything under tests/acceptance/ and any other
path is ignored. A Scenario Outline counts once, whatever its Examples rows.

Usage: python3 -I tools/check_test_pyramid.py [MANIFEST ...] [--all] [--root DIR]
No manifest: every .claude/frozen/*.json. --all: the whole repository in one line (for the retro).
Writes the table to $GITHUB_STEP_SUMMARY when set. Stdlib only.
"""
import json, os, pathlib, re, sys

MIN_TESTS, MIN_UNIT, MAX_E2E = 20, 0.60, 0.10
UNIT_CASE = re.compile(r"^\s*(?:it|test)(?:\.\w+)*\s*(?:\(|`)", re.M)
SCENARIO = re.compile(r"^\s*(?:Scenario(?: Outline| Template)?|Example):", re.M)
SKIP_DIRS = {"node_modules", ".git", "dist", "coverage", ".stryker-tmp"}


def stage_of(path: str):
    p = path.replace("\\", "/")
    if p.startswith("tests/acceptance/"):
        return None
    if re.search(r"\.test\.tsx?$", p):
        return "1"
    if p.endswith(".feature"):
        if re.match(r"services/[^/]+/features/", p):
            return "2a"
        if re.match(r"apps/[^/]+/tests/", p):
            return "2b"
        if p.startswith("tests/api/"):
            return "3"
        if p.startswith("tests/e2e/"):
            return "4"
    return None


def count(root: pathlib.Path, paths) -> dict:
    counts = {"1": 0, "2a": 0, "2b": 0, "3": 0, "4": 0}
    for path in paths:
        stage = stage_of(path)
        f = root / path
        if stage is None or not f.is_file():
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        counts[stage] += len((UNIT_CASE if stage == "1" else SCENARIO).findall(text))
    return counts


def assess(name: str, counts: dict):
    """Returns (summary line, warning or None)."""
    total = sum(counts.values())
    if total == 0:
        return f"{name}: no counted tests", None
    unit, mid, e2e = counts["1"] / total, (counts["2a"] + counts["2b"] + counts["3"]) / total, counts["4"] / total
    line = f"{name}: {total} tests, stage 1 {unit:.0%}, stages 2a-3 {mid:.0%}, stage 4 {e2e:.0%} (target 80/15/5)"
    if total < MIN_TESTS:
        return line, None
    off = [s for s, bad in ((f"stage 1 below {MIN_UNIT:.0%}", unit < MIN_UNIT), (f"stage 4 above {MAX_E2E:.0%}", e2e > MAX_E2E)) if bad]
    return line, (f"warning: {name}: " + " and ".join(off) + "; explain it in the manifest (pyramidNote)") if off else None


def repo_paths(root: pathlib.Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            yield str((pathlib.Path(dirpath) / fn).relative_to(root))


def main(argv) -> int:
    root = pathlib.Path(argv[argv.index("--root") + 1]) if "--root" in argv else pathlib.Path(__file__).resolve().parents[1]
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--root")]
    results = []
    if "--all" in argv:
        results.append(assess("repository", count(root, repo_paths(root))))
    else:
        manifests = [pathlib.Path(a) for a in args] or sorted((root / ".claude" / "frozen").glob("*.json"))
        for m in manifests:
            m = m if m.is_absolute() else root / m
            try:
                data = json.loads(m.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                results.append((f"{m.name}: unreadable ({e.__class__.__name__}), skipped", None))
                continue
            name = f"issue {data.get('issue', m.stem)}"
            line, warn = assess(name, count(root, data.get("paths", [])))
            if warn and data.get("pyramidNote"):
                warn = f"{warn}; manifest says: {data['pyramidNote']}"
            results.append((line, warn))
    if not results:
        results.append(("no frozen manifest; nothing to count", None))
    lines = [x for r in results for x in r if x]
    print("\n".join(lines))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("### Test pyramid (advisory)\n\n" + "\n".join(f"- {x}" for x in lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
