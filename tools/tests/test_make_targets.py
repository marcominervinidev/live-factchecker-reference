"""Issue #26 (T1b), Task 2, AC8 to AC10: the retry setting of the stage-3 and stage-4 targets and the owner stack
targets in the Makefile.

- AC8: `make test-api` refuses a RETRIES other than 0 or 1 before any scenario runs, with a message naming the
  allowed values; no report is written. Valid classes (AC5, AC7): RETRIES 1, 0, empty or unset (empty and unset
  mean the default 0, critic W9 of the #26 test design) is not refused and the stage-3 client starts. Retry and
  flaky list themselves are shown in scripts/ci/flaky.test.ts; the wiring through a real Cucumber run is proven
  once in the PR of Task 2 (owner decision Q2, gate 1 of #26).
- AC9: `make test-e2e` validates RETRIES the same way and otherwise stays the no-op of T1, writing no flaky list.
- AC10: `up`, `dev`, `down`, `stop`, `restart`, `secrets-init` each have one line in `make help`; the dry runs
  (`make -n <target>`) of `up`, `dev`, `down`, `stop`, `restart` exit 0. The `secrets-init` dry run is the owner's
  (ticket #26, Assumptions: the hook guard-secrets denies it to agents); it is an owner case in
  tests/acceptance/owner/26/owner-stack.feature.

Every case runs make in a throwaway copy (Makefile, *.mk, .nvmrc, scripts/, compose*.yml) under the system temp
directory, with a `docker` stub first on PATH: it records each call, prints a dummy PEM for `compose exec` (the
edge root CA) and exits 0 for everything else, so a target that does not refuse runs through as if its tests
passed. The real Docker, the owner's stack and the secrets directory are never touched; LFC_SECRETS_DIR (the one
name, owner decision Q6) points into the throwaway copy and SECRETS_DIR is removed from the environment. RETRIES is
passed in the environment, as stack-tests.yml does. The exit code of a valid test-api run is not asserted: what
follows the client (the flaky list from its messages report) cannot run against the stub.
Stdlib only. Run: python3 -I -m unittest discover -s tools/tests -p test_make_targets.py
"""
import os, pathlib, re, shutil, stat, subprocess, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TMP = pathlib.Path(tempfile.gettempdir()).resolve()
OWNER_TARGETS = ["up", "dev", "down", "stop", "restart", "secrets-init"]
DRY_RUN_TARGETS = ["up", "dev", "down", "stop", "restart"]
# Source: ticket #26 AC8 ("other than 0 or 1"); one invalid class per row. Valid: unset and empty mean the default.
VALID_RETRIES = [None, "", "0", "1"]
INVALID_RETRIES = {
    "above the range": "2",
    "below the range": "-1",
    "not a number": "yes",
    "not an integer": "0.5",
}
ALLOWED_0 = re.compile(r"(?<![\d.-])0(?![\d.])")
ALLOWED_1 = re.compile(r"(?<![\d.-])1(?![\d.])")
DOCKER_STUB = """#!/bin/sh
printf '%s\\n' "$*" >> "$LFC_TEST_DOCKER_LOG"
case "$*" in
  *compose*exec*) printf -- '-----BEGIN CERTIFICATE-----\\nTUZD\\n-----END CERTIFICATE-----\\n' ;;
esac
exit 0
"""


