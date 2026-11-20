#!/usr/bin/env python3
"""Red before green (docs/process/test-strategy.md, rules in .claude/frozen/README.md): every frozen test file this
branch brings must FAIL on the PR base, for the right reason (tools/classify_red_reason.py).

Scope is computed against the merge base of <base-ref> and HEAD (a branch behind main is not blamed for what main
did since); the tests run on the tip of <base-ref>.
Every manifest `.claude/frozen/<issue>.json` at HEAD or at the merge base counts; `paths` and `tasks` are the union of
both versions, so a branch cannot shrink its own scope. Each listed path must be a safe relative ASCII path (no `..`,
no empty segment, no segment starting with `-` or a space or ending with a space; TypeScript and other files
`[A-Za-z0-9_.@+ ()[]{}$-]` for router patterns, Python files the same without `()[]{}$`, they go into `-p`) and no
symlink; anything else fails closed.
  - in scope: every listed file of a manifest this branch changes, and the listed files this branch's diff touches
    in any other manifest. A file is unchanged only when its blob at the merge base equals its blob at HEAD;
  - a listed file missing at HEAD that exists at the merge base fails as deleted. One absent from both is skipped and
    named when it belongs to another task, and fails when it belongs to a task this branch works on (also under an
    unchanged manifest), to no task, or to a manifest without `tasks`;
  - the base is checked out into a temporary directory (a throwaway index, no write to the git metadata), the HEAD
    blobs of the files in scope are copied onto it, then each test runs there on its own:
      *.test.ts(x)            `pnpm exec vitest run --root <workspace> <file>`, workspace apps/<x>, packages/<x>,
                              services/<x>, tests/<x>, else the repository root (scripts/); a base without
                              pnpm-lock.yaml (bootstrap) takes the manifest's `redRun` entry (non-zero exitCode and
                              a reason) instead; a non-zero exit without a failed test in the summary is unproven;
      tools/tests/test*.py    `python3 -I -m unittest discover -s tools/tests -p <file>`;
      evals/tests/test*.py    the same from evals/ with `-s tests` (as ci.yml runs the harness tests);
      *.feature               reported only, proven by the stage 2a/3 run of the PR;
      other test-like files   (`*.spec.*`, `*.test.mts`, `test_*.py` elsewhere, ...) fail: unproven, no runner;
  - green on the base ("unproven") or red for the wrong reason fails and names the file.

Usage: python3 -I tools/check_red_before_green.py <base-ref>   (tools/check_red_before_green.sh calls it)
Exit 0 when everything in scope is proven, 1 otherwise. Stdlib only; needs git, and pnpm for TypeScript tests.
"""
import json, os, pathlib, re, shutil, subprocess, sys, tempfile

CLASSIFIER = pathlib.Path(__file__).resolve().with_name("classify_red_reason.py")
MANIFEST = re.compile(r"^\.claude/frozen/[^/]+\.json$")
UNIT = re.compile(r"\.test\.tsx?$")
PYTHON = {re.compile(r"^tools/tests/test[^/]*\.py$"): (".", "tools/tests"),
          re.compile(r"^evals/tests/test[^/]*\.py$"): ("evals", "tests")}
FEATURE = re.compile(r"\.feature$")
TEST_LIKE = re.compile(r"(?:^|/)test_[^/]*\.py$|_test\.py$|\.(?:test|spec)\.[cm]?[jt]sx?$|^tools/tests/.+/[^/]+\.py$")
WORKSPACE = re.compile(r"^((?:apps|packages|services|tests)/[^/]+)/")
SEGMENT = re.compile(r"[A-Za-z0-9_.@+ ()\[\]{}$-]+")  # ASCII only: no NFC/NFD look-alikes; router patterns pass
SEGMENT_PY = re.compile(r"[A-Za-z0-9_.@+ -]+")  # Python paths go into `unittest -p`: no glob characters
SUMMARY = re.compile(r"^\s*(?:Test Files|Tests)\s+(.*)$", re.M)
REGULAR = ("100644", "100755")
TIMEOUT = 600


def git(*args, cwd, env=None, text=True):
    done = subprocess.run(["git", "-c", "core.quotePath=false", *args], cwd=cwd, env=env, check=True,
                          capture_output=True, text=text)
    return done.stdout


def tree(root, ref):
    """path -> (mode, sha) of every entry of ref, read NUL-separated so no path is quoted or split."""
    entries = {}
    for item in git("ls-tree", "-r", "-z", "--full-tree", ref, cwd=root).split("\0"):
        if item:
            meta, path = item.split("\t", 1)
            mode, _, sha = meta.split(" ")
            entries[path] = (mode, sha)
    return entries


