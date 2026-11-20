"""Tests for the evaluation of the Semgrep JSON report (#187). Run: python3 -I -m unittest discover -s tools/tests

Ticket #187 („Semgrep: a rule timeout in scope fails the Semgrep check of `make ci-local`“), owner decision G9 of
2026-11-06 and the gate-1 answers of 2026-11-18 („Bugs alle wie empfohlen“): every Semgrep timeout fails except on
`evals/golden/*/korrektur.html`; every other Semgrep error on a path in scope (a parse error, too) and every error
without a path (a rule pack that does not load) fails as well; a missing or broken report fails; the output names
the file and, where the report gives one, the rule. The GitHub PR job is a separate ticket.

The tool under test is `tools/check_semgrep_report.py` (stdlib, `python3 -I`), run as a subprocess the way
`scripts/ci/local.sh` will run it: `python3 -I tools/check_semgrep_report.py --semgrep-exit <code> <report.json>`.
Exit 0 is a pass, any other code a failure.

Fixtures (tools/tests/fixtures/semgrep/) are cut from REAL reports of Semgrep 1.178.0 (pip wheel 1.178.0 in the
toolbox, test designer, 2026-11-18); cut means only the machine-dependent key `time` was removed:
- timeouts-1.178.0.json: the planted run of the ticket on an export of week/2026-w47 32ac8ec0 with the five packs of
  `scripts/ci/local.sh:115-117` and an extra `--timeout 1`; Semgrep exit 0, 877 files, 0 findings, 20 errors, all
  `Timeout` (level warn) with `rule_id`: 19 on `evals/golden/*/korrektur.html`, 1 on
  `services/detection/src/claim-extractor/prompt.test.ts` (rule `ajinabraham.njsscan.ssrf.ssrf_node.node_ssrf`).
- parse-error-1.178.0.json: a broken TypeScript file outside the repository with a one-rule local config; Semgrep
  exit 0, one error of type `["PartialParsing", [<spans>]]` (a list, not a string) whose message holds the source.
- pack-not-loading-1.178.0.json: `--config p/typescript --config p/no-such-pack-lfc-187`; Semgrep exit 7, two errors
  of type `SemgrepError` without a path.
- finding-1.178.0.json: a Dockerfile without USER outside the repository, `--config p/dockerfile`; Semgrep exit 1,
  one finding `dockerfile.security.missing-user.missing-user` whose `extra.fix` holds the matched line.
- clean-1.178.0.json: `--config p/typescript --config p/dockerfile` on two files; Semgrep exit 0, nothing found.
Variants marked „derived“ below are built in the test from a real error entry (path or rule_id changed, an entry
duplicated); no real report showed two timeouts on one file or a timeout without `rule_id`.

Names and formats decided by the test designer under P1 (report .owner-pakete/refine-w47/td187-bericht.md):
- the option `--semgrep-exit <code>` and the positional report path;
- one line per error that holds its type (for a list type: its first element), its path and its rule;
- the summary line „<n> files, <f> finding(s), <i> error(s) in scope (<t> timeout(s)), <o> error(s) out of scope
  (<u> timeout(s))“, the extension of today's „878 files, 0 finding(s), 19 error(s)“;
- `*` in the exempt glob is one path segment, the glob is anchored at both ends and case-sensitive; a bad report is
  named by its path; a missing or non-integer `--semgrep-exit` fails and the message names the option;
- the exemption applies to errors only, never to findings.
Round 2 (2026-11-18) adds the critic's A1, A2 and W1, W2 of .owner-pakete/refine-w47/critic-td186-187.md.
"""
import json, pathlib, re, subprocess, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TOOL = ROOT / "tools" / "check_semgrep_report.py"
FIXTURES = HERE / "fixtures" / "semgrep"

SUMMARY = re.compile(r"^(\d+) files, (\d+) finding\(s\), (\d+) error\(s\) in scope \((\d+) timeout\(s\)\), "
                     r"(\d+) error\(s\) out of scope \((\d+) timeout\(s\)\)$", re.M)
IN_SCOPE_PATH = "services/detection/src/claim-extractor/prompt.test.ts"
IN_SCOPE_RULE = "ajinabraham.njsscan.ssrf.ssrf_node.node_ssrf"
GOLDEN_RULE = "generic.secrets.security.detected-username-and-password-in-uri.detected-username-and-password-in-uri"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def golden_only():
    """The real timeouts report without its one timeout in scope (19 timeouts on the Golden Set pages)."""
    r = fixture("timeouts-1.178.0.json")
    r["errors"] = [e for e in r["errors"] if e["path"] != IN_SCOPE_PATH]
    return r


