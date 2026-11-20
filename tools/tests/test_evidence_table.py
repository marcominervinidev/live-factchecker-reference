"""Tests for the evidence table. Run: python3 -I -m unittest discover -s tools/tests"""
import pathlib, re, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import evidence_table  # noqa: E402

FEATURE = """@issue-7 @ac-1
Feature: Masking

  Background:
    Given a stream

  Scenario: IBAN is masked
    When an IBAN is spoken
    Then it is masked

  @ac-2
  Scenario Outline: Names are masked
    When <name> is spoken
    Then it is masked

    Examples:
      | name |
      | Anna |

  @issue-8 @ac-3
  Scenario: Other ticket
    Then nothing
"""

OTHER_FEATURE = """Feature: Standalone
  @issue-7 @ac-3
  Scenario: Scenario-level tags only
    Then ok
"""

VITEST = """// covers @issue-7
describe("masking", () => {
  it("drops IBAN @ac-1", () => {});
  test('keeps the sentence @ac-2 @ac-3', () => {});
  it("untagged", () => {});
});
"""


def write(root: pathlib.Path, rel: str, text: str):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def rows(md: str) -> list[list[str]]:
    return [[c.strip() for c in l.strip("|").split("|")] for l in md.splitlines() if re.match(r"\| AC\d", l)]


class FeatureParsing(unittest.TestCase):
    def test_feature_and_scenario_tags_and_outline(self):
        found = evidence_table.parse_feature(FEATURE, 7)
        self.assertEqual(found, [("IBAN is masked", ["1"]), ("Names are masked", ["1", "2"]), ("Other ticket", ["1", "3"])])

    def test_scenario_level_issue_tag_only(self):
        self.assertEqual(evidence_table.parse_feature(OTHER_FEATURE, 7), [("Scenario-level tags only", ["3"])])
        self.assertEqual(evidence_table.parse_feature(OTHER_FEATURE, 9), [])


class VitestParsing(unittest.TestCase):
    def test_titles_with_ac_tags(self):
        found = evidence_table.parse_vitest_source(VITEST, 7)
        self.assertEqual(found, [("drops IBAN @ac-1", ["1"]), ("keeps the sentence @ac-2 @ac-3", ["2", "3"])])

    def test_other_issue_ignored(self):
        self.assertEqual(evidence_table.parse_vitest_source(VITEST, 8), [])

    def test_vitest_status(self):
        report = {"testResults": [{"assertionResults": [
            {"title": "drops IBAN @ac-1", "fullName": "masking drops IBAN @ac-1", "status": "passed"},
            {"title": "keeps the sentence @ac-2 @ac-3", "fullName": "masking keeps the sentence @ac-2 @ac-3", "status": "failed"}]}]}
        self.assertEqual(evidence_table.vitest_status([report], "drops IBAN @ac-1"), "grün")
        self.assertEqual(evidence_table.vitest_status([report], "keeps the sentence @ac-2 @ac-3"), "rot")
        self.assertEqual(evidence_table.vitest_status([report], "never ran"), "")


class CucumberStatus(unittest.TestCase):
    def test_all_passed_is_green_else_red(self):
        report = [{"uri": "tests/acceptance/m.feature", "elements": [
            {"type": "scenario", "name": "A", "steps": [{"result": {"status": "passed"}}, {"result": {"status": "passed"}}]},
            {"type": "scenario", "name": "B", "steps": [{"result": {"status": "passed"}}, {"result": {"status": "failed"}}]},
            {"type": "scenario", "name": "C", "steps": [{"result": {"status": "skipped"}}]},
            {"type": "background", "name": "", "steps": [{"result": {"status": "failed"}}]}]}]
        self.assertEqual(evidence_table.cucumber_status([report]), {"A": "grün", "B": "rot", "C": "rot"})

    def test_outline_examples_aggregate(self):
        report = [{"elements": [{"name": "O", "steps": [{"result": {"status": "passed"}}]},
                                {"name": "O", "steps": [{"result": {"status": "failed"}}]}]}]
        self.assertEqual(evidence_table.cucumber_status([report]), {"O": "rot"})


class StageFromPath(unittest.TestCase):
    def test_stages(self):
        P = pathlib.PurePath
        self.assertEqual(evidence_table.stage_of(P("tests/acceptance/x.feature")), "Abnahme")
        self.assertEqual(evidence_table.stage_of(P("tests/api/x.feature")), "3")
        self.assertEqual(evidence_table.stage_of(P("tests/e2e/x.feature")), "4")
        self.assertEqual(evidence_table.stage_of(P("apps/web/x.feature")), "2b")
        self.assertEqual(evidence_table.stage_of(P("packages/mask/x.feature")), "2a")

    def test_skipped_dirs(self):
        P = pathlib.PurePath
        self.assertTrue(evidence_table.skipped(P("node_modules/x/y.feature")))
        self.assertTrue(evidence_table.skipped(P("tests/acceptance/reports/old.feature")))
        self.assertFalse(evidence_table.skipped(P("tests/acceptance/m.feature")))


