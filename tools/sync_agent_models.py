#!/usr/bin/env python3
"""Write the model id (and a fixed effort) from .claude/models.json into the frontmatter of each agent file.

Usage: python3 -I tools/sync_agent_models.py [--check] [--root DIR]
`model:` comes from the role's tier; `effort:` is written only when the role's effort entry is one string (a map
by ticket risk, like the implementer's, is passed by the orchestrator at start and leaves the file alone).
Exit 1 when a tier floor is broken (models.json "rules"; nothing is written then) or, with --check, when a file
would change (for CI); exit 2 when a role has no agent file. Stdlib only.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORDER = ["guenstig", "mittel", "stark", "spitze"]
TOP = ("acceptance-judge", "critic", "architecture-reviewer")  # always spitze
REVIEW = ("reviewer", "security-reviewer", "frontend-reviewer")  # never below stark
IMPLEMENTERS = ("implementer", "implementer-high-risk")  # never spitze (the judge's tier)


def floor_violations(cfg: dict) -> list[str]:
    """Tier floors of the owner's review of 2026-10-25; roles absent from models.json are not checked."""
    roles, out = cfg["roles"], []
    for role in TOP:
        if role in roles and roles[role] != "spitze":
            out.append(f"{role} must be on tier spitze, is {roles[role]}")
    for role in REVIEW:
        if role in roles and ORDER.index(roles[role]) < ORDER.index("stark"):
            out.append(f"{role} must be at least tier stark, is {roles[role]}")
    for role in IMPLEMENTERS:
        if roles.get(role) == "spitze":
            out.append(f"{role} must never be on tier spitze (the judge's tier)")
    return out


def set_key(front: str, key: str, value: str) -> str:
    pat = re.compile(rf"^{key}:.*$", re.M)
    if pat.search(front):
        return pat.sub(f"{key}: {value}", front, count=1)
    return re.sub(r"^(model:.*)$", rf"\1\n{key}: {value}", front, count=1, flags=re.M)


def sync(root: pathlib.Path, check: bool) -> list[str]:
    """Returns the agent files that differ from models.json; writes them unless `check`."""
    cfg = json.loads((root / ".claude" / "models.json").read_text(encoding="utf-8"))
    efforts = cfg.get("effort", {})
    changed = []
    for role, tier in cfg["roles"].items():
        path = root / ".claude" / "agents" / f"{role}.md"
        if not path.exists():
            raise FileNotFoundError(f"missing agent file for role {role}: {path}")
        text = path.read_text(encoding="utf-8")
        end = text.index("\n---", 3)  # frontmatter only; prose below may say "model:" too
        front = set_key(text[:end], "model", cfg["tiers"][tier])
        if isinstance(efforts.get(role), str):
            front = set_key(front, "effort", efforts[role])
        new = front + text[end:]
        if new != text:
            changed.append(path.name)
            if not check:
                path.write_text(new, encoding="utf-8")
    return changed


def main(argv):
    root = pathlib.Path(argv[argv.index("--root") + 1]) if "--root" in argv else ROOT
    check = "--check" in argv
    cfg = json.loads((root / ".claude" / "models.json").read_text(encoding="utf-8"))
    broken = floor_violations(cfg)
    if broken:
        print("tier floor broken (.claude/models.json):\n" + "\n".join(broken), file=sys.stderr)
        return 1
    try:
        changed = sync(root, check)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 2
    if changed:
        print(("would change: " if check else "updated: ") + ", ".join(changed))
        return 1 if check else 0
    print("agent models in sync")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