class MakeTargets(unittest.TestCase):
    def setUp(self):
        self.work = pathlib.Path(tempfile.mkdtemp(prefix="lfc-26-make-")).resolve()
        self.addCleanup(shutil.rmtree, self.work, True)
        if TMP not in self.work.parents or ROOT in self.work.parents:
            self.fail(f"refusing to run make outside a throwaway directory: {self.work}")
        for name in ["Makefile", ".nvmrc", *[p.name for p in [*ROOT.glob("compose*.yml"), *ROOT.glob("*.mk")]]]:
            shutil.copy2(ROOT / name, self.work / name)
        shutil.copytree(ROOT / "scripts", self.work / "scripts", ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
        bin_dir = self.work / ".stub-bin"
        bin_dir.mkdir()
        docker = bin_dir / "docker"
        docker.write_text(DOCKER_STUB, encoding="utf-8")
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        self.docker_log = self.work / ".docker-calls.log"
        self.docker_log.touch()
        secrets = self.work / ".stub-secrets"
        secrets.mkdir(mode=0o700)
        env = {k: v for k, v in os.environ.items() if k not in ("RETRIES", "MAKEFLAGS", "MAKELEVEL", "COMPOSE_PROJECT_NAME",
                                                             "SECRETS_DIR", "LFC_SECRETS_DIR")}
        env.update({
            "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
            "LFC_TEST_DOCKER_LOG": str(self.docker_log),
            "LFC_SECRETS_DIR": str(secrets),
        })
        self.env = env

    # helpers -------------------------------------------------------------------------------------------------
    def make(self, *args, retries=None, project=None):
        env = dict(self.env)
        if retries is not None:
            env["RETRIES"] = retries
        if project is not None:
            env["COMPOSE_PROJECT_NAME"] = project
        return subprocess.run(["make", "--no-print-directory", "-C", str(self.work), *args], env=env,
                              capture_output=True, text=True, timeout=60)

    def docker_calls(self):
        return [line for line in self.docker_log.read_text(encoding="utf-8").splitlines() if line]

    def report_files(self, stage):
        reports = self.work / "tests" / stage / "reports"
        return sorted(str(p.relative_to(self.work)) for p in reports.rglob("*") if p.is_file()) if reports.exists() else []

    def assert_refused(self, result, value):
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, f"RETRIES={value!r} was accepted:\n{output}")
        # One line names the setting and both allowed values; make's own "Error 1" line does not count.
        naming = [line for line in output.splitlines()
                  if "RETRIES" in line and ALLOWED_0.search(line) and ALLOWED_1.search(line)]
        self.assertTrue(naming, f"no line names RETRIES with the allowed values 0 and 1:\n{output}")

    # AC8 -----------------------------------------------------------------------------------------------------
    def test_test_api_refuses_an_invalid_retry_setting_before_any_scenario_runs(self):
        for invalid_class, value in INVALID_RETRIES.items():
            with self.subTest(invalid_class, RETRIES=value):
                self.docker_log.write_text("", encoding="utf-8")
                result = self.make("test-api", retries=value, project="lfc-td-make")
                self.assert_refused(result, value)
                started = [c for c in self.docker_calls() if re.search(r"\brun\b", c) or "stack-client" in c]
                self.assertEqual(started, [], "no stack client (no scenario) may start")
                self.assertEqual(self.report_files("api"), [], "no report may be written")

    def test_test_api_starts_the_stage_3_run_for_a_valid_retry_setting(self):
        # Valid classes of AC5 and AC7 (RETRIES 1, 0, empty, unset): not refused, the stack client starts. Also the control
        # that the docker stub of this harness is reached, so the refusal case above is not vacuous.
        for value in VALID_RETRIES:
            with self.subTest(RETRIES=value):
                self.docker_log.write_text("", encoding="utf-8")
                result = self.make("test-api", retries=value, project="lfc-td-make")
                clients = [c for c in self.docker_calls() if re.search(r"\brun\b", c) and "stack-client" in c]
                self.assertTrue(clients, f"no stack client started:\n{result.stdout}{result.stderr}")

    # AC9 -----------------------------------------------------------------------------------------------------
    def test_test_e2e_refuses_an_invalid_retry_setting_and_writes_no_report(self):
        for invalid_class, value in INVALID_RETRIES.items():
            with self.subTest(invalid_class, RETRIES=value):
                result = self.make("test-e2e", retries=value)
                self.assert_refused(result, value)
                self.assertEqual(self.report_files("e2e"), [])

    def test_test_e2e_stays_a_no_op_without_a_flaky_list_for_a_valid_retry_setting(self):
        for value in VALID_RETRIES:
            with self.subTest(RETRIES=value):
                result = self.make("test-e2e", retries=value)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertFalse((self.work / "tests" / "e2e").exists(), "the no-op creates no stage-4 directory")
                self.assertEqual(self.docker_calls(), [])

    # AC10 ----------------------------------------------------------------------------------------------------
    def test_make_help_has_exactly_one_line_per_owner_stack_target(self):
        result = self.make("help")
        self.assertEqual(result.returncode, 0, result.stderr)
        for target in OWNER_TARGETS:
            with self.subTest(target=target):
                lines = [l for l in result.stdout.splitlines() if re.match(rf"^\s*{re.escape(target)}\s", l)]
                self.assertEqual(len(lines), 1, f"make help lines for {target}: {lines}")
                self.assertTrue(lines[0].split(None, 1)[1:], f"{target} has no description in make help")

    def test_dry_run_of_each_owner_stack_target_exits_0(self):
        for target in DRY_RUN_TARGETS:
            with self.subTest(target=target):
                result = self.make("-n", target)
                self.assertEqual(result.returncode, 0, f"make -n {target}:\n{result.stdout}{result.stderr}")


if __name__ == "__main__":
    unittest.main()
