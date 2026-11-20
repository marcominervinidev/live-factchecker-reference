"""Tests for the pure functions of the nightly trend comment (no gh call). Run: python3 -I -m unittest discover -s tools/tests"""
import json, pathlib, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import nightly_trend  # noqa: E402

NEEDS = {
    "plan": {"result": "success", "outputs": {"browser": "firefox"}},
    "stryker": {"result": "success"},
    "e2e": {"result": "failure"},
    "lighthouse": {},
}


class Render(unittest.TestCase):
    def test_job_table_browser_and_run_link(self):
        md = nightly_trend.render(NEEDS, "firefox", "https://github.com/x/y/actions/runs/1", {})
        self.assertIn("[Lauf](https://github.com/x/y/actions/runs/1)", md)
        self.assertIn("| stryker | success |", md)
        self.assertIn("| e2e | failure |", md)
        self.assertIn("| lighthouse | ? |", md)
        self.assertNotIn("| plan |", md)
        self.assertIn("E2E-Browser: `firefox` (dreifach)", md)
        self.assertNotIn("Mutation Score", md)

    def test_mutation_scores_table_sorted_with_dash_for_unknown(self):
        md = nightly_trend.render(NEEDS, "webkit", "u", {"web": None, "pipeline": 83.3})
        rows = [l for l in md.splitlines() if l.startswith("| pipeline") or l.startswith("| web")]
        self.assertEqual(rows, ["| pipeline | 83.3 % |", "| web | – % |"])


class MutationScores(unittest.TestCase):
    def test_reads_stryker_reports_per_package_and_skips_broken_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            report = root / "pipeline" / "reports" / "mutation" / "mutation.json"
            report.parent.mkdir(parents=True)
            mutants = [{"status": s} for s in ("Killed", "Killed", "Killed", "Timeout", "Survived", "Ignored")]
            report.write_text(json.dumps({"files": {"src/turns.ts": {"mutants": mutants}}}), encoding="utf-8")
            broken = root / "web" / "reports" / "mutation" / "mutation.json"
            broken.parent.mkdir(parents=True)
            broken.write_text("{not json", encoding="utf-8")
            self.assertEqual(nightly_trend.mutation_scores(root), {"pipeline": 80.0})

    def test_no_mutants_means_no_score(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            report = root / "ui" / "reports" / "mutation" / "mutation.json"
            report.parent.mkdir(parents=True)
            report.write_text(json.dumps({"files": {}}), encoding="utf-8")
            self.assertEqual(nightly_trend.mutation_scores(root), {"ui": None})


if __name__ == "__main__":
    unittest.main()
