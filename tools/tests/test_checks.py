"""Tests for the stage-0 repository checks. Run: python3 -I -m unittest discover -s tools/tests"""
import pathlib, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import check_context_budget, check_docs_coverage  # noqa: E402

README = "# x\n\n## Purpose\np\n\n## Boundaries\nb\n\n## Pitfalls\nq\n\n## Commands\nc\n"
RULE = '---\npaths:\n  - "services/**"\n---\n\n# Pipeline\n\n## File map\n`packages/pipeline/` the pipeline.\n'


def repo(tmp):
    root = pathlib.Path(tmp)
    (root / ".claude" / "rules").mkdir(parents=True)
    (root / ".claude" / "rules" / "pipeline.md").write_text(RULE, encoding="utf-8")
    return root


class DocsCoverage(unittest.TestCase):
    def test_complete_service_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / "services" / "gateway").mkdir(parents=True)
            (root / "services" / "gateway" / "README.md").write_text(README, encoding="utf-8")
            self.assertEqual(check_docs_coverage.check(root), [])

    def test_missing_readme_and_rule(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / "packages" / "mask").mkdir(parents=True)
            gaps = check_docs_coverage.check(root)
            self.assertEqual(len(gaps), 2)
            self.assertIn("packages/mask: README.md missing", gaps[0])
            self.assertIn("no .claude/rules", gaps[1])

    def test_readme_missing_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / "services" / "stt").mkdir(parents=True)
            (root / "services" / "stt" / "README.md").write_text(README.replace("## Pitfalls\nq\n\n", ""), encoding="utf-8")
            gaps = check_docs_coverage.check(root)
            self.assertEqual(gaps, ["services/stt/README.md: missing ## Pitfalls"])

    def test_file_map_mention_counts_as_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / "packages" / "pipeline").mkdir(parents=True)
            (root / "packages" / "pipeline" / "README.md").write_text(README, encoding="utf-8")
            self.assertEqual(check_docs_coverage.check(root), [])

    def test_fixtures_and_hidden_dirs_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / "tests" / "fixtures").mkdir(parents=True)
            (root / "tests" / ".cache").mkdir(parents=True)
            self.assertEqual(check_docs_coverage.check(root), [])


class ContextBudget(unittest.TestCase):
    def test_within_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / "CLAUDE.md").write_text("x\n" * 120, encoding="utf-8")
            self.assertEqual(check_context_budget.check(root), [])

    def test_over_budget_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / "CLAUDE.md").write_text("x\n" * 121, encoding="utf-8")
            (root / ".claude" / "agents").mkdir()
            (root / ".claude" / "agents" / "big.md").write_text("x\n" * 121, encoding="utf-8")
            over = check_context_budget.check(root)
            self.assertEqual(over, ["CLAUDE.md: 121 lines, budget 120", ".claude/agents/big.md: 121 lines, budget 120"])

    def test_rule_budget_is_80(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = repo(tmp)
            (root / ".claude" / "rules" / "long.md").write_text("x\n" * 81, encoding="utf-8")
            self.assertEqual(check_context_budget.check(root), [".claude/rules/long.md: 81 lines, budget 80"])


if __name__ == "__main__":
    unittest.main()
