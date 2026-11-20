"""Issue #42, task 1: tools/check_red_before_green.sh, the CI job `red before green` (`ci.yml` runs
`sh tools/check_red_before_green.sh origin/main`), and the Sonar source list.

AC1 multi-task manifests: only the frozen files this branch adds or changes are checked, absent files of other tasks
are skipped and named, a manifest without `tasks` still fails on a missing listed file. AC2 every unit test runs on the
base with the root of its workspace (`vitest run --root <dir>`). AC3 frozen Python tests run on the base with
`python3 -I -m unittest`. AC4 green on the base or red for the wrong reason blocks and names the file. AC5 a base
without pnpm-lock.yaml (bootstrap) takes the manifest `redRun` entry of each TypeScript test, a missing entry fails.
AC6 sonar-project.properties names only directories that exist.

Each scenario builds a throwaway git repository under the system temp directory; the repository under test is never
written. Vitest is replaced by a fake `pnpm` first on PATH (Node never runs on the host): it records its calls and
answers like vitest, green when the module under test exists on the base, "Cannot find module" when it does not,
"Cannot find package" for a test marked INFRA_BROKEN, and "No test files found" when run from the repository root
for a file outside scripts/ (the root vitest.config.ts includes scripts/** only). Python tests run for real.
Stdlib only. Run: python3 -I -m unittest discover -s tools/tests -p test_check_red_before_green.py
"""
import json, os, pathlib, shutil, stat, subprocess, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "check_red_before_green.sh"
TMP = pathlib.Path(tempfile.gettempdir()).resolve()
GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "scenario", "GIT_AUTHOR_EMAIL": "scenario@example.invalid",
    "GIT_COMMITTER_NAME": "scenario", "GIT_COMMITTER_EMAIL": "scenario@example.invalid",
    "GIT_AUTHOR_DATE": "2026-10-28T12:00:00Z", "GIT_COMMITTER_DATE": "2026-10-28T12:00:00Z",
}

FAKE_PNPM = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ["RBG_FAKE_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"cwd": os.getcwd(), "argv": args,
                          "env": {k: os.environ.get(k) for k in ("NO_COLOR", "FORCE_COLOR")}}) + "\n")
if args[:1] == ["install"]:
    sys.exit(1 if os.environ.get("RBG_FAKE_INSTALL_FAILS") else 0)
if args[:3] != ["exec", "vitest", "run"]:
    sys.exit(64)
rest, root = args[3:], "."
if "--root" in rest:
    i = rest.index("--root")
    root = rest[i + 1]
    del rest[i:i + 2]
cwd = pathlib.Path.cwd()
code = 0
for name in rest:
    test = pathlib.Path(name) if os.path.isabs(name) else cwd / name
    rel = os.path.relpath(test, cwd / root)
    if root == "." and not rel.startswith("scripts/"):
        print("No test files found, exiting with code 1")
        code = 1
        continue
    module = test.with_name(test.name.replace(".test.ts", ".ts"))
    text = test.read_text(encoding="utf-8")
    needs = [line.split()[2] for line in text.splitlines() if line.startswith("// requires ")]
    if any(not (test.parent / n).exists() for n in needs):  # a frozen helper must be on the base: else a load error
        print(f" FAIL  {rel} [ {rel} ]\nSyntaxError: helper of {rel} missing on the base\n\n Test Files  1 failed (1)")
        code = 1
    elif "UNHANDLED_ERROR" in text:  # vitest exits 1 on an unhandled error although every test passed
        print(f" \u2713 {rel} (1 test)\n\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n     Errors  1 error")
        code = 1
    elif module.exists():
        print(f" ✓ {rel} (1 test)\n\n Test Files  1 passed (1)\n      Tests  1 passed (1)")
    elif "INFRA_BROKEN" in text:
        print(f" FAIL  {rel} [ {rel} ]\nError: Cannot find package 'fast-check' imported from {test}\n\n"
              " Test Files  1 failed (1)\n      Tests  no tests")
        code = 1
    else:
        print(f" FAIL  {rel} [ {rel} ]\nError: Cannot find module './{module.name}' imported from {test}\n\n"
              " Test Files  1 failed (1)\n      Tests  no tests")
        code = 1
sys.exit(code)
'''

UNIT = "import {{ expect, it }} from 'vitest';\nimport {{ {name} }} from './{name}.ts';\n\nit('{name}', () => expect({name}()).toBe(1));\n"
PY_TEST = '''import pathlib, subprocess, sys, unittest

