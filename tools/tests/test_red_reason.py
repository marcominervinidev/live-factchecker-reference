"""Tests for the red-reason classifier of the red-before-green check. Run: python3 -I -m unittest discover -s tools/tests"""
import contextlib, io, os, pathlib, subprocess, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import classify_red_reason  # noqa: E402

TEST = "packages/pipeline/src/turns.test.ts"

RELATIVE_MISSING = f"""
 RUN  v3.2.4 /wt

 FAIL  {TEST} [ {TEST} ]
Error: Failed to resolve import "./turns" from "{TEST}". Does the file exist?
 ❯ {TEST}:2:28

 Test Files  1 failed (1)
      Tests  no tests
"""

NODE_RELATIVE_MISSING = f"""
 FAIL  {TEST} [ {TEST} ]
Error: Cannot find module '/wt/packages/pipeline/src/turns' imported from /wt/{TEST}

 Test Files  1 failed (1)
"""

ALIAS_MISSING = f"""
 FAIL  {TEST} [ {TEST} ]
Error: Failed to resolve import "@lfc/pipeline" from "{TEST}". Does the file exist?

 Test Files  1 failed (1)
"""

PACKAGE_MISSING = f"""
 FAIL  {TEST} [ {TEST} ]
Error: Cannot find package 'fast-check' imported from /wt/{TEST}

 Test Files  1 failed (1)
"""

SYNTAX_ERROR = f"""
 FAIL  {TEST} [ {TEST} ]
SyntaxError: Unexpected token ')'
 ❯ {TEST}:14:3

 Test Files  1 failed (1)
"""

TYPE_ERROR_AT_LOAD = f"""
 FAIL  {TEST} [ {TEST} ]
TypeError: Cannot read properties of undefined (reading 'each')
 ❯ {TEST}:5:4

 Test Files  1 failed (1)
"""

MIXED = f"""
 FAIL  {TEST} [ {TEST} ]
Error: Failed to resolve import "./turns" from "{TEST}". Does the file exist?

 FAIL  packages/pipeline/src/dedup.test.ts [ packages/pipeline/src/dedup.test.ts ]
Error: Cannot find module 'vitest' imported from /wt/packages/pipeline/src/dedup.test.ts

 Test Files  2 failed (2)
"""

ASSERTION_FAILURES = f"""
 FAIL  {TEST} > buildTurns > merges two segments of one speaker
AssertionError: expected [] to have a length of 1 but got +0
 ❯ {TEST}:12:30

 FAIL  {TEST} > buildTurns > drops a duplicate claim within 60 s
TypeError: dedup is not a function
 ❯ {TEST}:20:5

 Test Files  1 failed (1)
      Tests  2 failed (2)
"""

EMPTY = ""
NO_RUN = "No test files found, exiting with code 1\n"


