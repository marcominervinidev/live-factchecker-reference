#!/usr/bin/env python3
"""Decide whether a red Vitest run on the PR base is red for the right reason (red before green).

Right reason: the module or the behaviour under test does not exist yet on the base, i.e. failing
assertions, or a relative import (`./turns`, `/abs/path/turns`) or workspace alias (`@lfc/pipeline`) of a
module that is not in the tree. Wrong reason: a package from node_modules does not resolve (vitest,
fast-check, @cucumber/cucumber: the test infrastructure is broken), a SyntaxError, a TypeError or
ReferenceError while loading a test file, a module that exists but does not resolve, or a log without a
test run (empty, "No test files found").

A unittest log (`Ran <n> tests`, Python tests under tools/tests and evals/tests) follows the same idea: right is a
failing test, a `No module named X` where X is in the HEAD commit but not on the base (the module under test), or a
missing file of the HEAD commit (`FileNotFoundError`, the tool under test). Wrong is a SyntaxError while loading, a
module or file that is on the base anyway or in neither tree (a third-party package, test infrastructure), a missing
file or module inside the test's own `tests/` directory (a test helper or fixture that is not frozen), any other load
error before a test ran (`unittest.loader._FailedTest`), and a log without a failing test.
A SyntaxError counts only as a load error (vitest: inside the FAIL block of a file that failed to load, or with a
"Failed to load"/transform error; unittest: a traceback line before any test ran), not in an assertion text.
ANSI colour codes are stripped before matching.

Usage: python3 -I tools/classify_red_reason.py <log> --test <file> [--test <file> ...] [--root DIR] [--head DIR]
       [--cwd DIR]
--root is the base checkout the tests ran in, --head a git checkout whose HEAD commit is the branch (its blobs count,
not its files; needed for unittest logs), --cwd the directory the tests ran in (relative paths resolve there).
Exit 0 with one `red for the right reason: ...` line; exit 1 with one line per wrong reason. Stdlib only.
Called by tools/check_red_before_green.sh; rules in .claude/rules/tests.md and .claude/agents/test-designer.md.
"""
import pathlib, re, subprocess, sys

