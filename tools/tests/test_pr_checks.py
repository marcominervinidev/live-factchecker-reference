"""Tests for the PR-format checks. Run: python3 -I -m unittest discover -s tools/tests"""
import json, pathlib, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import agent_balance, check_commits, check_eval_report, check_pr_size  # noqa: E402

TYPES, SCOPES, NOUNS = check_commits.config()


class Commits(unittest.TestCase):
    def ok(self, h, allow_wip=True):
        self.assertIsNone(check_commits.check_header(h, allow_wip=allow_wip, types=TYPES, scopes=SCOPES, proper_nouns=NOUNS), h)

    def bad(self, h, allow_wip=True):
        self.assertIsNotNone(check_commits.check_header(h, allow_wip=allow_wip, types=TYPES, scopes=SCOPES, proper_nouns=NOUNS), h)

    def test_good_headers(self):
        self.ok("feat(gateway): accept audio uploads over websocket")
        self.ok("fix(contracts)!: rename speaker field")
        self.ok("ci(ci): pin fallow action")
        self.ok("wip: half-done turn builder")
        self.ok("Merge branch 'x' into y")

    def test_bad_headers(self):
        self.bad("add stuff")
        self.bad("feat: no scope")
        self.bad("feat(unknown-scope): x")
        self.bad("feature(gateway): wrong type")
        self.bad("feat(gateway): " + "x" * 100)
        self.bad("wip: not in a pr title", allow_wip=False)

    def test_subject_case(self):
        self.ok("docs(process): Sonar project key in the PR format checklist")  # proper noun as first word
        self.ok("ci(ci): SonarQube Cloud analysis parameters")
        self.ok("ci(ci): CI runs the limit watcher tests")  # acronym
        self.ok("fix(ci): GHCR login uses the workflow token")
        self.bad("docs(process): Add a section on gates")  # ordinary word in title case
        self.bad("feat(web): Cards render verdicts")

    def test_scopes_and_proper_nouns_come_from_config(self):
        self.assertIn("gateway", SCOPES)
        self.assertIn("process", SCOPES)
        self.assertIn("feat", TYPES)
        self.assertIn("Sonar", NOUNS)
        self.assertNotIn("Add", NOUNS)


class PrSize(unittest.TestCase):
    def test_counts_only_production_lines(self):
        numstat = "\n".join([
            "100\t20\tservices/gateway/src/upload.ts",
            "300\t0\tservices/gateway/src/upload.test.ts",
            "50\t0\ttests/api/features/upload.feature",
            "900\t0\tpnpm-lock.yaml",
            "10\t0\tdocs/process/x.md",
            "5\t0\t.github/workflows/ci.yml",
            "-\t-\tevals/golden/x/audio.opus",
            "7\t3\tpackages/contracts/src/live.ts",
        ])
        total, rows = check_pr_size.production_lines(numstat)
        self.assertEqual(total, 130)
        self.assertEqual(rows[0][0], "services/gateway/src/upload.ts")

    def test_frozen_files_of_a_manifest_are_not_production(self):
        numstat = "\n".join([
            "242\t0\tservices/detection/features/steps/detection.steps.ts",
            "19\t0\tpackages/service-kit/src/testing/probe-body.ts",
            "50\t0\tservices/detection/src/main.ts",
        ])
        frozen = {"services/detection/features/steps/detection.steps.ts", "packages/service-kit/src/testing/probe-body.ts"}
        self.assertEqual(check_pr_size.production_lines(numstat, frozen)[0], 50)
        self.assertEqual(check_pr_size.production_lines(numstat)[0], 311)

    def test_frozen_paths_are_read_from_the_manifests_at_head(self):
        def show(spec):
            return {"HEAD:.claude/frozen/25.json": '{"paths": ["a/steps/x.ts", "b/c.test.ts"]}'}[spec]
        self.assertEqual(check_pr_size.frozen_paths("HEAD", ["25.json"], show), {"a/steps/x.ts", "b/c.test.ts"})

    def test_eval_harness_is_not_production(self):
        numstat = "300\t10\tevals/src/harness/pipeline.py\n40\t0\tevals/tools/messung_audio.sh\n5\t1\ttools/check_pr_size.py\n"
        self.assertEqual(check_pr_size.production_lines(numstat)[0], 6)

    def test_limits(self):
        self.assertEqual((check_pr_size.WARN, check_pr_size.BLOCK), (400, 800))