def in_scope_timeout():
    """The real timeout entry in scope, as Semgrep 1.178.0 wrote it."""
    return next(e for e in fixture("timeouts-1.178.0.json")["errors"] if e["path"] == IN_SCOPE_PATH)


class Tool(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lfc-187-")
        self.addCleanup(self.tmp.cleanup)

    def write(self, report, name="semgrep.json"):
        path = pathlib.Path(self.tmp.name) / name
        path.write_text(report if isinstance(report, str) else json.dumps(report), encoding="utf-8")
        return path

    def run_tool(self, report, semgrep_exit=0, exit_args=None):
        """report: a dict or str written to a file, or a pathlib.Path used as it is. exit_args replaces
        ["--semgrep-exit", <semgrep_exit>] (critic round 1, A2: the option missing or empty)."""
        path = report if isinstance(report, pathlib.Path) else self.write(report)
        args = ["--semgrep-exit", str(semgrep_exit)] if exit_args is None else exit_args
        p = subprocess.run([sys.executable, "-I", str(TOOL), *args, str(path)],
                           cwd=ROOT, capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
        return p.returncode, p.stdout + p.stderr, path

    def summary(self, out):
        found = SUMMARY.findall(out)
        self.assertEqual(len(found), 1, f"exactly one summary line, got:\n{out}")
        return tuple(int(x) for x in found[0])

    def assert_error_line(self, out, *words):
        lines = [ln for ln in out.splitlines() if all(w in ln for w in words)]
        self.assertTrue(lines, f"one line naming {words}, got:\n{out}")

    def assert_fails(self, code, out):
        self.assertNotEqual(code, 0, f"the check fails, got exit 0:\n{out}")
        self.assertNotIn("Traceback", out, "a clear message, not a crash")


class ErrorInScopeFails(Tool):
    """AC1: an error in scope fails the check; the output names type, path and rule (where given)."""

    def test_the_real_timeout_on_a_service_file_fails_and_names_path_and_rule(self):
        code, out, _ = self.run_tool(fixture("timeouts-1.178.0.json"), semgrep_exit=0)
        self.assert_fails(code, out)
        self.assert_error_line(out, "Timeout", IN_SCOPE_PATH, IN_SCOPE_RULE)

    def test_a_timeout_fails_on_every_path_except_the_golden_set_pages(self):
        # owner 2026-11-18 (question 1 as recommended): every file except evals/golden/*/korrektur.html; derived
        for path in (".github/workflows/pr.yml", "Dockerfile", "services/detection/Dockerfile", "scripts/ci/local.sh",
                     "packages/contracts/src/claim-event.ts", "apps/web/src/main.ts", "evals/src/harness/pipeline.py",
                     "tools/check_semgrep_report.py", "evals/golden/beispiel-a/index.html",
                     "evals/golden/beispiel-a/korrektur.htm", "evals/golden/beispiel-a/korrektur.html.orig",
                     "evals/golden/beispiel-a/sub/korrektur.html", "evals/golden-alt/beispiel-a/korrektur.html",
                     "evals/golden/korrektur.html", "services/detection/korrektur.html",
                     # critic round 1, W1: the glob is anchored at both ends and case-sensitive
                     "apps/web/evals/golden/beispiel-a/korrektur.html", "x/evals/golden/beispiel-a/korrektur.html",
                     "Evals/Golden/beispiel-a/korrektur.html", "evals/golden/beispiel-a/KORREKTUR.html"):
            with self.subTest(path=path):
                r = golden_only()
                r["errors"].append(dict(in_scope_timeout(), path=path))
                code, out, _ = self.run_tool(r)
                self.assert_fails(code, out)
                self.assert_error_line(out, "Timeout", path, IN_SCOPE_RULE)

    def test_the_real_parse_error_fails_and_names_its_type_and_path(self):
        # owner 2026-11-18 (question 3 as recommended): other Semgrep errors on a path in scope fail as well
        code, out, _ = self.run_tool(fixture("parse-error-1.178.0.json"), semgrep_exit=0)
        self.assert_fails(code, out)
        self.assert_error_line(out, "PartialParsing", "src/broken.ts")

    def test_a_rule_pack_that_does_not_load_fails_by_the_report_alone(self):
        # errors without a path are in scope (question 3); Semgrep's own exit 7 is not needed for red
        for semgrep_exit in (7, 0):
            with self.subTest(semgrep_exit=semgrep_exit):
                code, out, _ = self.run_tool(fixture("pack-not-loading-1.178.0.json"), semgrep_exit=semgrep_exit)
                self.assert_fails(code, out)
                self.assert_error_line(out, "SemgrepError")

    def test_two_timeouts_on_one_file_name_both_rules(self):
        # derived: the real entry twice, the second with the rule of the Golden Set timeouts
        r = golden_only()
        r["errors"] += [in_scope_timeout(), dict(in_scope_timeout(), rule_id=GOLDEN_RULE)]
        code, out, _ = self.run_tool(r)
        self.assert_fails(code, out)
        self.assert_error_line(out, "Timeout", IN_SCOPE_PATH, IN_SCOPE_RULE)
        self.assert_error_line(out, "Timeout", IN_SCOPE_PATH, GOLDEN_RULE)
        self.assertEqual(self.summary(out)[2:4], (2, 2))

    def test_a_timeout_without_rule_still_fails_and_names_the_path(self):
        # derived: „the rule where the report gives one“
        r = golden_only()
        entry = in_scope_timeout()
        del entry["rule_id"]
        r["errors"].append(entry)
        code, out, _ = self.run_tool(r)
        self.assert_fails(code, out)
        self.assert_error_line(out, "Timeout", IN_SCOPE_PATH)


class SummaryCountsSeparately(Tool):
    """AC2: findings, errors in scope and errors out of scope counted separately, timeouts on their own in both."""

    def test_real_timeouts_report(self):
        _, out, _ = self.run_tool(fixture("timeouts-1.178.0.json"))
        self.assertEqual(self.summary(out), (877, 0, 1, 1, 19, 19))

    def test_golden_set_timeouts_only(self):
        _, out, _ = self.run_tool(golden_only())
        self.assertEqual(self.summary(out), (877, 0, 0, 0, 19, 19))

    def test_real_parse_error_is_an_error_in_scope_but_no_timeout(self):
        _, out, _ = self.run_tool(fixture("parse-error-1.178.0.json"))
        self.assertEqual(self.summary(out), (1, 0, 1, 0, 0, 0))

    def test_real_pack_errors_without_path_are_in_scope(self):
        _, out, _ = self.run_tool(fixture("pack-not-loading-1.178.0.json"), semgrep_exit=7)
        self.assertEqual(self.summary(out), (0, 0, 2, 0, 0, 0))

    def test_timeouts_and_a_parse_error_together(self):
        # derived: the real timeouts report plus the real parse error entry
        r = fixture("timeouts-1.178.0.json")
        r["errors"] += fixture("parse-error-1.178.0.json")["errors"]
        _, out, _ = self.run_tool(r)
        self.assertEqual(self.summary(out), (877, 0, 2, 1, 19, 19))

    def test_a_parse_error_on_a_golden_set_page_is_out_of_scope(self):
        # derived: the exemption is per path, for every error type
        r = golden_only()
        r["errors"].append(dict(fixture("parse-error-1.178.0.json")["errors"][0],
                                path="evals/golden/beispiel-a/korrektur.html"))
        code, out, _ = self.run_tool(r)
        self.assertEqual(self.summary(out), (877, 0, 0, 0, 20, 19))
        self.assertEqual(code, 0, out)

    def test_real_finding(self):
        _, out, _ = self.run_tool(fixture("finding-1.178.0.json"), semgrep_exit=1)
        self.assertEqual(self.summary(out), (1, 1, 0, 0, 0, 0))


class WhatStaysGreen(Tool):
    """AC3 (negative): Golden Set timeouts do not change the exit code; clean passes; a finding fails as today."""

    def test_timeouts_on_the_golden_set_pages_only_pass(self):
        code, out, _ = self.run_tool(golden_only(), semgrep_exit=0)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.summary(out)[4:], (19, 19))
        # critic round 1, W2: errors out of scope are still printed (ticket: „prints findings and errors as
        # scripts/ci/local.sh:122-125 does today“), so the owner sees which pages timed out
        for e in golden_only()["errors"]:
            with self.subTest(path=e["path"]):
                self.assert_error_line(out, "Timeout", e["path"])

    def test_a_finding_on_a_golden_set_page_still_fails_and_is_counted(self):
        # critic round 1, A1 (derived): the exemption is for errors only; AC3 „A report with a finding fails as today“
        r = fixture("finding-1.178.0.json")
        r["results"][0]["path"] = "evals/golden/beispiel-a/korrektur.html"
        for semgrep_exit in (1, 0):
            with self.subTest(semgrep_exit=semgrep_exit):
                code, out, _ = self.run_tool(r, semgrep_exit=semgrep_exit)
                self.assert_fails(code, out)
                self.assert_error_line(out, "dockerfile.security.missing-user.missing-user",
                                       "evals/golden/beispiel-a/korrektur.html:2")
                self.assertEqual(self.summary(out)[1], 1, "the finding is counted")

    def test_a_clean_report_passes(self):
        code, out, _ = self.run_tool(fixture("clean-1.178.0.json"), semgrep_exit=0)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.summary(out), (2, 0, 0, 0, 0, 0))

    def test_a_finding_fails_and_is_printed_with_rule_path_and_line(self):
        for semgrep_exit in (1, 0):
            with self.subTest(semgrep_exit=semgrep_exit):
                code, out, _ = self.run_tool(fixture("finding-1.178.0.json"), semgrep_exit=semgrep_exit)
                self.assert_fails(code, out)
                self.assert_error_line(out, "dockerfile.security.missing-user.missing-user", "Dockerfile:2")