ALIAS = "@lfc/"
EXTENSIONS = ("", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js")
WORKSPACE_DIRS = ("packages", "services", "apps")
MISSING = (
    re.compile(r"Cannot find module '(?P<spec>[^']+)'(?: imported from (?P<importer>\S+))?"),
    re.compile(r'Failed to resolve import "(?P<spec>[^"]+)" from "(?P<importer>[^"]+)"'),
    re.compile(r"Cannot find package '(?P<spec>[^']+)'(?: imported from (?P<importer>\S+))?"),
)
LOAD_ERROR = re.compile(r"\b(SyntaxError|TypeError|ReferenceError)\b")
FILE_FAIL = re.compile(r"^\s*(?:FAIL|❯|×)\s+(\S+)\s+\[\s*\1\s*\]")  # vitest: the whole file failed to load
NEXT_BLOCK = re.compile(r"^\s*(?:FAIL|✓|×|❯|Test Files|Tests)\b")
RAN = re.compile(r"^\s*(?:Test Files|Tests)\s+\d+", re.M)
RIGHT, WRONG = "red for the right reason", "red for the wrong reason"
UNITTEST_RAN = re.compile(r"^Ran (\d+) tests? in [\d.]+s$", re.M)
UNITTEST_FAILED = re.compile(r"^FAILED \(", re.M)
UNITTEST_LOAD = re.compile(r"unittest\.loader\._FailedTest|^ImportError: Failed to import test module", re.M)
PY_NO_MODULE = re.compile(r"\b(?:ModuleNotFoundError|ImportError): No module named '([^']+)'")
PY_NO_FILE = re.compile(r"\bFileNotFoundError: \[Errno 2\] No such file or directory: '([^']+)'")
PY_SYNTAX = re.compile(r"^\s*(?:SyntaxError|IndentationError|TabError):", re.M)
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
VITE_LOAD = re.compile(r"Failed to load|Transform failed|Failed to parse source")


def exists(path: pathlib.Path) -> bool:
    return any(pathlib.Path(str(path) + ext).exists() for ext in EXTENSIONS)


def classify_specifier(spec: str, importer: str | None, tests: list[str], root: pathlib.Path):
    """(is_right_reason, message) for one unresolved import specifier."""
    if spec.startswith("/"):
        if exists(pathlib.Path(spec)):
            return False, f"{WRONG}: module {spec} exists but does not resolve"
        return True, f"{RIGHT}: missing module {spec}"
    if spec.startswith("."):
        bases = [pathlib.Path(importer).parent] if importer else [pathlib.Path(t).parent for t in tests]
        for base in bases:
            if exists((root / base) / spec):
                return False, f"{WRONG}: module {spec} exists next to {base} but does not resolve"
        return True, f"{RIGHT}: missing module {spec}"
    if spec.startswith(ALIAS):
        name, _, sub = spec[len(ALIAS):].partition("/")
        # A workspace exists only with its package.json: copying the frozen test file onto the base creates the directory.
        workspaces = [root / d / name for d in WORKSPACE_DIRS if (root / d / name / "package.json").is_file()]
        if not workspaces:
            return True, f"{RIGHT}: missing module {spec}"
        if not sub:
            return False, f"{WRONG}: workspace {name} exists but {spec} does not resolve (not linked or built?)"
        if any(exists(w / "src" / sub) or exists(w / sub) for w in workspaces):
            return False, f"{WRONG}: module {spec} exists but does not resolve"
        return True, f"{RIGHT}: missing module {spec}"
    return False, f"{WRONG}: unresolvable package {spec} (test infrastructure, not the module under test)"


def module_dirs(tests: list[str]):
    """Directories, relative to a checkout, where a test's own imports may live: its directory, every parent, and
    their `src` (evals/tests puts evals/src on sys.path)."""
    dirs = []
    for t in tests:
        for d in pathlib.PurePosixPath(t).parents:
            for c in (d, d / "src"):
                if c not in dirs:
                    dirs.append(c)
    return dirs


def at_head(head: pathlib.Path, rel) -> bool:
    """rel is a blob of the HEAD commit of the git checkout head (not merely a file in its worktree)."""
    done = subprocess.run(["git", "-C", str(head), "cat-file", "-e", f"HEAD:{pathlib.PurePosixPath(rel).as_posix()}"],
                          capture_output=True)
    return done.returncode == 0


def module_paths(name: str, dirs):
    rel = name.replace(".", "/")
    return [p for d in dirs for p in (d / f"{rel}.py", d / rel / "__init__.py")]


def has_module(checkout: pathlib.Path, name: str, dirs) -> bool:
    return any((checkout / p).is_file() for p in module_paths(name, dirs))


def test_dirs(tests: list[str]):
    """The `tests/` directory each test lives in (tools/tests, evals/tests): its helpers must be frozen too."""
    found = []
    for t in tests:
        parts = pathlib.PurePosixPath(t).parts
        if "tests" in parts[:-1]:
            found.append(pathlib.PurePosixPath(*parts[:parts.index("tests") + 1]))
    return found


def inside(rel, dirs) -> bool:
    return any(rel == d or d in pathlib.PurePosixPath(rel).parents for d in dirs)


def classify_unittest(log: str, tests: list[str], root: pathlib.Path, head: pathlib.Path | None,
                      cwd: pathlib.Path | None = None):
    """(ok, reasons) for a log of `python3 -I -m unittest`."""
    right, wrong = [], []
    root = root.resolve()
    cwd = (cwd or root).resolve()
    if UNITTEST_LOAD.search(log) and PY_SYNTAX.search(log):
        return False, [f"{WRONG}: {PY_SYNTAX.search(log).group(0).strip()} while loading the test module"]
    dirs, own = module_dirs(tests), test_dirs(tests)
    for name in dict.fromkeys(PY_NO_MODULE.findall(log)):
        found = [p for p in module_paths(name, dirs) if head is not None and at_head(head, p)]
        if has_module(root, name, dirs):
            wrong.append(f"{WRONG}: module {name} exists on the base but does not import")
        elif found and inside(found[0], own):
            wrong.append(f"{WRONG}: test helper {found[0]} is not frozen (missing on the base)")
        elif found:
            right.append(f"{RIGHT}: missing module {name}")
        else:
            wrong.append(f"{WRONG}: unresolvable module {name} (in neither tree: a package or test infrastructure, "
                         "not the module under test)")
    for path in dict.fromkeys(PY_NO_FILE.findall(log)):
        try:
            rel = (cwd / path).resolve().relative_to(root)
        except ValueError:
            wrong.append(f"{WRONG}: missing file {path} outside the checkout")
            continue
        if (root / rel).exists():
            wrong.append(f"{WRONG}: file {rel.as_posix()} exists on the base")
        elif inside(pathlib.PurePosixPath(rel.as_posix()), own):
            wrong.append(f"{WRONG}: test helper {rel.as_posix()} is not frozen (missing on the base)")
        elif head is not None and at_head(head, rel):
            right.append(f"{RIGHT}: missing file {rel.as_posix()}")
        else:
            wrong.append(f"{WRONG}: missing file {rel.as_posix()} (in neither tree: test infrastructure)")
    if wrong:
        return False, wrong
    if right:
        return True, right
    if UNITTEST_LOAD.search(log):
        return False, [f"{WRONG}: load error before any test ran (unittest.loader._FailedTest)"]
    ran = max((int(n) for n in UNITTEST_RAN.findall(log)), default=0)
    if ran and UNITTEST_FAILED.search(log):
        return True, [f"{RIGHT}: failing tests, no load error (missing behaviour)"]
    return False, [f"{WRONG}: no test run in log (no failing test)"]


def classify(log: str, tests: list[str], root: pathlib.Path, head: pathlib.Path | None = None,
             cwd: pathlib.Path | None = None):
    """(ok, reasons): ok is True when every finding in the log is a right reason."""
    log = ANSI.sub("", log)
    if UNITTEST_RAN.search(log) or UNITTEST_LOAD.search(log):
        return classify_unittest(log, tests, root, head, cwd)
    vite_load = bool(VITE_LOAD.search(log))
    right, wrong, seen = [], [], set()
    loading = None  # test file whose load failed, while inside its FAIL block
    for line in log.splitlines():
        m = FILE_FAIL.match(line)
        if m:
            loading = m.group(1)
        elif NEXT_BLOCK.match(line):
            loading = None
        found = False
        for pattern in MISSING:
            for hit in pattern.finditer(line):
                found = True
                if hit["spec"] in seen:
                    continue
                seen.add(hit["spec"])
                ok, msg = classify_specifier(hit["spec"], hit["importer"], tests, root)
                (right if ok else wrong).append(msg)
        if found:
            continue
        e = LOAD_ERROR.search(line)
        if e and (loading or (e.group(1) == "SyntaxError" and vite_load)):
            where = f" while loading {loading}" if loading else ""
            msg = f"{WRONG}: {line.strip()}{where}"
            if msg not in wrong:
                wrong.append(msg)
    if wrong:
        return False, wrong
    if right:
        return True, right
    if RAN.search(log) or "AssertionError" in log or re.search(r"^\s*(?:FAIL|×)\s", log, re.M):
        return True, [f"{RIGHT}: failing tests, no load error (missing behaviour)"]
    return False, [f"{WRONG}: no test run in log"]


def main(argv):
    if not argv or argv[0].startswith("--"):
        print(__doc__)
        return 2
    log = pathlib.Path(argv[0]).read_text(encoding="utf-8", errors="replace")
    tests = [argv[i + 1] for i, a in enumerate(argv) if a == "--test"]
    root = pathlib.Path(argv[argv.index("--root") + 1]) if "--root" in argv else pathlib.Path.cwd()
    head = pathlib.Path(argv[argv.index("--head") + 1]) if "--head" in argv else None
    cwd = pathlib.Path(argv[argv.index("--cwd") + 1]) if "--cwd" in argv else None
    ok, reasons = classify(log, tests, root, head, cwd)
    for r in reasons:
        print(r)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
