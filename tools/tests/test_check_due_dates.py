"""Tests for the dated-commitments check. Run: python3 -I -m unittest discover -s tools/tests"""
import contextlib
import io
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import check_due_dates  # noqa: E402

# The marker words are built here so this tracked file never carries a dated marker itself.
DUE = "DU" + "E"
EXP = "ex" + "p:"


def run(root, *extra):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = check_due_dates.main(["--root", str(root), "--today", "2026-06-15", *extra])
    return code, out.getvalue(), err.getvalue()


def write(root, rel, text):
    path = pathlib.Path(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class DueDates(unittest.TestCase):
    def test_no_marker_is_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "README.md", "nothing dated here\n")
            code, out, _ = run(tmp)
            self.assertEqual(code, 0)
            self.assertIn("0 marker(s)", out)

    def test_a_past_marker_fails_and_names_file_and_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, ".github/dependabot.yml", f"version: 2\n# paused, {DUE} 2026-06-14, owner decision\n")
            code, _, err = run(tmp)
            self.assertEqual(code, 1)
            self.assertIn(".github/dependabot.yml:2", err)
            self.assertIn("2026-06-14", err)

    def test_today_is_not_overdue_but_announced(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "docs/process/due.md", f"| first retro | {DUE} 2026-06-15 |\n")
            code, out, _ = run(tmp)
            self.assertEqual(code, 0)
            self.assertIn("notice: due 2026-06-15", out)

    def test_a_marker_beyond_the_warning_window_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "sonar-project.properties", f"# advisory, {DUE}: 2026-09-01\n")
            code, out, _ = run(tmp)
            self.assertEqual(code, 0)
            self.assertNotIn("notice", out)
            self.assertIn("1 marker(s)", out)

    def test_warn_days_widens_the_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "a.md", f"{DUE} 2026-07-01\n")
            _, out, _ = run(tmp, "--warn-days", "30")
            self.assertIn("notice: due 2026-07-01", out)

    def test_trivy_expiry_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, ".trivyignore", f"CVE-2026-0001 {EXP}2026-06-01\n")
            code, _, err = run(tmp)
            self.assertEqual(code, 1)
            self.assertIn(".trivyignore:1", err)

    def test_a_placeholder_or_an_impossible_date_is_no_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "a.md", f"{DUE} YYYY-MM-DD\n{DUE} 2026-13-40\noverdue is a word, not a marker 2020-01-01\n")
            code, out, _ = run(tmp)
            self.assertEqual(code, 0)
            self.assertIn("0 marker(s)", out)

    def test_skipped_directories_and_binary_files_are_not_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "node_modules/x/readme.md", f"{DUE} 2020-01-01\n")
            (pathlib.Path(tmp) / "blob.bin").write_bytes(b"\0\0" + f"{DUE} 2020-01-01".encode())
            code, out, _ = run(tmp)
            self.assertEqual(code, 0)
            self.assertIn("0 marker(s)", out)

    def test_every_overdue_marker_is_listed_oldest_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "b.md", f"{DUE} 2026-05-01\n")
            write(tmp, "a.md", f"{DUE} 2026-06-01\n")
            code, _, err = run(tmp)
            self.assertEqual(code, 1)
            self.assertLess(err.index("2026-05-01"), err.index("2026-06-01"))


if __name__ == "__main__":
    unittest.main()