def diff(root, base):
    """Paths this branch touches since the merge base, deletions included."""
    out = git("diff", "-z", "--name-only", "--no-renames", f"{base}...HEAD", cwd=root)
    return {p for p in out.split("\0") if p}


def runner(path):
    if FEATURE.search(path):
        return "feature"
    if UNIT.search(path):
        return "vitest"
    if any(r.match(path) for r in PYTHON):
        return "python"
    if TEST_LIKE.search(path):
        return "none"
    return None  # a helper or other frozen file: copied, not run


def unsafe(path, trees, root):
    """Why a listed path is refused, or None. trees: name -> tree of every commit the check reads or writes."""
    if not isinstance(path, str) or not path:
        return "not a non-empty string"
    if path.startswith("/") or os.path.isabs(path):
        return "absolute path"
    segments = path.split("/")
    if any(s == "" for s in segments):
        return "empty segment"
    if any(s in (".", "..") for s in segments):
        return "'.' or '..' segment"
    if any(s.startswith(("-", " ")) or s.endswith(" ") for s in segments):
        return "segment starts with '-' or a space, or ends with a space"
    allowed, chars = (SEGMENT_PY, "A-Z a-z 0-9 _ . @ + - space") if path.endswith(".py") else \
        (SEGMENT, "A-Z a-z 0-9 _ . @ + - space ( ) [ ] { } $")
    if not all(allowed.fullmatch(s) for s in segments):
        return f"characters outside the ASCII set [{chars}]"
    prefixes = ["/".join(segments[:i]) for i in range(1, len(segments))]
    for name, entries in trees.items():
        if path in entries and entries[path][0] not in REGULAR:
            return f"not a regular file at {name} (mode {entries[path][0]}, symlink or submodule)"
        if any(p in entries for p in prefixes):
            return f"a parent is a tracked file or symlink at {name}"
    for p in prefixes + [path]:
        if os.path.islink(root / p):
            return "symlink in the checkout"
    return None


def load(root, entry, label):
    if entry is None:
        return {}
    data = json.loads(git("cat-file", "blob", entry[1], cwd=root))
    if not isinstance(data, dict):
        raise ValueError(f"{label} is not a JSON object")
    return data


def union(head, base):
    paths, tasks = [], {}
    for data in (head, base):
        paths += [p for p in data.get("paths", []) if p not in paths] if isinstance(data.get("paths"), list) else []
        if isinstance(data.get("tasks"), dict):
            for name, files in data["tasks"].items():
                tasks.setdefault(str(name), [])
                for p in files if isinstance(files, list) else []:
                    if p not in tasks[str(name)]:
                        tasks[str(name)].append(p)
    has_tasks = isinstance(head.get("tasks"), dict) or isinstance(base.get("tasks"), dict)
    return paths, (tasks if has_tasks else None)


def scope(issue, paths, tasks, changed_manifest, touched, trees, root):
    """(checked, failures, notes) of one manifest; trees has HEAD, the merge base and the base tip."""
    head_tree, mb_tree = trees["HEAD"], trees["merge base"]
    failures, notes, listed = [], [], []
    task_of = {}
    for name, files in (tasks or {}).items():
        for p in files:
            task_of.setdefault(p, set()).add(name)
    for p in list(dict.fromkeys(paths + list(task_of))):
        why = unsafe(p, trees, root)
        if why:
            failures.append(f"issue {issue}: unsafe path {p!r} in the manifest ({why}) -> refused")
        else:
            listed.append(p)
    if not (changed_manifest or any(p in touched for p in listed)):
        return [], failures, notes
    considered = [p for p in listed if changed_manifest or p in touched]
    status = {p: state(head_tree.get(p), mb_tree.get(p)) for p in considered}
    active = set().union(*(task_of.get(p, set()) for p, s in status.items() if s in ("checked", "deleted")))
    # Every file of a task this branch works on must be there, also under an unchanged manifest.
    for p in listed:
        if p not in status and task_of.get(p, set()) & active:
            status[p] = state(head_tree.get(p), mb_tree.get(p))
    by = {s: [p for p in listed if status.get(p) == s] for s in ("checked", "deleted", "absent", "unchanged")}
    for p in by["deleted"]:
        failures.append(f"issue {issue}: frozen file {p} deleted on this branch (at the merge base, not at HEAD)")
    skipped = []
    for p in by["absent"]:
        owners = task_of.get(p, set())
        if tasks is not None and owners and not owners & active:
            skipped.append(f"{p} (task {', '.join(sorted(owners))})")
        else:
            why = ("manifest without tasks" if tasks is None else "of no task" if not owners
                   else f"of task {', '.join(sorted(owners & active))}, which this branch works on")
            failures.append(f"issue {issue}: manifest lists missing file {p} ({why})")
    checked, unchanged = by["checked"], [p for p in by["unchanged"] if runner(p)]
    notes.append(f"issue {issue}: tasks of this branch: {', '.join(sorted(active)) or 'none'}; "
                 f"{len(checked)} frozen file(s) changed" + ("" if changed_manifest else " (manifest unchanged)"))
    if skipped:
        notes.append(f"issue {issue}: skipped, not in the tree (other tasks): {', '.join(skipped)}")
    if unchanged:
        notes.append(f"issue {issue}: unchanged against the merge base, not re-run: {', '.join(unchanged)}")
    return checked, failures, notes