class AcParsing(unittest.TestCase):
    def test_numbered_ac_and_checkbox_forms(self):
        body = "# T\n\n## Acceptance criteria\n1. first\n- [ ] AC2: second\nAC3 third\n\n## Notes\n1. not an AC\n"
        self.assertEqual(evidence_table.parse_acs(body), ["1", "2", "3"])
        self.assertEqual(evidence_table.parse_acs("## Akzeptanzkriterien\n- [x] AC1: x\n"), ["1"])


class Build(unittest.TestCase):
    def test_full_join(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tests/acceptance/masking.feature", FEATURE)
            write(root, "packages/mask/src/mask.test.ts", VITEST)
            write(root, "node_modules/x/skip.feature", OTHER_FEATURE)
            cuke = [{"elements": [{"name": "IBAN is masked", "steps": [{"result": {"status": "passed"}}]},
                                  {"name": "Names are masked", "steps": [{"result": {"status": "failed"}}]}]}]
            vit = {"testResults": [{"assertionResults": [{"title": "drops IBAN @ac-1", "fullName": "masking drops IBAN @ac-1", "status": "passed"}]}]}
            verdicts = {"real": [{"title": "IBAN is masked", "verdict": "passt"}, {"title": "Names are masked", "verdict": "unklar"}],
                        "canaryCaught": False, "judgeValid": False}
            md = evidence_table.build(7, root, [cuke], [vit], verdicts, {"Abnahme": "https://r/abn", "1": "https://r/unit"},
                                      "## Acceptance criteria\n1. a\n2. b\n3. c\n4. d\n", today="2026-10-21")
        self.assertEqual(md.splitlines()[0], "### Belege zu #7 (2026-10-21 UTC)")
        self.assertIn("| AC | Tests (Stufe · Name) | Letzter Lauf | Richter | Bericht |", md)
        self.assertEqual(rows(md), [
            ["AC1", "1 · drops IBAN @ac-1", "grün", "", "[Bericht](https://r/unit)"],
            ["AC1", "Abnahme · IBAN is masked", "grün", "passt", "[Bericht](https://r/abn)"],
            ["AC1", "Abnahme · Names are masked", "rot", "unklar", "[Bericht](https://r/abn)"],
            ["AC1", "Abnahme · Other ticket", "", "", "[Bericht](https://r/abn)"],
            ["AC2", "1 · keeps the sentence @ac-2 @ac-3", "", "", "[Bericht](https://r/unit)"],
            ["AC2", "Abnahme · Names are masked", "rot", "unklar", "[Bericht](https://r/abn)"],
            ["AC3", "1 · keeps the sentence @ac-2 @ac-3", "", "", "[Bericht](https://r/unit)"],
            ["AC3", "Abnahme · Other ticket", "", "", "[Bericht](https://r/abn)"],
            ["AC4", "ohne Test", "", "", ""]])
        self.assertIn("Erzeugt von tools/evidence_table.py; nie von Hand pflegen.", md)
        self.assertTrue(md.endswith("Richterlauf ungültig (Kanarienvogel nicht erkannt)."))

    def test_missing_inputs_give_empty_cells(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tests/api/x.feature", OTHER_FEATURE)
            md = evidence_table.build(7, root, today="2026-10-21")
        self.assertEqual(rows(md), [["AC3", "3 · Scenario-level tags only", "", "", ""]])
        self.assertNotIn("Richterlauf ungültig", md)

    def test_empty_repo_and_no_acs(self):
        with tempfile.TemporaryDirectory() as tmp:
            md = evidence_table.build(7, pathlib.Path(tmp), today="2026-10-21")
        self.assertEqual(rows(md), [])
        self.assertIn("nie von Hand pflegen", md)

    def test_cases_key_and_valid_judge(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tests/acceptance/x.feature", OTHER_FEATURE)
            md = evidence_table.build(7, root, verdicts={"cases": [{"title": "Scenario-level tags only", "verdict": "passt nicht"}], "judgeValid": True})
        self.assertEqual(rows(md)[0][3], "passt nicht")
        self.assertNotIn("Richterlauf ungültig", md)


class Main(unittest.TestCase):
    def test_main_reads_files(self):
        import io, json, contextlib
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tests/acceptance/x.feature", OTHER_FEATURE)
            write(root, "v.json", json.dumps({"real": [{"title": "Scenario-level tags only", "verdict": "passt"}], "judgeValid": True}))
            write(root, "ac.md", "## Akzeptanzkriterien\n1. a\n2. b\n3. c\n")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                rc = evidence_table.main(["--issue", "7", "--root", tmp, "--verdicts", str(root / "v.json"), "--ac", str(root / "ac.md"), "--report", "Abnahme=https://r"])
        self.assertEqual(rc, 0)
        self.assertEqual(rows(out.getvalue()), [["AC1", "ohne Test", "", "", ""], ["AC2", "ohne Test", "", "", ""],
                                                ["AC3", "Abnahme · Scenario-level tags only", "", "passt", "[Bericht](https://r)"]])

    def test_missing_issue_is_usage_error(self):
        import io, contextlib
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(evidence_table.main([]), 2)
