"""Tests for the agent model sync against a temp tree. Run: python3 -I -m unittest discover -s tools/tests"""
import contextlib, io, json, pathlib, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import sync_agent_models  # noqa: E402

MODELS = {
    "tiers": {"spitze": "claude-fable-5-1", "stark": "claude-opus-5-5", "mittel": "claude-sonnet-5-5"},
    "roles": {"implementer": "stark", "refinement": "mittel"},
    "effort": {"implementer": {"low": "medium", "medium": "high", "high": "xhigh"}},
}


def agent(name, model, effort=None):
    extra = f"effort: {effort}\n" if effort else ""
    return f"---\nname: {name}\ndescription: \"x\"\nmodel: {model}\n{extra}---\n\n# Role: {name}\n\nmodel: this line is prose and stays\neffort: so is this\n"


def tree(tmp, refinement_model="claude-sonnet-5-5", models=None):
    root = pathlib.Path(tmp)
    (root / ".claude" / "agents").mkdir(parents=True)
    (root / ".claude" / "models.json").write_text(json.dumps(models or MODELS), encoding="utf-8")
    (root / ".claude" / "agents" / "implementer.md").write_text(agent("implementer", "claude-opus-5-5", "high"), encoding="utf-8")
    (root / ".claude" / "agents" / "refinement.md").write_text(agent("refinement", refinement_model), encoding="utf-8")
    return root


def with_roles(**roles):
    cfg = json.loads(json.dumps(MODELS))
    cfg["roles"].update({k.replace("_", "-"): v for k, v in roles.items()})
    return cfg


def run_main(argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = sync_agent_models.main(argv)
    return code, out.getvalue()


class Sync(unittest.TestCase):
    def test_check_is_green_when_in_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = tree(tmp)
            self.assertEqual(sync_agent_models.sync(root, check=True), [])
            code, out = run_main(["--check", "--root", str(root)])
            self.assertEqual(code, 0)
            self.assertIn("in sync", out)

    def test_check_is_red_and_writes_nothing_on_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = tree(tmp, refinement_model="claude-haiku-5-5")
            before = (root / ".claude" / "agents" / "refinement.md").read_text(encoding="utf-8")
            code, out = run_main(["--check", "--root", str(root)])
            self.assertEqual(code, 1)
            self.assertIn("would change: refinement.md", out)
            self.assertEqual((root / ".claude" / "agents" / "refinement.md").read_text(encoding="utf-8"), before)

    def test_write_sets_only_the_frontmatter_model_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = tree(tmp, refinement_model="claude-haiku-5-5")
            code, out = run_main(["--root", str(root)])
            self.assertEqual(code, 0)
            self.assertIn("updated: refinement.md", out)
            text = (root / ".claude" / "agents" / "refinement.md").read_text(encoding="utf-8")
            self.assertEqual(text, agent("refinement", "claude-sonnet-5-5"))
            self.assertEqual(sync_agent_models.sync(root, check=True), [])

    def test_a_fixed_effort_is_written_into_the_frontmatter_and_a_risk_map_is_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = json.loads(json.dumps(MODELS))
            cfg["effort"]["refinement"] = "xhigh"
            root = tree(tmp, models=cfg)
            code, out = run_main(["--root", str(root)])
            self.assertEqual(code, 0)
            self.assertEqual((root / ".claude" / "agents" / "refinement.md").read_text(encoding="utf-8"),
                             agent("refinement", "claude-sonnet-5-5", "xhigh"))
            self.assertEqual((root / ".claude" / "agents" / "implementer.md").read_text(encoding="utf-8"),
                             agent("implementer", "claude-opus-5-5", "high"))

    def test_every_role_needs_an_agent_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = tree(tmp)
            (root / ".claude" / "agents" / "implementer.md").unlink()
            code, out = run_main(["--check", "--root", str(root)])
            self.assertEqual(code, 2)
            self.assertIn("missing agent file for role implementer", out)


class Floors(unittest.TestCase):
    def test_owner_floors_hold_for_the_real_models_json(self):
        cfg = json.loads((sync_agent_models.ROOT / ".claude" / "models.json").read_text(encoding="utf-8"))
        self.assertEqual(sync_agent_models.floor_violations(cfg), [])

    def test_judge_critic_and_architecture_reviewer_must_be_on_spitze(self):
        for role in ("acceptance_judge", "critic", "architecture_reviewer"):
            with self.subTest(role=role):
                self.assertEqual(sync_agent_models.floor_violations(with_roles(**{role: "spitze"})), [])
                broken = sync_agent_models.floor_violations(with_roles(**{role: "stark"}))
                self.assertEqual(broken, [f"{role.replace('_', '-')} must be on tier spitze, is stark"])

    def test_review_roles_must_be_at_least_stark(self):
        for role in ("reviewer", "security_reviewer", "frontend_reviewer"):
            with self.subTest(role=role):
                self.assertEqual(sync_agent_models.floor_violations(with_roles(**{role: "stark"})), [])
                self.assertEqual(sync_agent_models.floor_violations(with_roles(**{role: "spitze"})), [])
                self.assertEqual(len(sync_agent_models.floor_violations(with_roles(**{role: "mittel"}))), 1)
                self.assertEqual(len(sync_agent_models.floor_violations(with_roles(**{role: "guenstig"}))), 1)

    def test_implementers_must_never_be_on_spitze(self):
        for role in ("implementer", "implementer_high_risk"):
            with self.subTest(role=role):
                broken = sync_agent_models.floor_violations(with_roles(**{role: "spitze"}))
                self.assertEqual(broken, [f"{role.replace('_', '-')} must never be on tier spitze (the judge's tier)"])

    def test_a_broken_floor_fails_check_and_write_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = tree(tmp, refinement_model="claude-haiku-5-5", models=with_roles(implementer="spitze"))
            before = (root / ".claude" / "agents" / "refinement.md").read_text(encoding="utf-8")
            for argv in (["--check", "--root", str(root)], ["--root", str(root)]):
                code, out = run_main(argv)
                self.assertEqual(code, 1)
                self.assertIn("tier floor broken", out)
            self.assertEqual((root / ".claude" / "agents" / "refinement.md").read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