def state(head, mb):
    if head is None:
        return "deleted" if mb is not None else "absent"
    return "unchanged" if mb is not None and mb[1] == head[1] else "checked"


def checkout_base(root, base, dest):
    """Base tree into dest through a throwaway index: works with a read-only git dir (toolbox) and leaves no worktree."""
    env = {**os.environ, "GIT_INDEX_FILE": str(dest.parent / "index")}
    git("read-tree", base, cwd=root, env=env)
    git(f"--work-tree={dest}", "checkout-index", "-a", "-f", cwd=root, env=env)


def place(root, wt, path, entry):
    """Write the HEAD blob of path onto the base checkout; refuses to follow a symlink there."""
    target = wt / path
    for parent in [wt / "/".join(path.split("/")[:i]) for i in range(1, path.count("/") + 1)] + [target]:
        if os.path.islink(parent):
            return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(git("cat-file", "blob", entry[1], cwd=root, text=False))
    target.chmod(0o755 if entry[0] == "100755" else 0o644)
    return True


def run(cmd, cwd, log, env=None):
    try:
        done = subprocess.run(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                              timeout=TIMEOUT)
        out, code = done.stdout, done.returncode
    except FileNotFoundError as exc:
        out, code = f"{exc}\n", 127
    except subprocess.TimeoutExpired as exc:
        out, code = f"{exc.output or ''}\ntimeout after {TIMEOUT}s\n", 124
    log.write_text(out, encoding="utf-8")
    return code, out


def tail(text, n=20):
    return "\n".join("    " + line for line in text.rstrip().splitlines()[-n:])


def classify(log, test, wt, root, cwd):
    done = subprocess.run([sys.executable, "-I", str(CLASSIFIER), str(log), "--root", str(wt), "--head", str(root),
                           "--cwd", str(cwd), "--test", test], capture_output=True, text=True)
    return done.returncode == 0, " / ".join(done.stdout.split("\n")).strip(" /") or done.stderr.strip()


def install(wt, tmp):
    log = tmp / "install.log"
    out = ""
    for cmd in (["pnpm", "install", "--frozen-lockfile", "--offline"], ["pnpm", "install", "--frozen-lockfile"]):
        code, out = run(cmd, wt, log)
        if code == 0:
            return True
    print(f"pnpm install on the base failed:\n{tail(out)}")
    return False


def main(argv):
    base = argv[0] if argv else "origin/main"
    root = pathlib.Path(git("rev-parse", "--show-toplevel", cwd=os.getcwd()).strip())
    os.chdir(root)
    merge_base = git("merge-base", base, "HEAD", cwd=root).strip()
    trees = {"HEAD": tree(root, "HEAD"), "merge base": tree(root, merge_base), "base": tree(root, base)}
    head_tree, mb_tree = trees["HEAD"], trees["merge base"]
    touched = diff(root, base)  # base...HEAD: the diff to the merge base
    names = sorted(p for p in set(head_tree) | set(mb_tree) if MANIFEST.match(p))
    fail, work = 0, []
    for name in names:
        issue = pathlib.Path(name).stem
        head_entry, base_entry = head_tree.get(name), mb_tree.get(name)
        if any(e is not None and e[0] not in REGULAR for e in (head_entry, base_entry)):
            print(f"issue {issue}: manifest {name} is not a regular file -> refused")
            fail = 1
            continue
        try:
            head, old = load(root, head_entry, f"{name} at HEAD"), load(root, base_entry, f"{name} at the merge base")
        except ValueError as exc:
            print(f"issue {issue}: manifest {name} unreadable ({exc}) -> refused")
            fail = 1
            continue
        changed_manifest = (head_entry or (None, None))[1] != (base_entry or (None, None))[1]
        paths, tasks = union(head, old)
        checked, failures, notes = scope(issue, paths, tasks, changed_manifest, touched, trees, root)
        for line in notes + failures:
            print(line)
        fail |= bool(failures)
        if checked or failures or changed_manifest:
            red_run = head.get("redRun") if isinstance(head.get("redRun"), dict) else {}
            work.append((issue, checked, red_run))
    if not work:
        print("no frozen file in scope (no manifest changed, no listed file touched); nothing to prove")
        return fail
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="lfc-rbg-")).resolve()
    try:
        wt = tmp / "base"
        wt.mkdir()
        checkout_base(root, base, wt)
        return check(work, base, root, wt, tmp, head_tree) | fail
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check(work, base, root, wt, tmp, head_tree):
    ctx = {"base": base, "root": root, "wt": wt, "tmp": tmp, "bootstrap": not (wt / "pnpm-lock.yaml").is_file(),
           "installed": None}
    fail = 0
    for issue, files, red_run in work:
        for p in files:
            if not place(root, wt, p, head_tree[p]):
                print(f"issue {issue}: {p}: a symlink on the base checkout is in the way -> refused")
                fail = 1
        for n, p in enumerate(files):
            fail |= not prove(issue, p, tmp / f"rbg-{issue}-{n}.log", red_run, ctx)
        features = [f for f in files if runner(f) == "feature"]
        if features:
            print(f"issue {issue}: {len(features)} feature file(s) frozen ({', '.join(features)}); proven by the "
                  "stage 2a/3 run of this PR (red on base not re-run here)")
    return fail


