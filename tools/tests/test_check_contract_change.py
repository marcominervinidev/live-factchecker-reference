"""Issue #25 (T1), AC12: scripts/check-contract-change.sh, the contract check `pr.yml` runs as
`scripts/check-contract-change.sh origin/<base>`.

A change under packages/contracts passes only when it meets .claude/rules/contracts.md: its own commit, an ADR
reference, a higher schemaVersion, contract tests; a change set that does not touch packages/contracts passes.
The scenarios port the six of live-factcheck (scripts/ci/contract-check-scenarios.sh: A untouched, B no ADR and no
bump, C ADR without bump, D ADR with bump, E shared building block without bump, F test only) and add one case per
v2 rule; every failing scenario breaks exactly one rule of an otherwise valid change.

Each scenario builds a throwaway git repository under the system temp directory; the repository under test is never
written. Stdlib only. Run: python3 -I -m unittest discover -s tools/tests -p test_check_contract_change.py
The script must run under the bash on PATH of the CI runner and the toolbox (Linux); on a macOS host /bin/bash is 3.2.
"""
import os, pathlib, shutil, subprocess, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "check-contract-change.sh"
TMP = pathlib.Path(tempfile.gettempdir()).resolve()

# schemaVersion notation as in live-factcheck (zod literal); the first v2 contract comes with T2 (open question).
SCHEMA = """import {{ z }} from 'zod';
import {{ SpeakerLabel }} from './common.ts';

export const Segment = z.strictObject({{
  schemaVersion: z.literal({version}),
  speaker: SpeakerLabel,
  text: z.string().max({max_text}),
}});
"""
COMMON = "import {{ z }} from 'zod';\n\nexport const SpeakerLabel = z.string().max({max_label});\n"
TEST = "import {{ describe, it }} from 'vitest';\n\ndescribe('Segment', () => {{\n  it('{title}', () => {{}});\n}});\n"
GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "scenario", "GIT_AUTHOR_EMAIL": "scenario@example.invalid",
    "GIT_COMMITTER_NAME": "scenario", "GIT_COMMITTER_EMAIL": "scenario@example.invalid",
    "GIT_AUTHOR_DATE": "2026-10-27T12:00:00Z", "GIT_COMMITTER_DATE": "2026-10-27T12:00:00Z",
}


class ContractCheck(unittest.TestCase):
    def setUp(self):
        self.repo = pathlib.Path(tempfile.mkdtemp(prefix="lfc-25-contract-check-")).resolve()
        self.addCleanup(shutil.rmtree, self.repo, True)
        # Directory check before any git write (CLAUDE.md, Git): only a fresh directory under the temp dir.
        if TMP not in self.repo.parents or self.repo == ROOT or ROOT in self.repo.parents:
            self.fail(f"refusing to write git state outside a throwaway directory: {self.repo}")
        self.env = {**os.environ, **GIT_ENV}
        self.git("init", "-q", "-b", "main")
        self.write("packages/contracts/src/segment.ts", SCHEMA.format(version=2, max_text=2000))
        self.write("packages/contracts/src/common.ts", COMMON.format(max_label=64))
        self.write("packages/contracts/src/segment.test.ts", TEST.format(title="parses the fixture"))
        self.write("packages/contracts/src/index.ts", "export * from './segment.ts';\n")
        self.write("docs/adr/0005-segment-contract.md", "# 0005: segment contract\n")
        self.write("services/detection/src/main.ts", "export const service = 'detection';\n")
        self.write("README.md", "# live-factchecker-v2\n")
        self.commit("chore(repo): base")
        self.git("tag", "base")

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

    def check(self):
        """Exit code and output of the script under test, run against the tag `base` inside the scenario repo."""
        self.assertTrue(SCRIPT.is_file(), f"{SCRIPT.relative_to(ROOT)} is missing")
        self.assertTrue(os.access(SCRIPT, os.X_OK), f"{SCRIPT.relative_to(ROOT)} is not executable (pr.yml runs it directly)")
        done = subprocess.run([str(SCRIPT), "base"], cwd=self.repo, env=self.env, capture_output=True, text=True, timeout=60)
        return done.returncode, done.stdout + done.stderr

    def assertPasses(self):
        code, out = self.check()
        self.assertEqual(code, 0, out)

    def assertFails(self):
        code, out = self.check()
        self.assertNotEqual(code, 0, out)

    # building blocks of a valid contract change -----------------------------------------------------------
    def adr(self):
        """The ADR in a commit of its own, before the contract commit."""
        self.write("docs/adr/0012-segment-text-limit.md", "# 0012: segment text limit 4000\n")
        self.commit("docs(adr): ADR 0012 segment text limit")

    def contract_commit(self, *, version=3, test=True, adr_reference=True, extra=None):
        self.write("packages/contracts/src/segment.ts", SCHEMA.format(version=version, max_text=4000))
        if test:
            self.write("packages/contracts/src/segment.test.ts", TEST.format(title="refuses a text over 4000 characters"))
        if extra:
            self.write(extra, "export const service = 'detection-changed';\n")
        reference = " (ADR 0012)" if adr_reference else ""
        self.commit(f"feat(contracts)!: segment text limit 4000, schemaVersion {version}{reference}")

    # passing scenarios ------------------------------------------------------------------------------------
    def test_passes_a_change_set_that_does_not_touch_contracts(self):  # live-factcheck A
        self.write("services/detection/src/main.ts", "export const service = 'detection-v2';\n")
        self.write("docs/process/notes.md", "notes\n")
        self.commit("feat(detection): rename")
        self.assertPasses()

    def test_passes_a_contract_change_that_meets_every_rule(self):  # live-factcheck D, plus own commit and tests
        self.adr()
        self.contract_commit()
        self.assertPasses()

    def test_passes_a_change_of_contract_tests_only(self):  # live-factcheck F
        self.write("packages/contracts/src/segment.test.ts", TEST.format(title="parses the fixture again"))
        self.commit("test(contracts): clearer test name")
        self.assertPasses()

    # failing scenarios: exactly one rule broken ----------------------------------------------------------
    def test_fails_without_an_adr(self):  # live-factcheck B (here with bump and tests, so only the ADR is missing)
        self.contract_commit(adr_reference=False)
        self.assertFails()

    def test_fails_when_schema_version_stays_the_same(self):  # live-factcheck C; boundary: equal is not higher
        self.adr()
        self.contract_commit(version=2)
        self.assertFails()

    def test_fails_when_schema_version_goes_down(self):  # boundary: lower is not higher
        self.adr()
        self.contract_commit(version=1)
        self.assertFails()

    def test_fails_without_a_contract_test_change(self):
        self.adr()
        self.contract_commit(test=False)
        self.assertFails()

    def test_fails_when_the_contract_change_shares_its_commit_with_other_code(self):
        self.adr()
        self.contract_commit(extra="services/detection/src/main.ts")
        self.assertFails()

    def test_fails_when_a_shared_building_block_changes_without_any_schema_version_bump(self):  # live-factcheck E
        self.adr()
        self.write("packages/contracts/src/common.ts", COMMON.format(max_label=80))
        self.write("packages/contracts/src/segment.test.ts", TEST.format(title="accepts a label of 80 characters"))
        self.commit("feat(contracts): speaker label up to 80 characters (ADR 0012)")
        self.assertFails()


if __name__ == "__main__":
    unittest.main()