TOOL = pathlib.Path(__file__).resolve().parents[1] / "tool.py"


class Tool(unittest.TestCase):
    def test_prints_one(self):
        self.assertTrue(TOOL.is_file(), "tools/tool.py is missing")
        done = subprocess.run([sys.executable, "-I", str(TOOL)], capture_output=True, text=True)
        self.assertEqual(done.stdout, "1\\n")
'''
PY_TOOL = "print(1)\n"
FEATURE = "Feature: ready\n  Scenario: ready\n    Given the service runs\n"

TASK1 = ["scripts/ci/affected.test.ts"]
TASK2 = ["packages/kit/src/log.test.ts", "packages/kit/src/testing/probe.ts", "services/det/src/main.test.ts",
         "services/det/features/ready.feature"]
TASK3 = ["tests/api/features/edge.feature", "tests/api/steps/edge.steps.ts"]


class RedBeforeGreen(unittest.TestCase):
    def setUp(self):
        self.repo = pathlib.Path(tempfile.mkdtemp(prefix="lfc-42-rbg-")).resolve()
        self.addCleanup(shutil.rmtree, self.repo, True)
        # Directory check before any git write (CLAUDE.md, Git): only a fresh directory under the temp dir.
        if TMP not in self.repo.parents or self.repo == ROOT or ROOT in self.repo.parents:
            self.fail(f"refusing to write git state outside a throwaway directory: {self.repo}")
        bin_dir = self.repo / ".fakebin"
        bin_dir.mkdir()
        pnpm = bin_dir / "pnpm"
        pnpm.write_text(FAKE_PNPM, encoding="utf-8")
        pnpm.chmod(pnpm.stat().st_mode | stat.S_IXUSR)
        self.log = self.repo / ".fakebin" / "calls.jsonl"
        self.env = {**os.environ, **GIT_ENV, "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
                    "RBG_FAKE_LOG": str(self.log)}
        self.git("init", "-q", "-b", "main")
        self.write(".gitignore", ".fakebin/\n")
        self.write("README.md", "# scenario\n")
        # The repository's classifier, as on every real base.
        self.write("tools/classify_red_reason.py", (ROOT / "tools" / "classify_red_reason.py").read_text(encoding="utf-8"))

    # helpers -------------------------------------------------------------------------------------------------
    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, env=self.env, check=True, capture_output=True, text=True)

    def write(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)

    def workspace(self):
        """A base that has a lockfile: TypeScript tests run for real on it."""
        self.write("package.json", '{ "name": "scenario", "private": true }\n')
        self.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n")

    def manifest(self, paths, tasks=None, red_run=None, note="frozen"):
        data = {"issue": 7, "note": note, "paths": paths}
        if tasks is not None:
            data["tasks"] = tasks
        if red_run is not None:
            data["redRun"] = red_run
        data["sha256"] = {}
        self.write(".claude/frozen/7.json", json.dumps(data, indent=2) + "\n")

    def unit(self, rel, *, broken=False):
        name = pathlib.Path(rel).name.split(".")[0]
        self.write(rel, UNIT.format(name=name) + ("// INFRA_BROKEN\n" if broken else ""))

    def base(self):
        self.commit("chore(repo): base")
        self.git("tag", "base")

    def check(self):
        """Exit code and output of the script under test, run against the tag `base` inside the scenario repo."""
        self.assertTrue(SCRIPT.is_file(), f"{SCRIPT.relative_to(ROOT)} is missing")
        done = subprocess.run(["sh", str(SCRIPT), "base"], cwd=self.repo, env=self.env, capture_output=True, text=True,
                              timeout=120)
        return done.returncode, done.stdout + done.stderr

    def vitest_calls(self):
        """(--root value, test file relative to the checkout) of every fake vitest run."""
        if not self.log.exists():
            return []
        calls = []
        for line in self.log.read_text(encoding="utf-8").splitlines():
            call = json.loads(line)
            argv = call["argv"]
            if argv[:3] != ["exec", "vitest", "run"]:
                continue
            rest = argv[3:]
            root = rest[rest.index("--root") + 1] if "--root" in rest else None
            files = [a for i, a in enumerate(rest) if a != "--root" and (i == 0 or rest[i - 1] != "--root")]
            for f in files:
                p = pathlib.Path(f) if os.path.isabs(f) else pathlib.Path(call["cwd"]) / f
                calls.append((root, os.path.relpath(p, call["cwd"])))
        return calls

    def assertPasses(self):
        code, out = self.check()
        self.assertEqual(code, 0, out)
        return out

    def assertFails(self):
        code, out = self.check()
        self.assertNotEqual(code, 0, out)
        return out

    def three_task_base(self):
        """Manifest of a three-task ticket on a base where task 1 is merged (its test is green there)."""
        self.workspace()
        self.manifest(TASK1 + TASK2 + TASK3, tasks={"1": TASK1, "2": TASK2, "3": TASK3})
        self.unit("scripts/ci/affected.test.ts")
        self.write("scripts/ci/affected.ts", "export const affected = () => 1;\n")
        self.base()

    def add_task2(self, *, skip=()):
        for rel in TASK2:
            if rel in skip:
                continue
            if rel.endswith(".test.ts"):
                self.unit(rel)
            elif rel.endswith(".feature"):
                self.write(rel, FEATURE)
            else:
                self.write(rel, "export const probe = 1;\n")
        self.manifest(TASK1 + TASK2 + TASK3, tasks={"1": TASK1, "2": TASK2, "3": TASK3}, note="red runs of task 2")
        self.commit("test(tests): frozen tests of task 2")

    # nothing to prove ------------------------------------------------------------------------------------------
    def test_passes_when_no_manifest_changed(self):
        self.workspace()
        self.base()
        self.write("README.md", "# scenario, changed\n")
        self.commit("docs(docs): readme")
        self.assertIn("nothing to prove", self.assertPasses())

    # AC1 and AC2: a task of a multi-task manifest ------------------------------------------------------------
    def test_checks_only_the_files_of_this_branch_and_names_the_skipped_ones(self):
        self.three_task_base()
        self.add_task2()
        out = self.assertPasses()
        self.assertEqual(sorted(self.vitest_calls()), [("packages/kit", "packages/kit/src/log.test.ts"),
                                                       ("services/det", "services/det/src/main.test.ts")], out)
        for rel in TASK3:
            self.assertIn(rel, out, "absent files of other tasks are named")
        self.assertIn("services/det/features/ready.feature", out, "the frozen feature is reported")

    def test_a_test_under_scripts_runs_with_the_repository_root(self):
        self.workspace()
        self.manifest(["scripts/ci/images.test.ts"], tasks={"1": ["scripts/ci/images.test.ts"]})
        self.base()
        self.unit("scripts/ci/images.test.ts")
        self.manifest(["scripts/ci/images.test.ts"], tasks={"1": ["scripts/ci/images.test.ts"]}, note="task 1")
        self.commit("test(tests): frozen test of task 1")
        out = self.assertPasses()
        self.assertEqual(self.vitest_calls(), [(".", "scripts/ci/images.test.ts")], out)

    def test_fails_when_a_listed_file_of_this_branch_task_is_missing(self):
        self.three_task_base()
        self.add_task2(skip=("services/det/src/main.test.ts",))
        self.assertIn("services/det/src/main.test.ts", self.assertFails())

    def test_manifest_without_tasks_fails_on_a_missing_listed_file(self):
        self.workspace()
        self.base()
        self.unit("packages/kit/src/log.test.ts")
        self.manifest(["packages/kit/src/log.test.ts", "packages/kit/src/gone.test.ts"])
        self.commit("test(tests): frozen tests")
        self.assertIn("packages/kit/src/gone.test.ts", self.assertFails())

    def test_manifest_without_tasks_checks_every_listed_test(self):
        self.workspace()
        self.base()
        self.unit("packages/kit/src/log.test.ts")
        self.unit("services/det/src/main.test.ts")
        self.manifest(["packages/kit/src/log.test.ts", "services/det/src/main.test.ts"])
        self.commit("test(tests): frozen tests")
        out = self.assertPasses()
        self.assertEqual(sorted(self.vitest_calls()), [("packages/kit", "packages/kit/src/log.test.ts"),
                                                       ("services/det", "services/det/src/main.test.ts")], out)

    # AC4: green on the base or the wrong reason blocks ----------------------------------------------------------
    def test_fails_and_names_the_file_when_a_unit_test_is_green_on_the_base(self):
        self.workspace()
        self.write("packages/kit/src/log.ts", "export const log = () => 1;\n")
        self.base()
        self.unit("packages/kit/src/log.test.ts")
        self.manifest(["packages/kit/src/log.test.ts"], tasks={"1": ["packages/kit/src/log.test.ts"]})
        self.commit("test(tests): frozen test")
        out = self.assertFails()
        self.assertIn("packages/kit/src/log.test.ts", out)
        self.assertIn("GREEN", out)

    def test_fails_and_names_the_file_when_a_unit_test_is_red_for_the_wrong_reason(self):
        self.workspace()
        self.base()
        self.unit("packages/kit/src/log.test.ts", broken=True)
        self.manifest(["packages/kit/src/log.test.ts"], tasks={"1": ["packages/kit/src/log.test.ts"]})
        self.commit("test(tests): frozen test")
        out = self.assertFails()
        self.assertIn("packages/kit/src/log.test.ts", out)
        self.assertIn("wrong reason", out)

    # AC3: frozen Python tests ---------------------------------------------------------------------------------
    def test_a_python_test_red_on_the_base_passes(self):
        self.workspace()
        self.base()
        self.write("tools/tests/test_tool.py", PY_TEST)
        self.write("tools/tool.py", PY_TOOL)
        self.manifest(["tools/tests/test_tool.py"], tasks={"1": ["tools/tests/test_tool.py"]})
        self.commit("feat(process): tool with its frozen test")
        out = self.assertPasses()
        self.assertIn("tools/tests/test_tool.py", out)
        self.assertEqual(self.vitest_calls(), [], out)

    def test_fails_and_names_the_file_when_a_python_test_is_green_on_the_base(self):
        self.workspace()
        self.write("tools/tool.py", PY_TOOL)
        self.base()
        self.write("tools/tests/test_tool.py", PY_TEST)
        self.manifest(["tools/tests/test_tool.py"], tasks={"1": ["tools/tests/test_tool.py"]})
        self.commit("test(tests): frozen test")
        out = self.assertFails()
        self.assertIn("tools/tests/test_tool.py", out)
        self.assertIn("GREEN", out)

    # AC5: bootstrap base without pnpm-lock.yaml ---------------------------------------------------------------
    def bootstrap(self, red_run):
        self.base()  # README only: no lockfile, no workspace
        self.workspace()
        self.unit("scripts/ci/affected.test.ts")
        self.write("scripts/ci/affected.ts", "export const affected = () => 1;\n")
        self.manifest(TASK1, tasks={"1": TASK1}, red_run=red_run)
        self.commit("build(platform): first workspace with its frozen test")

    def test_bootstrap_base_takes_the_red_run_of_the_manifest(self):
        self.bootstrap({"scripts/ci/affected.test.ts": {
            "exitCode": 1, "reason": "red for the right reason: Cannot find module ./affected.ts"}})
        out = self.assertPasses()
        self.assertIn("redRun", out)
        self.assertIn("pnpm-lock.yaml", out)
        self.assertEqual(self.vitest_calls(), [], "nothing runs vitest on a base without a lockfile")

    def test_bootstrap_base_fails_without_a_red_run_entry(self):
        self.bootstrap({})
        self.assertIn("scripts/ci/affected.test.ts", self.assertFails())

    def test_bootstrap_base_fails_on_an_incomplete_red_run_entry(self):
        for entry in ({"exitCode": 0, "reason": "green"}, {"exitCode": None, "reason": "pending"},
                      {"exitCode": 1}, {"exitCode": 1, "reason": " "}):
            with self.subTest(entry=entry):
                self.setUp()
                self.bootstrap({"scripts/ci/affected.test.ts": entry})
                self.assertIn("scripts/ci/affected.test.ts", self.assertFails())

    # round 2 (review of #42) ------------------------------------------------------------------------------------
    def one_task_green_on_base(self, path, module):
        """The module under test is on the base, the branch adds its frozen test and lists it: must fail (GREEN)."""
        self.workspace()
        self.write(module, "export const x = () => 1;\n")
        self.manifest(TASK1, tasks={"1": TASK1, "2": [path]})
        self.base()
        self.unit(path)
        self.manifest(TASK1 + [path], tasks={"1": TASK1, "2": [path]}, note="task 2")
        self.commit("test(tests): frozen test of task 2")

    # B1: paths with a space or an umlaut are read exactly
    def test_b1_a_path_with_a_space_is_checked(self):
        self.one_task_green_on_base("packages/kit/src/my log.test.ts", "packages/kit/src/my log.ts")
        out = self.assertFails()
        self.assertIn("packages/kit/src/my log.test.ts", out)
        self.assertIn("GREEN", out)

    def test_b1_a_path_with_an_umlaut_is_refused(self):  # round 3, R5: ASCII only (NFC/NFD)
        self.one_task_green_on_base("packages/kit/src/prüfung.test.ts", "packages/kit/src/prüfung.ts")
        out = self.assertFails()
        self.assertIn("packages/kit/src/prüfung.test.ts", out)
        self.assertIn("unsafe path", out)

    # B2: a manifest the branch does not touch still scopes the frozen files the branch brings
    def unchanged_manifest(self, *, module_on_base):
        self.workspace()
        tasks = {"1": TASK1, "2": ["packages/kit/src/log.test.ts"]}
        self.manifest(TASK1 + ["packages/kit/src/log.test.ts"], tasks=tasks)
        self.unit("scripts/ci/affected.test.ts")
        self.write("scripts/ci/affected.ts", "export const affected = () => 1;\n")
        if module_on_base:
            self.write("packages/kit/src/log.ts", "export const log = () => 1;\n")
        self.base()
        self.unit("packages/kit/src/log.test.ts")
        self.commit("test(tests): frozen test of task 2, manifest untouched")

    def test_b2_unchanged_manifest_still_blocks_a_test_green_on_the_base(self):
        self.unchanged_manifest(module_on_base=True)
        out = self.assertFails()
        self.assertIn("packages/kit/src/log.test.ts", out)
        self.assertIn("GREEN", out)

    def test_b2_unchanged_manifest_checks_only_the_files_of_this_branch(self):
        self.unchanged_manifest(module_on_base=False)
        out = self.assertPasses()
        self.assertEqual(self.vitest_calls(), [("packages/kit", "packages/kit/src/log.test.ts")], out)

    # B3: deleting a frozen file fails
    def test_b3_deleting_a_frozen_test_of_a_merged_task_fails(self):
        self.three_task_base()
        self.git("rm", "-q", "scripts/ci/affected.test.ts")
        self.add_task2()
        out = self.assertFails()
        self.assertIn("scripts/ci/affected.test.ts", out)
        self.assertIn("deleted", out)

    # B4: listed paths are validated, fail closed
    def test_b4_unsafe_listed_paths_fail(self):
        for bad in ("../outside.test.ts", "/etc/hosts", "-x.test.ts", "packages//kit/a.test.ts",
                    "packages/kit/`id`;x.test.ts"):
            with self.subTest(path=bad):
                self.setUp()
                self.three_task_base()
                self.add_task2()
                self.manifest(TASK1 + TASK2 + TASK3 + [bad], tasks={"1": TASK1, "2": TASK2, "3": TASK3, "9": [bad]},
                              note="unsafe")
                self.commit("test(tests): unsafe path")
                self.assertIn(bad, self.assertFails())

    def test_b4_a_symlinked_frozen_file_fails(self):
        self.three_task_base()
        self.add_task2()
        link = self.repo / "packages/kit/src/link.test.ts"
        os.symlink("../../../README.md", link)
        paths = TASK1 + TASK2 + TASK3 + ["packages/kit/src/link.test.ts"]
        self.manifest(paths, tasks={"1": TASK1, "2": TASK2 + ["packages/kit/src/link.test.ts"], "3": TASK3}, note="link")
        self.commit("test(tests): symlinked test")
        out = self.assertFails()
        self.assertIn("packages/kit/src/link.test.ts", out)
        self.assertIn("symlink", out)

    # N1: Python red for the wrong reason, and the right reasons of a unittest log
    def py_test(self, body, *, tool=True):
        self.workspace()
        self.base()
        self.write("tools/tests/test_tool.py", body)
        if tool:
            self.write("tools/tool.py", "def one():\n    return 1\n")
        self.manifest(["tools/tests/test_tool.py"], tasks={"1": ["tools/tests/test_tool.py"]})
        self.commit("feat(process): tool with its frozen test")

    def test_n1_python_red_for_the_wrong_reason_fails(self):
        self.py_test("import unittest\nimport lfc_no_such_package_42\n\n\nclass T(unittest.TestCase):\n"
                     "    def test_x(self):\n        pass\n")
        out = self.assertFails()
        self.assertIn("tools/tests/test_tool.py", out)
        self.assertIn("wrong reason", out)

    def test_n1_python_syntax_error_fails(self):
        self.py_test("import unittest\ndef broken(:\n")
        self.assertIn("wrong reason", self.assertFails())

    def test_n1_python_missing_module_under_test_is_the_right_reason(self):
        self.py_test("import pathlib, sys, unittest\nsys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))\n"
                     "import tool\n\n\nclass T(unittest.TestCase):\n    def test_x(self):\n"
                     "        self.assertEqual(tool.one(), 1)\n")
        self.assertIn("right reason", self.assertPasses())

    def test_n1_python_missing_tool_file_is_the_right_reason(self):
        self.py_test("import pathlib, unittest\nTOOL = pathlib.Path(__file__).resolve().parents[1] / 'tool.py'\n\n\n"
                     "class T(unittest.TestCase):\n    def test_x(self):\n        self.assertIn('one', TOOL.read_text())\n")
        self.assertIn("right reason", self.assertPasses())

    # N2: test-like files without a runner, evals tests, tests/<x> workspaces
    def test_n2_test_like_files_without_a_runner_fail(self):
        for rel in ("packages/kit/src/log.spec.ts", "packages/kit/src/log.test.mts", "packages/kit/src/log.test.js",
                    "tools/tests/sub/test_deep.py"):
            with self.subTest(path=rel):
                self.setUp()
                self.workspace()
                self.base()
                self.write(rel, "// frozen\n")
                self.manifest([rel], tasks={"1": [rel]})
                self.commit("test(tests): frozen file")
                out = self.assertFails()
                self.assertIn(rel, out)
                self.assertIn("no runner", out)

    def test_n2_an_evals_python_test_green_on_the_base_fails(self):
        self.workspace()
        self.write("evals/tool.py", PY_TOOL)
        self.base()
        self.write("evals/tests/test_tool.py", PY_TEST)
        self.manifest(["evals/tests/test_tool.py"], tasks={"1": ["evals/tests/test_tool.py"]})
        self.commit("test(evals): frozen test")
        out = self.assertFails()
        self.assertIn("evals/tests/test_tool.py", out)
        self.assertIn("GREEN", out)

    def test_n2_an_evals_python_test_red_on_the_base_passes(self):
        self.workspace()
        self.base()
        self.write("evals/tests/test_tool.py", PY_TEST)
        self.write("evals/tool.py", PY_TOOL)
        self.manifest(["evals/tests/test_tool.py"], tasks={"1": ["evals/tests/test_tool.py"]})
        self.commit("feat(evals): tool with its frozen test")
        self.assertIn("evals/tests/test_tool.py", self.assertPasses())

    def test_n2_a_unit_test_in_a_tests_workspace_runs_with_its_root(self):
        self.workspace()
        self.base()
        self.unit("tests/api/src/edge.test.ts")
        self.manifest(["tests/api/src/edge.test.ts"], tasks={"1": ["tests/api/src/edge.test.ts"]})
        self.commit("test(tests): frozen test")
        out = self.assertPasses()
        self.assertEqual(self.vitest_calls(), [("tests/api", "tests/api/src/edge.test.ts")], out)

    # N3: a non-zero vitest exit without a failed test is unproven
    def test_n3_vitest_exit_without_a_failed_test_is_unproven(self):
        self.workspace()
        self.write("packages/kit/src/log.ts", "export const log = () => 1;\n")
        self.base()
        self.write("packages/kit/src/log.test.ts", UNIT.format(name="log") + "// UNHANDLED_ERROR\n")
        self.manifest(["packages/kit/src/log.test.ts"], tasks={"1": ["packages/kit/src/log.test.ts"]})
        self.commit("test(tests): frozen test")
        out = self.assertFails()
        self.assertIn("packages/kit/src/log.test.ts", out)
        self.assertIn("unproven", out)

    # N4: a branch cannot shrink the scope of a manifest that exists on the base
    def test_n4_dropping_a_file_from_the_manifest_does_not_take_it_out_of_scope(self):
        self.one_task_green_on_base("packages/kit/src/log.test.ts", "packages/kit/src/log.ts")
        self.manifest(TASK1, tasks={"1": TASK1}, note="task 2 dropped")
        self.commit("chore(process): shrink the manifest")
        out = self.assertFails()
        self.assertIn("packages/kit/src/log.test.ts", out)
        self.assertIn("GREEN", out)

    # N5: helpers on the base, Python on a bootstrap base, failed install, a missing file of no task
    def test_n5_frozen_helpers_are_copied_onto_the_base(self):
        self.workspace()
        self.base()
        self.write("packages/kit/src/health.test.ts", UNIT.format(name="health") + "// requires testing/probe.ts\n")
        self.write("packages/kit/src/testing/probe.ts", "export const probe = 1;\n")
        files = ["packages/kit/src/health.test.ts", "packages/kit/src/testing/probe.ts"]
        self.manifest(files, tasks={"1": files})
        self.commit("test(tests): frozen test with helper")
        self.assertIn("right reason", self.assertPasses())

    def test_n5_python_runs_on_a_bootstrap_base(self):
        self.base()  # no lockfile
        self.write("tools/tests/test_tool.py", PY_TEST)
        self.write("tools/tool.py", PY_TOOL)
        self.manifest(["tools/tests/test_tool.py"], tasks={"1": ["tools/tests/test_tool.py"]})
        self.commit("feat(process): tool with its frozen test")
        out = self.assertPasses()
        self.assertIn("tools/tests/test_tool.py is red", out)

    def test_n5_a_failed_install_fails_closed(self):
        self.workspace()
        self.base()
        self.unit("packages/kit/src/log.test.ts")
        self.manifest(["packages/kit/src/log.test.ts"], tasks={"1": ["packages/kit/src/log.test.ts"]})
        self.commit("test(tests): frozen test")
        self.env["RBG_FAKE_INSTALL_FAILS"] = "1"
        out = self.assertFails()
        self.assertIn("packages/kit/src/log.test.ts", out)
        self.assertEqual(self.vitest_calls(), [], out)

    def test_n5_a_missing_file_of_no_task_fails(self):
        self.three_task_base()
        self.add_task2()
        self.manifest(TASK1 + TASK2 + TASK3 + ["packages/kit/src/orphan.test.ts"],
                      tasks={"1": TASK1, "2": TASK2, "3": TASK3}, note="orphan")
        self.commit("test(tests): orphan path")
        self.assertIn("packages/kit/src/orphan.test.ts", self.assertFails())

    # round 3 (last review of #42) ----------------------------------------------------------------------------
    # R1: scope against the merge base, tests on the tip of the base
    def test_r1_a_docs_branch_behind_main_with_a_merged_task_stays_green(self):
        self.three_task_base()
        self.git("checkout", "-q", "-b", "feature")
        self.write("README.md", "# docs change\n")
        self.commit("docs(docs): readme")
        self.git("checkout", "-q", "main")
        self.add_task2()  # main merges task 2 and updates the manifest after the branch point
        self.git("tag", "-f", "base")
        self.git("checkout", "-q", "feature")
        self.assertPasses()

    def test_r1_a_docs_branch_behind_main_with_a_new_manifest_stays_green(self):
        self.workspace()
        self.base()
        self.git("checkout", "-q", "-b", "feature")
        self.write("docs.md", "x\n")
        self.commit("docs(docs): x")
        self.git("checkout", "-q", "main")
        self.unit("scripts/ci/affected.test.ts")
        self.manifest(TASK1 + ["packages/kit/src/log.test.ts"], tasks={"1": TASK1, "2": ["packages/kit/src/log.test.ts"]})
        self.commit("test(tests): gate 1 of ticket 7 with the task-1 test")
        self.git("tag", "-f", "base")
        self.git("checkout", "-q", "feature")
        self.assertPasses()

    def test_r1_tests_run_on_the_tip_of_the_base(self):
        self.workspace()
        self.base()
        self.git("checkout", "-q", "-b", "feature")
        self.unit("packages/kit/src/log.test.ts")
        self.manifest(["packages/kit/src/log.test.ts"], tasks={"1": ["packages/kit/src/log.test.ts"]})
        self.commit("test(tests): frozen test")
        self.git("checkout", "-q", "main")
        self.write("packages/kit/src/log.ts", "export const log = () => 1;\n")  # main got the module meanwhile
        self.commit("feat(process): log")
        self.git("tag", "-f", "base")
        self.git("checkout", "-q", "feature")
        self.assertIn("GREEN", self.assertFails())

    # R2: vitest without colours
    def test_r2_vitest_runs_without_colours(self):
        self.workspace()
        self.base()
        self.unit("packages/kit/src/log.test.ts")
        self.manifest(["packages/kit/src/log.test.ts"], tasks={"1": ["packages/kit/src/log.test.ts"]})
        self.commit("test(tests): frozen test")
        out = self.assertPasses()
        envs = [json.loads(l)["env"] for l in self.log.read_text(encoding="utf-8").splitlines()
                if json.loads(l)["argv"][:3] == ["exec", "vitest", "run"]]
        self.assertEqual(envs, [{"NO_COLOR": "1", "FORCE_COLOR": "0"}], out)

    # R3: every file of an active task must exist, also under an unchanged manifest
    def test_r3_unchanged_manifest_fails_on_a_missing_file_of_the_active_task(self):
        self.workspace()
        two = ["packages/kit/src/log.test.ts", "packages/kit/src/health.test.ts"]
        self.manifest(TASK1 + two, tasks={"1": TASK1, "2": two})
        self.unit("scripts/ci/affected.test.ts")
        self.write("scripts/ci/affected.ts", "export const affected = () => 1;\n")
        self.base()
        self.unit("packages/kit/src/log.test.ts")  # health.test.ts of the same task not brought
        self.commit("test(tests): one of two task-2 tests")
        self.assertIn("packages/kit/src/health.test.ts", self.assertFails())

    # R4: Python helpers of the test directory must be frozen; relative paths resolve against the run directory
    def test_r4_an_unfrozen_fixture_of_the_test_directory_is_the_wrong_reason(self):
        self.workspace()
        self.write("tools/tool.py", "import sys\nprint(open(sys.argv[1]).read().strip())\n")
        self.base()
        self.write("tools/tests/fixtures/in.txt", "1\n")  # not frozen
        self.write("tools/tests/test_tool.py", "import pathlib, subprocess, sys, unittest\n"
                   "HERE = pathlib.Path(__file__).resolve().parent\nTOOL = HERE.parent / 'tool.py'\n\n\n"
                   "class T(unittest.TestCase):\n    def test_x(self):\n"
                   "        data = (HERE / 'fixtures' / 'in.txt').read_text()\n"
                   "        done = subprocess.run([sys.executable, str(TOOL), str(HERE / 'fixtures' / 'in.txt')],"
                   " capture_output=True, text=True)\n        self.assertEqual(done.stdout, data)\n")
        self.manifest(["tools/tests/test_tool.py"], tasks={"1": ["tools/tests/test_tool.py"]})
        self.commit("test(tests): frozen test with an unfrozen fixture")
        out = self.assertFails()
        self.assertIn("tools/tests/test_tool.py", out)
        self.assertIn("not frozen", out)

    def test_r4_a_relative_missing_file_resolves_against_the_run_directory(self):
        self.py_test("import pathlib, unittest\n\n\nclass T(unittest.TestCase):\n    def test_x(self):\n"
                     "        self.assertIn('one', pathlib.Path('tools/tool.py').read_text())\n")
        self.assertIn("missing file tools/tool.py", self.assertPasses())

    # R5: ASCII paths; router characters for TypeScript, the strict set for Python
    def test_r5_router_patterns_in_typescript_paths_pass(self):
        for rel in ("apps/web/src/routes/[id]/page.test.ts", "apps/web/src/routes/(group)/page.test.ts",
                    "apps/web/src/routes/$param/page.test.ts", "apps/web/src/routes/{slug}/page.test.ts"):
            with self.subTest(path=rel):
                self.setUp()
                self.workspace()
                self.base()
                self.unit(rel)
                self.manifest([rel], tasks={"1": [rel]})
                self.commit("test(web): frozen route test")
                out = self.assertPasses()
                self.assertEqual(self.vitest_calls(), [("apps/web", rel)], out)

    def test_r5_glob_characters_in_python_paths_and_edge_spaces_are_refused(self):
        for rel in ("tools/tests/test_[x].py", "tools/tests/test_$x.py", "packages/kit/ src/log.test.ts",
                    "packages/kit/src /log.test.ts"):
            with self.subTest(path=rel):
                self.setUp()
                self.three_task_base()
                self.add_task2()
                self.manifest(TASK1 + TASK2 + TASK3 + [rel], tasks={"1": TASK1, "2": TASK2, "3": TASK3, "9": [rel]},
                              note="unsafe")
                self.commit("test(tests): unsafe path")
                out = self.assertFails()
                self.assertIn(rel, out)
                self.assertIn("unsafe path", out)


class SonarSources(unittest.TestCase):
    # AC6: the scanner fails on a directory that does not exist (apps before increment 2).
    def test_names_only_directories_that_exist(self):
        props = {}
        for line in (ROOT / "sonar-project.properties").read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                props[key.strip()] = value.strip()
        for key in ("sonar.sources", "sonar.tests"):
            for entry in filter(None, (e.strip() for e in props.get(key, "").split(","))):
                with self.subTest(key=key, entry=entry):
                    self.assertTrue((ROOT / entry).is_dir(), f"{key} names {entry}, which does not exist")


if __name__ == "__main__":
    unittest.main()