class BadReportFails(Tool):
    """AC4 (negative): a missing, empty or unreadable report fails; a non-zero Semgrep exit never becomes a pass."""

    def test_a_missing_report_fails_and_is_named(self):
        path = pathlib.Path(self.tmp.name) / "absent" / "semgrep.json"
        code, out, _ = self.run_tool(path)
        self.assert_fails(code, out)
        self.assertIn(str(path), out)

    def test_an_empty_or_unreadable_report_fails_and_is_named(self):
        truncated = (FIXTURES / "timeouts-1.178.0.json").read_text(encoding="utf-8")[:1000]
        for name, text in (("empty", ""), ("blank", "\n"), ("truncated", truncated), ("not json", "error: Timeout"),
                           ("a list", "[]"), ("an empty object", "{}"), ("no results", '{"version": "1.178.0", "errors": []}'),
                           ("no errors", '{"version": "1.178.0", "results": []}')):
            with self.subTest(report=name):
                code, out, path = self.run_tool(text)
                self.assert_fails(code, out)
                self.assertIn(str(path), out)

    def test_a_non_zero_semgrep_exit_fails_even_with_a_clean_report(self):
        for semgrep_exit in (1, 2, 7, 124):
            with self.subTest(semgrep_exit=semgrep_exit):
                code, out, _ = self.run_tool(fixture("clean-1.178.0.json"), semgrep_exit=semgrep_exit)
                self.assert_fails(code, out)
                self.assertEqual(self.summary(out), (2, 0, 0, 0, 0, 0), "the report is still evaluated")


    def test_a_missing_or_empty_semgrep_exit_never_passes(self):
        # critic round 1, A2: an empty $rc in scripts/ci/local.sh must not turn a Semgrep abort into a pass
        for name, args in (("missing", []), ("empty", ["--semgrep-exit", ""]), ("not a number", ["--semgrep-exit", "x"])):
            with self.subTest(semgrep_exit=name):
                code, out, _ = self.run_tool(fixture("clean-1.178.0.json"), exit_args=args)
                self.assert_fails(code, out)
                self.assertIn("--semgrep-exit", out, "the message names the option")