class EvalReport(unittest.TestCase):
    def test_report_matching_commit_is_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            (d / "a.json").write_text(json.dumps({"meta": {"commit": "abc1234"}}), encoding="utf-8")
            (d / "m.json").write_text(json.dumps({"meta": {"commit": "abc1234", "mock": True}}), encoding="utf-8")
            self.assertEqual(check_eval_report.report_for("abc1234def", d).name, "a.json")
            self.assertIsNone(check_eval_report.report_for("fff0000", d))

    def test_markdown_report_naming_the_commit_is_found_and_mock_is_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            (d / "arm-2026-11-01").mkdir()
            (d / "arm-2026-11-01" / "x-mock.md").write_text("# Bericht\n\nCommit: abc1234\n", encoding="utf-8")
            self.assertIsNone(check_eval_report.report_for("abc1234def", d))
            (d / "arm-2026-11-01" / "auswertung.md").write_text("# Auswertung\n\n- **Commit:** abc1234\n", encoding="utf-8")
            self.assertEqual(check_eval_report.report_for("abc1234def", d).name, "auswertung.md")
            self.assertIsNone(check_eval_report.report_for("fff0000", d))

    def test_report_naming_an_earlier_commit_with_the_same_files_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            (d / "audio-2026-10-27").mkdir()
            (d / "audio-2026-10-27" / "lauf.md").write_text("# Bericht\n\n| Commit | d50a82d |\n", encoding="utf-8")
            same = lambda c: c == "d50a82d"
            self.assertEqual(check_eval_report.report_for("cf64f3f00", d, same).name, "lauf.md")
            self.assertIsNone(check_eval_report.report_for("cf64f3f00", d, lambda c: False))
            self.assertIsNone(check_eval_report.report_for("cf64f3f00", d))

    def test_same_files_compares_the_changed_files_with_git(self):
        head = check_eval_report.subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        self.assertTrue(check_eval_report.same_files(head, "HEAD", ["tools/check_eval_report.py"]))
        self.assertFalse(check_eval_report.same_files("0000000", "HEAD", ["tools/check_eval_report.py"]))

    def test_trigger_paths(self):
        self.assertTrue(check_eval_report.TRIGGER.search("evals/configs/prompts/claim_extractor.de.txt"))
        self.assertTrue(check_eval_report.TRIGGER.search("packages/pipeline/src/turns.ts"))
        self.assertFalse(check_eval_report.TRIGGER.search("services/gateway/src/upload.ts"))


class Balance(unittest.TestCase):
    def test_renders_from_fixture(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp) / "12"; d.mkdir()
            (d / "test-design-r1.json").write_text(json.dumps({"round": 1}), encoding="utf-8")
            (d / "test-design-r2.json").write_text(json.dumps({"round": 2}), encoding="utf-8")
            (d / "implementer-t1.md").write_text("STATUS: DONE\nAttempts: 2\n", encoding="utf-8")
            (d / "review-chain.json").write_text(json.dumps({"results": [{"role": "reviewer", "blockers": [{"path": "a.ts", "line": 3, "finding": "any"}], "warnings": []}]}), encoding="utf-8")
            (d / "acceptance.json").write_text(json.dumps({"real": [{"verdict": "passt"}, {"verdict": "passt nicht"}], "canaryCaught": True, "discardedRuns": 0}), encoding="utf-8")
            (d / "usage.json").write_text(json.dumps({"critic": {"model": "claude-fable-5-1", "tokens": 12000, "cost_usd": 0.4}}), encoding="utf-8")
            md = agent_balance.render(agent_balance.load(12, pathlib.Path(tmp)))
            self.assertIn("| implementer (t1) |", md)
            self.assertIn("| 2 |", md)
            self.assertIn("- [ ] reviewer: `a.ts`:3 any · berechtigt", md)
            self.assertIn("Rücklauf an Tor 1: 1 Runde(n) · Richter: 1 passt, 1 passt nicht, 0 unklar, Kanarienvogel erkannt", md)
            self.assertIn("claude-fable-5-1", md)
            self.assertNotIn("| Hand (", md)

    def test_hand_task_renders_owner_time_instead_of_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp) / "12"; d.mkdir()
            (d / "hand-t2.json").write_text(json.dumps({"minutes": 95, "sessions": 3}), encoding="utf-8")
            data = agent_balance.load(12, pathlib.Path(tmp))
            self.assertEqual(data["hand"], [{"task": "t2", "minutes": 95, "sessions": 3}])
            md = agent_balance.render(data)
            self.assertIn("| Hand (t2) | owner | 3 Sitzung(en) | | 95 min | |", md)
            self.assertNotIn("implementer", md.split("Befunde")[0])


if __name__ == "__main__":
    unittest.main()