def redrun_accepted(issue, p, red_run, base):
    """Bootstrap base: the manifest's redRun entry stands in for the TypeScript run."""
    entry = red_run.get(p)
    code, reason = (entry.get("exitCode"), entry.get("reason")) if isinstance(entry, dict) else (None, None)
    if isinstance(code, int) and not isinstance(code, bool) and code != 0 and isinstance(reason, str) and reason.strip():
        print(f"issue {issue}: {p}: base {base} has no pnpm-lock.yaml (bootstrap), TypeScript tests cannot run there; "
              f"accepted the manifest redRun (exitCode {code}): {reason.strip()}")
        return True
    print(f"issue {issue}: {p}: base {base} has no pnpm-lock.yaml (bootstrap) and the manifest has no redRun entry "
          "with a non-zero exitCode and a reason -> unproven")
    return False


def command(issue, p, kind, ctx):
    """(cmd, cwd) that runs p on the base, or None when it cannot run (reported)."""
    if kind == "python":
        cwd, start = next(v for r, v in PYTHON.items() if r.match(p))
        return [sys.executable, "-I", "-m", "unittest", "discover", "-s", start, "-p",
                pathlib.PurePosixPath(p).name], ctx["wt"] / cwd
    if ctx["installed"] is None:
        ctx["installed"] = install(ctx["wt"], ctx["tmp"])
    if not ctx["installed"]:
        print(f"issue {issue}: {p}: pnpm install failed on {ctx['base']}, cannot run it -> unproven")
        return None
    ws = WORKSPACE.match(p)
    return ["pnpm", "exec", "vitest", "run", "--root", ws.group(1) if ws else ".", p], ctx["wt"]


def prove(issue, p, log, red_run, ctx):
    """True when p is proven red on the base (or needs no proof here)."""
    base, kind = ctx["base"], runner(p)
    if kind in (None, "feature"):
        return True
    if kind == "none":
        print(f"issue {issue}: {p} looks like a test but no runner of this check runs it -> unproven, no runner")
        return False
    if kind == "vitest" and ctx["bootstrap"]:
        return redrun_accepted(issue, p, red_run, base)
    planned = command(issue, p, kind, ctx)
    if planned is None:
        return False
    cmd, cwd = planned
    # Plain output for the classifier: no ANSI colours (it strips them too).
    env = {**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"} if kind == "vitest" else None
    code, out = run(cmd, cwd, log, env)
    if code == 0:
        print(f"issue {issue}: {p} is GREEN on {base} -> unproven ({' '.join(cmd)})\n{tail(out)}")
        return False
    summary = SUMMARY.findall(out) if kind == "vitest" else []
    if summary and not any("failed" in s for s in summary):
        print(f"issue {issue}: {p}: vitest exited {code} on {base} but its summary shows no failed test -> unproven"
              f"\n{tail(out)}")
        return False
    ok, reason = classify(log, p, ctx["wt"], ctx["root"], cwd)
    if ok:
        print(f"issue {issue}: {p} is red on {base} (ok): {reason}")
    else:
        print(f"issue {issue}: {p} is red on {base}, but for the wrong reason: {reason}\n{tail(out)}")
    return ok

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