class NoSourceLinePrinted(Tool):
    """AC5 (negative): per finding only rule, path and line, per error only type, rule and path."""

    def test_the_parse_error_message_with_source_is_not_printed(self):
        code, out, _ = self.run_tool(fixture("parse-error-1.178.0.json"))
        self.assert_error_line(out, "PartialParsing", "src/broken.ts")
        for text in ("export const x", "function {", "was unexpected", "Syntax error", "offset"):
            with self.subTest(text=text):
                self.assertNotIn(text, out)

    def test_the_finding_fix_and_message_are_not_printed(self):
        _, out, _ = self.run_tool(fixture("finding-1.178.0.json"), semgrep_exit=1)
        self.assert_error_line(out, "dockerfile.security.missing-user.missing-user", "Dockerfile:2")
        for text in ('CMD ["sh"]', "USER non-root", "By not specifying a USER", "requires login"):
            with self.subTest(text=text):
                self.assertNotIn(text, out)

    def test_the_timeout_message_is_not_printed(self):
        _, out, _ = self.run_tool(fixture("timeouts-1.178.0.json"))
        self.assert_error_line(out, "Timeout", IN_SCOPE_PATH, IN_SCOPE_RULE)
        self.assertNotIn("Timeout when running", out)


if __name__ == "__main__":
    unittest.main()