class Classify(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        (self.root / "packages" / "pipeline" / "src").mkdir(parents=True)
        (self.root / TEST).write_text("import { buildTurns } from './turns';\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def classify(self, log, tests=(TEST,)):
        return classify_red_reason.classify(log, list(tests), self.root)

    def test_missing_relative_module_is_the_right_reason(self):
        ok, reasons = self.classify(RELATIVE_MISSING)
        self.assertTrue(ok, reasons)
        self.assertEqual(reasons, ["red for the right reason: missing module ./turns"])

    def test_missing_relative_module_in_node_wording_is_the_right_reason(self):
        ok, reasons = self.classify(NODE_RELATIVE_MISSING)
        self.assertTrue(ok, reasons)
        self.assertIn("missing module /wt/packages/pipeline/src/turns", reasons[0])

    def test_missing_workspace_alias_is_the_right_reason(self):
        ok, reasons = self.classify(ALIAS_MISSING)
        self.assertTrue(ok, reasons)
        self.assertEqual(reasons, ["red for the right reason: missing module @lfc/pipeline"])

    def test_existing_workspace_behind_unresolved_alias_is_the_wrong_reason(self):
        (self.root / "packages" / "pipeline" / "package.json").write_text("{}", encoding="utf-8")
        ok, reasons = self.classify(ALIAS_MISSING)
        self.assertFalse(ok)
        self.assertIn("@lfc/pipeline", reasons[0])
        self.assertIn("wrong reason", reasons[0])

    def test_existing_relative_module_is_the_wrong_reason(self):
        (self.root / "packages" / "pipeline" / "src" / "turns.ts").write_text("export {};\n", encoding="utf-8")
        ok, reasons = self.classify(RELATIVE_MISSING)
        self.assertFalse(ok)
        self.assertIn("./turns", reasons[0])

    def test_missing_package_is_the_wrong_reason(self):
        ok, reasons = self.classify(PACKAGE_MISSING)
        self.assertFalse(ok)
        self.assertEqual(reasons, ["red for the wrong reason: unresolvable package fast-check (test infrastructure, not the module under test)"])

    def test_syntax_error_is_the_wrong_reason(self):
        ok, reasons = self.classify(SYNTAX_ERROR)
        self.assertFalse(ok)
        self.assertIn("SyntaxError", reasons[0])

    def test_type_error_while_loading_the_test_file_is_the_wrong_reason(self):
        ok, reasons = self.classify(TYPE_ERROR_AT_LOAD)
        self.assertFalse(ok)
        self.assertIn("TypeError", reasons[0])
        self.assertIn(TEST, reasons[0])

    def test_mixed_log_fails_on_the_wrong_reason(self):
        ok, reasons = self.classify(MIXED, tests=(TEST, "packages/pipeline/src/dedup.test.ts"))
        self.assertFalse(ok)
        self.assertEqual(len(reasons), 1)
        self.assertIn("vitest", reasons[0])

    def test_failing_assertions_are_the_right_reason(self):
        ok, reasons = self.classify(ASSERTION_FAILURES)
        self.assertTrue(ok, reasons)
        self.assertIn("missing behaviour", reasons[0])

    def test_empty_log_is_the_wrong_reason(self):
        ok, reasons = self.classify(EMPTY)
        self.assertFalse(ok)
        self.assertIn("no test run", reasons[0])

    def test_log_without_a_test_run_is_the_wrong_reason(self):
        ok, reasons = self.classify(NO_RUN)
        self.assertFalse(ok)
        self.assertIn("no test run", reasons[0])

    # round 3 of #42: R2 colours, R6 SyntaxError only as a load error
    def test_coloured_log_is_read_like_a_plain_one(self):
        coloured = TYPE_ERROR_AT_LOAD.replace(" FAIL ", " \x1b[31m\x1b[1mFAIL\x1b[22m\x1b[39m ").replace(
            "TypeError:", "\x1b[31mTypeError:\x1b[39m")
        ok, reasons = self.classify(coloured)
        self.assertFalse(ok)
        self.assertIn("TypeError", reasons[0])
        self.assertNotIn("\x1b", reasons[0])

    def test_syntax_error_in_an_assertion_text_is_not_a_load_error(self):
        log = f"""
 FAIL  {TEST} > buildTurns > reports a parse failure
AssertionError: expected 'ok' to be 'SyntaxError: Unexpected token'
 ❯ {TEST}:12:30

 Test Files  1 failed (1)
      Tests  1 failed (1)
"""
        ok, reasons = self.classify(log)
        self.assertTrue(ok, reasons)
        self.assertIn("missing behaviour", reasons[0])


class Cli(unittest.TestCase):
    def run_main(self, log, root):
        log_file = root / "rbg.log"
        log_file.write_text(log, encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = classify_red_reason.main([str(log_file), "--test", TEST, "--root", str(root)])
        return code, out.getvalue()

    def test_exit_codes_and_messages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "packages" / "pipeline" / "src").mkdir(parents=True)
            code, out = self.run_main(RELATIVE_MISSING, root)
            self.assertEqual(code, 0)
            self.assertIn("red for the right reason: missing module ./turns", out)
            code, out = self.run_main(PACKAGE_MISSING, root)
            self.assertEqual(code, 1)
            self.assertIn("red for the wrong reason", out)


# unittest logs (python3 -I -m unittest discover -s tools/tests -p <file>), root is the base checkout /wt -------------
PY_TEST = "tools/tests/test_tool.py"


def unittest_log(body, ran=1, summary="FAILED (errors=1)"):
    return f"E\n{'=' * 70}\n{body}\n\n{'-' * 70}\nRan {ran} test{'s' if ran != 1 else ''} in 0.001s\n\n{summary}\n"


def load_error(module, cause):
    return unittest_log(f"""ERROR: {module} (unittest.loader._FailedTest.{module})
{'-' * 70}
ImportError: Failed to import test module: {module}
Traceback (most recent call last):
  File "/usr/lib/python3.12/unittest/loader.py", line 394, in _find_test_path
    module = self._get_module_from_name(name)
  File "/wt/tools/tests/{module}.py", line 3, in <module>
    import tool
{cause}
""")


PY_ASSERTION = unittest_log(f"""FAIL: test_x (test_tool.T.test_x)
{'-' * 70}
Traceback (most recent call last):
  File "/wt/{PY_TEST}", line 6, in test_x
    self.assertTrue(TOOL.is_file(), "tools/tool.py is missing")
AssertionError: False is not true : tools/tool.py is missing""", summary="FAILED (failures=1)")
PY_MODULE_MISSING = load_error("test_tool", "ModuleNotFoundError: No module named 'tool'")
PY_PACKAGE_MISSING = load_error("test_tool", "ModuleNotFoundError: No module named 'yaml'")
PY_SYNTAX = load_error("test_tool", '  File "/wt/tools/tests/test_tool.py", line 2\n    def f(:\n          ^\nSyntaxError: invalid syntax')
PY_OTHER_LOAD_ERROR = load_error("test_tool", "ImportError: cannot import name 'one' from 'tool' (/wt/tools/tool.py)")
PY_FILE_MISSING = unittest_log(f"""ERROR: test_x (test_tool.T.test_x)
{'-' * 70}
Traceback (most recent call last):
  File "/wt/{PY_TEST}", line 5, in test_x
    TOOL.read_text()
FileNotFoundError: [Errno 2] No such file or directory: '/wt/tools/tool.py'""")
PY_NO_TESTS = f"\n{'-' * 70}\nRan 0 tests in 0.000s\n\nNO TESTS RAN\n"


class ClassifyUnittest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name) / "wt"
        self.head = pathlib.Path(self.tmp.name) / "head"
        for root in (self.base, self.head):
            (root / "tools" / "tests").mkdir(parents=True)
            (root / PY_TEST).write_text("import tool\n", encoding="utf-8")
        (self.head / "tools" / "tool.py").write_text("def one():\n    return 1\n", encoding="utf-8")
        self.commit_head()

    def commit_head(self):
        """The HEAD checkout is a git repository: the classifier reads its HEAD blobs, not its files."""
        env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
        for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "head"]):
            subprocess.run(["git", *args], cwd=self.head, env=env, check=True, capture_output=True)

    def tearDown(self):
        self.tmp.cleanup()

    def classify(self, log, cwd=None):
        log = log.replace("/wt/", f"{self.base}/")
        return classify_red_reason.classify(log, [PY_TEST], self.base, head=self.head, cwd=cwd)

    def test_failing_assertions_are_the_right_reason(self):
        ok, reasons = self.classify(PY_ASSERTION)
        self.assertTrue(ok, reasons)
        self.assertIn("missing behaviour", reasons[0])

    def test_missing_module_under_test_is_the_right_reason(self):
        ok, reasons = self.classify(PY_MODULE_MISSING)
        self.assertTrue(ok, reasons)
        self.assertEqual(reasons, ["red for the right reason: missing module tool"])

    def test_missing_tool_file_under_test_is_the_right_reason(self):
        ok, reasons = self.classify(PY_FILE_MISSING)
        self.assertTrue(ok, reasons)
        self.assertEqual(reasons, ["red for the right reason: missing file tools/tool.py"])

    def test_module_that_exists_on_the_base_is_the_wrong_reason(self):
        (self.base / "tools" / "tool.py").write_text("x = 1\n", encoding="utf-8")
        ok, reasons = self.classify(PY_MODULE_MISSING)
        self.assertFalse(ok)
        self.assertIn("tool", reasons[0])

    def test_missing_third_party_package_is_the_wrong_reason(self):
        ok, reasons = self.classify(PY_PACKAGE_MISSING)
        self.assertFalse(ok)
        self.assertIn("yaml", reasons[0])

    def test_syntax_error_is_the_wrong_reason(self):
        ok, reasons = self.classify(PY_SYNTAX)
        self.assertFalse(ok)
        self.assertIn("SyntaxError", reasons[0])

    def test_other_load_error_before_any_test_ran_is_the_wrong_reason(self):
        ok, reasons = self.classify(PY_OTHER_LOAD_ERROR)
        self.assertFalse(ok)
        self.assertIn("load error", reasons[0])

    def test_no_test_ran_is_the_wrong_reason(self):
        ok, reasons = self.classify(PY_NO_TESTS)
        self.assertFalse(ok)
        self.assertIn("no test run", reasons[0])

    # round 3 of #42: R4 helpers of the test directory, run directory, HEAD blobs; R6
    def test_missing_unfrozen_fixture_of_the_test_directory_is_the_wrong_reason(self):
        (self.head / "tools" / "tests" / "fixtures").mkdir()
        (self.head / "tools" / "tests" / "fixtures" / "in.txt").write_text("1\n", encoding="utf-8")
        self.commit_head()
        ok, reasons = self.classify(PY_FILE_MISSING.replace("/wt/tools/tool.py", "/wt/tools/tests/fixtures/in.txt"))
        self.assertFalse(ok)
        self.assertIn("not frozen", reasons[0])

    def test_missing_helper_module_of_the_test_directory_is_the_wrong_reason(self):
        (self.head / "tools" / "tests" / "_helpers.py").write_text("X = 1\n", encoding="utf-8")
        self.commit_head()
        ok, reasons = self.classify(load_error("test_tool", "ModuleNotFoundError: No module named '_helpers'"))
        self.assertFalse(ok)
        self.assertIn("not frozen", reasons[0])

    def test_relative_missing_file_resolves_against_the_run_directory(self):
        log = PY_FILE_MISSING.replace("'/wt/tools/tool.py'", "'tools/tool.py'")
        ok, reasons = self.classify(log, cwd=self.base)
        self.assertTrue(ok, reasons)
        self.assertEqual(reasons, ["red for the right reason: missing file tools/tool.py"])

    def test_a_file_only_in_the_head_worktree_is_not_at_head(self):
        (self.head / "tools" / "extra.py").write_text("x = 1\n", encoding="utf-8")  # not committed
        ok, reasons = self.classify(PY_FILE_MISSING.replace("/wt/tools/tool.py", "/wt/tools/extra.py"))
        self.assertFalse(ok)

    def test_syntax_error_in_an_assertion_text_is_not_a_load_error_in_unittest(self):
        ok, reasons = self.classify(PY_ASSERTION.replace("tools/tool.py is missing", "SyntaxError: bad input"))
        self.assertTrue(ok, reasons)
        self.assertIn("missing behaviour", reasons[0])

    def test_cli_takes_the_head_checkout(self):
        log_file = self.base / "rbg.log"
        log_file.write_text(PY_MODULE_MISSING.replace("/wt/", f"{self.base}/"), encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = classify_red_reason.main([str(log_file), "--test", PY_TEST, "--root", str(self.base),
                                             "--head", str(self.head)])
        self.assertEqual(code, 0, out.getvalue())


if __name__ == "__main__":
    unittest.main()
