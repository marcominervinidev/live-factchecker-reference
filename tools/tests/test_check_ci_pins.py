"""Tests for tools/check_ci_pins.py (ticket #68, review round 2, A1). Run: python3 -I -m unittest discover -s tools/tests"""
import contextlib, io, pathlib, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import check_ci_pins  # noqa: E402

D1 = "1" * 64
D2 = "2" * 64
D3 = "3" * 64
CI = f"""env:
  GITLEAKS_VERSION: 8.30.1
jobs:
  a:
    steps:
      - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
        with:
          driver-opts: image=moby/buildkit:v0.33.1@sha256:{D1}
"""
PR = f"""jobs:
  semgrep:
    container:
      image: semgrep/semgrep:1.178.0@sha256:{D2}
  hadolint:
    steps:
      - run: docker run --rm -i hadolint/hadolint:v2.15.1@sha256:{D3} hadolint - < Dockerfile
"""
LOCAL = f"""#!/bin/sh
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1@sha256:{D1}
HADOLINT_IMAGE=hadolint/hadolint:v2.15.1@sha256:{D3}
SEMGREP_IMAGE=semgrep/semgrep:1.178.0@sha256:{D2}
"""


def repo(tmp, ci=CI, pr=PR, local=LOCAL):
    root = pathlib.Path(tmp)
    (root / ".github" / "workflows").mkdir(parents=True)
    (root / ".github" / "workflows" / "ci.yml").write_text(ci, encoding="utf-8")
    (root / ".github" / "workflows" / "pr.yml").write_text(pr, encoding="utf-8")
    if local is not None:
        (root / "scripts" / "ci").mkdir(parents=True)
        (root / "scripts" / "ci" / "local.sh").write_text(local, encoding="utf-8")
    return root


class CiPins(unittest.TestCase):
    def test_agreeing_pins_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(check_ci_pins.check(repo(tmp)), [])

    def test_two_digests_for_one_image_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            problems = check_ci_pins.check(repo(tmp, local=LOCAL.replace(f"v2.15.1@sha256:{D3}", f"v2.15.1@sha256:{D2}")))
            self.assertEqual(len(problems), 1)
            self.assertIn("hadolint/hadolint", problems[0])
            self.assertIn(".github/workflows/pr.yml", problems[0])
            self.assertIn("scripts/ci/local.sh", problems[0])

    def test_two_tags_for_one_image_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            problems = check_ci_pins.check(repo(tmp, local=LOCAL.replace("semgrep:1.178.0@", "semgrep:1.179.0@")))
            self.assertEqual(len(problems), 1)
            self.assertIn("semgrep/semgrep", problems[0])

    def test_unpinned_use_of_a_pinned_image_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            pr = PR + "      - run: docker run --rm hadolint/hadolint:v2.15.1 hadolint --version\n"
            problems = check_ci_pins.check(repo(tmp, pr=pr))
            self.assertEqual(len(problems), 1)
            self.assertIn("without a digest", problems[0])
            self.assertIn("hadolint/hadolint:v2.15.1", problems[0])

    def test_gitleaks_version_must_equal_the_image_tag(self):
        with tempfile.TemporaryDirectory() as tmp:
            problems = check_ci_pins.check(repo(tmp, ci=CI.replace("GITLEAKS_VERSION: 8.30.1", "GITLEAKS_VERSION: 8.31.0")))
            self.assertEqual(len(problems), 1)
            self.assertIn("GITLEAKS_VERSION 8.31.0", problems[0])
            self.assertIn("v8.30.1", problems[0])

    def test_gitleaks_version_without_image_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            local = "\n".join(l for l in LOCAL.splitlines() if "gitleaks" not in l) + "\n"
            problems = check_ci_pins.check(repo(tmp, local=local))
            self.assertEqual(len(problems), 1)
            self.assertIn("no gitleaks image", problems[0])

    def test_missing_ci_local_script_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            problems = check_ci_pins.check(repo(tmp, local=None))
            self.assertTrue(any("scripts/ci/local.sh missing" in p for p in problems), problems)

    def test_main_reports_and_exits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            out = io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(check_ci_pins.main(["--root", str(root)]), 0)
                (root / "scripts" / "ci" / "local.sh").write_text(LOCAL.replace(D3, D1), encoding="utf-8")
                self.assertEqual(check_ci_pins.main(["--root", str(root)]), 1)
            self.assertIn("ci pins ok", out.getvalue())
            self.assertIn("hadolint/hadolint: 2 different pins", out.getvalue())

    def test_docker_io_and_library_prefixes_name_the_same_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            pr = PR + f"      - run: docker run --rm docker.io/library/python:3.12.3-slim@sha256:{D1} python3 -V\n"
            local = LOCAL + f"PYTHON_IMAGE=python:3.12.3-slim@sha256:{D2}\n"
            local = local.replace("HADOLINT_IMAGE=hadolint/", "HADOLINT_IMAGE=docker.io/hadolint/")
            problems = check_ci_pins.check(repo(tmp, pr=pr, local=local))
            self.assertEqual(len(problems), 1, problems)
            self.assertTrue(problems[0].startswith("python: 2 different pins"), problems)

    def test_unpinned_reference_with_prefix_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            pr = PR + "      - run: docker run --rm docker.io/hadolint/hadolint:v2.15.1 hadolint --version\n"
            problems = check_ci_pins.check(repo(tmp, pr=pr))
            self.assertEqual(len(problems), 1, problems)
            self.assertIn("without a digest", problems[0])

    def test_yaml_comments_are_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            pr = PR + f"      # was: hadolint/hadolint:v2.14.0@sha256:{D1}, before that hadolint/hadolint:v2.13\n"
            pr += f"      - run: echo ok # semgrep/semgrep:1.170.0@sha256:{D3}\n"
            self.assertEqual(check_ci_pins.check(repo(tmp, pr=pr)), [])

    def test_yaml_extension_is_read_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / ".github" / "workflows" / "extra.yaml").write_text(
                f"jobs:\n  x:\n    container:\n      image: semgrep/semgrep:1.178.0@sha256:{D1}\n", encoding="utf-8")
            problems = check_ci_pins.check(root)
            self.assertEqual(len(problems), 1, problems)
            self.assertIn(".github/workflows/extra.yaml", problems[0])

    def test_root_without_a_value_is_a_usage_error(self):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            self.assertEqual(check_ci_pins.main(["--root"]), 2)
            self.assertEqual(check_ci_pins.main(["--root", "--other"]), 2)
        self.assertIn("usage:", err.getvalue())

    def test_this_repository_agrees(self):
        self.assertEqual(check_ci_pins.check(HERE.parents[1]), [])


if __name__ == "__main__":
    unittest.main()
