#!/usr/bin/env python3
"""Agent balance for the PR (docs/process/pr-format.md, ADR 0011 metrics). Stdlib only.

Reads the JSON results the workflows and the main session drop under .claude/scratch/balance/<issue>/:
  test-design-r*.json, review-chain.json, acceptance.json (workflow return values),
  implementer-<task>.md (the implementer's report with STATUS: and Attempts: lines),
  usage.json (optional: tokens and cost per role, written by tools/usage_from_logs.py from the Claude Code session
  logs, or by the session from its own usage data),
  hand-<task>.json (optional: {"minutes": n, "sessions": n} for a task the owner built by hand, docs/process/lernpfad.md;
  rendered as a "Hand" line with his time instead of tokens).
Prints the Markdown for the "Agent-Bilanz" section. Usage: python3 -I tools/agent_balance.py --issue <n>
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(issue: int, base: pathlib.Path | None = None):
    d = (base or ROOT / ".claude" / "scratch" / "balance") / str(issue)
    data = {"design": [], "review": None, "acceptance": None, "implementers": [], "usage": {}, "hand": []}
    if not d.is_dir():
        return data
    for p in sorted(d.glob("test-design-r*.json")):
        data["design"].append(json.loads(p.read_text(encoding="utf-8")))
    for name in ("review-chain", "acceptance"):
        p = d / f"{name}.json"
        if p.is_file():
            data["review" if name == "review-chain" else "acceptance"] = json.loads(p.read_text(encoding="utf-8"))
    for p in sorted(d.glob("implementer-*.md")):
        t = p.read_text(encoding="utf-8")
        status = re.search(r"^STATUS:\s*(\S+)", t, re.M)
        attempts = re.search(r"^Attempts:\s*(\d+)", t, re.M)
        data["implementers"].append({"task": p.stem.replace("implementer-", ""), "status": status.group(1) if status else "?", "attempts": int(attempts.group(1)) if attempts else None})
    p = d / "usage.json"
    if p.is_file():
        data["usage"] = json.loads(p.read_text(encoding="utf-8"))
    for p in sorted(d.glob("hand-*.json")):
        h = json.loads(p.read_text(encoding="utf-8"))
        data["hand"].append({"task": p.stem.replace("hand-", ""), "minutes": int(h.get("minutes", 0)), "sessions": int(h.get("sessions", 0))})
    return data


def render(data) -> str:
    lines = ["| Rolle | Modell | Aufrufe | Loops bis grün | Tokens | Kosten |", "|---|---|---|---|---|---|"]
    usage = data["usage"]
    def row(role, calls, loops=""):
        u = usage.get(role, {})
        lines.append(f"| {role} | {u.get('model', '')} | {calls} | {loops} | {u.get('tokens', '')} | {u.get('cost_usd', '')} |")
    if data["design"]:
        row("test-designer", len(data["design"]))
        row("critic", len(data["design"]))
    for imp in data["implementers"]:
        row(f"implementer ({imp['task']})", 1, imp["attempts"] if imp["attempts"] is not None else "?")
    for h in data["hand"]:
        lines.append(f"| Hand ({h['task']}) | owner | {h['sessions']} Sitzung(en) | | {h['minutes']} min | |")
    if data["review"]:
        for r in data["review"].get("results", []):
            row(r.get("role", "reviewer"), 1)
    if data["acceptance"]:
        row("acceptance-judge", 1 + int(data["acceptance"].get("discardedRuns", 0)))
    lines.append("")
    lines.append("Befunde je Reviewer (beim Lesen „berechtigt“ ankreuzen):")
    if data["review"]:
        for r in data["review"].get("results", []):
            for b in r.get("blockers", []) + r.get("warnings", []):
                lines.append(f"- [ ] {r.get('role')}: `{b.get('path')}`{':' + str(b['line']) if b.get('line') else ''} {b.get('finding')} · berechtigt")
    else:
        lines.append("- (keine Review-Kette gefunden)")
    lines.append("")
    rounds = len(data["design"])
    gate1 = max(0, rounds - 1)
    acc = data["acceptance"] or {}
    real = acc.get("real", [])
    counts = {v: sum(1 for c in real if c.get("verdict") == v) for v in ("passt", "passt nicht", "unklar")}
    canary = "erkannt" if acc.get("canaryCaught") else ("verpasst" if acc else "kein Lauf")
    lines.append(f"Rücklauf an Tor 1: {gate1} Runde(n) · Richter: {counts['passt']} passt, {counts['passt nicht']} passt nicht, {counts['unklar']} unklar, Kanarienvogel {canary}")
    return "\n".join(lines)


def main(argv):
    issue = int(argv[argv.index("--issue") + 1])
    print(render(load(issue)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
