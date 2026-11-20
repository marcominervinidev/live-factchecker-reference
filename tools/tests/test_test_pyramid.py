"""Tests for the advisory test pyramid check. Run: python3 -I -m unittest discover -s tools/tests"""
import contextlib, io, json, os, pathlib, sys, tempfile, unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import check_test_pyramid  # noqa: E402


def unit_file(n):
    return "describe('x', () => {\n" + "".join(f"  it('does {i}', () => {{}})\n" for i in range(n)) + "})\n"


def feature(n):
    return "Feature: f\n" + "".join(f"  Scenario: s{i}\n    Given x\n" for i in range(n))


def ticket(tmp, unit=0, api=0, e2e=0, acceptance=0, note=None):
    root = pathlib.Path(tmp)
    files = {
        "packages/pipeline/src/turns.test.ts": unit_file(unit),
        "tests/api/features/claims.feature": feature(api),
        "tests/e2e/features/card.feature": feature(e2e),
        "tests/acceptance/features/123/owner.feature": feature(acceptance),
        "packages/contracts/src/live.json": "{}",
    }
    for path, text in files.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text, encoding="utf-8")
    manifest = {"issue": 123, "paths": sorted(files)}
    if note:
        manifest["pyramidNote"] = note
    (root / ".claude" / "frozen").mkdir(parents=True)
    (root / ".claude" / "frozen" / "123.json").write_text(json.dumps(manifest), encoding="utf-8")
    return root


def run(argv, env=None):
    out = io.StringIO()
    with mock.patch.dict(os.environ, env or {}, clear=False), contextlib.redirect_stdout(out):
        code = check_test_pyramid.main(argv)
    return code, out.getvalue()


class Stages(unittest.TestCase):
    def test_stage_comes_from_the_path(self):
        cases = {
            "packages/x/src/a.test.ts": "1", "apps/web/src/b.test.tsx": "1",
            "services/detection/features/a.feature": "2a", "tests/integration/features/a.feature": None, "apps/web/tests/features/a.feature": "2b",
            "tests/api/features/a.feature": "3", "tests/e2e/features/a.feature": "4",
            "tests/acceptance/features/1/a.feature": None, "packages/contracts/live.json": None,
        }
        for path, stage in cases.items():
            with self.subTest(path=path):
                self.assertEqual(check_test_pyramid.stage_of(path), stage)

    def test_counts_cases_not_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = ticket(tmp, unit=5, api=2, e2e=1, acceptance=4)
            counts = check_test_pyramid.count(root, json.loads((root / ".claude/frozen/123.json").read_text())["paths"])
            self.assertEqual(counts, {"1": 5, "2a": 0, "2b": 0, "3": 2, "4": 1})


class Warnings(unittest.TestCase):
    def test_on_target_ticket_has_no_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = run(["--root", str(ticket(tmp, unit=16, api=3, e2e=1))])
            self.assertEqual(code, 0)
            self.assertIn("issue 123: 20 tests, stage 1 80%, stages 2a-3 15%, stage 4 5%", out)
            self.assertNotIn("warning", out)

    def test_too_few_unit_tests_warn_from_twenty_tests_on(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = run(["--root", str(ticket(tmp, unit=11, api=8, e2e=1))])
            self.assertEqual(code, 0)
            self.assertIn("warning: issue 123: stage 1 below 60%", out)

    def test_too_many_e2e_tests_warn(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = run(["--root", str(ticket(tmp, unit=16, api=1, e2e=3))])
            self.assertEqual(code, 0)
            self.assertIn("stage 4 above 10%", out)

    def test_small_ticket_never_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = run(["--root", str(ticket(tmp, unit=2, api=5, e2e=5))])
            self.assertEqual(code, 0)
            self.assertNotIn("warning", out)

    def test_manifest_note_is_shown_with_the_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = run(["--root", str(ticket(tmp, unit=10, api=10, note="contract ticket"))])
            self.assertIn("manifest says: contract ticket", out)

    def test_summary_goes_to_the_step_summary_and_exit_stays_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = ticket(tmp, unit=5, e2e=20)
            summary = pathlib.Path(tmp) / "summary.md"
            code, _ = run(["--root", str(root)], env={"GITHUB_STEP_SUMMARY": str(summary)})
            self.assertEqual(code, 0)
            text = summary.read_text(encoding="utf-8")
            self.assertIn("Test pyramid (advisory)", text)
            self.assertIn("stage 1 below 60% and stage 4 above 10%", text)

    def test_all_counts_the_whole_repository_without_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = run(["--all", "--root", str(ticket(tmp, unit=16, api=3, e2e=1, acceptance=50))])
            self.assertEqual(code, 0)
            self.assertIn("repository: 20 tests", out)

    def test_no_manifest_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = run(["--root", tmp])
            self.assertEqual(code, 0)
            self.assertIn("nothing to count", out)


if __name__ == "__main__":
    unittest.main()
