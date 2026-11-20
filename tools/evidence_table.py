#!/usr/bin/env python3
"""Evidence table per acceptance criterion for one ticket (decision "Vom Plan zum Ticket", 2026-10-21). Stdlib only.

Scans the repo for tests tagged @issue-<n> / @ac-<k> (Gherkin .feature files and Vitest *.test.ts / *.spec.ts),
joins them with the latest run results (Cucumber JSON, Vitest JSON), the acceptance judge's verdicts and report links,
and prints the Markdown table the main session posts as an issue comment. Missing inputs give empty cells, never a crash.
Run: python3 -I tools/evidence_table.py --issue <n> [--root <dir>] [--cucumber <json>]... [--vitest <json>]...
     [--verdicts <json>] [--report <stage>=<url>]... [--ac <issue-body.md>]
"""
import datetime, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", ".git"}
STAGES = ("1", "2a", "2b", "3", "4", "Abnahme")
TITLE_RE = re.compile(r"\b(?:it|test|describe)\s*\(\s*(['\"`])(.*?)\1", re.S)
AC_ITEM_RE = re.compile(r"^\s*(?:[-*]\s*(?:\[[ xX]\]\s*)?)?(?:(\d+)\.|AC\s*(\d+)\b)", re.I)


def ac_key(ac: str):
    m = re.match(r"(\d+)(.*)", ac)
    return (int(m.group(1)), m.group(2)) if m else (10**9, ac)


def stage_of(rel: pathlib.PurePath) -> str:
    parts = rel.parts
    if parts[:2] == ("tests", "acceptance"):
        return "Abnahme"
    if parts[:2] == ("tests", "api"):
        return "3"
    if parts[:2] == ("tests", "e2e"):
        return "4"
    if parts[:1] == ("apps",):
        return "2b"
    return "2a"


def skipped(rel: pathlib.PurePath) -> bool:
    return bool(SKIP_DIRS & set(rel.parts)) or rel.parts[:3] == ("tests", "acceptance", "reports")


def parse_feature(text: str, issue: int) -> list[tuple[str, list[str]]]:
    """(scenario name, AC ids) for every Scenario / Scenario Outline of the ticket. Feature tags apply to all scenarios."""
    out: list[tuple[str, list[str]]] = []
    pending: list[str] = []
    feature_tags: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("@"):
            pending += re.findall(r"@([\w-]+)", s)
        elif s.startswith("Feature:"):
            feature_tags, pending = pending, []
        elif re.match(r"(Scenario Outline|Scenario Template|Scenario|Example):", s):
            tags, pending = feature_tags + pending, []
            if f"issue-{issue}" in tags:
                acs = sorted({t[3:] for t in tags if t.startswith("ac-")}, key=ac_key)
                out.append((s.split(":", 1)[1].strip(), acs))
        elif s and not s.startswith("#"):
            pending = []
    return out


def parse_vitest_source(text: str, issue: int) -> list[tuple[str, list[str]]]:
    """(title, AC ids) for every it/test/describe title carrying @ac-<k>, if the file mentions @issue-<n>."""
    if f"@issue-{issue}" not in text:
        return []
    out = []
    for _, title in TITLE_RE.findall(text):
        acs = sorted(set(re.findall(r"@ac-([\w]+)", title)), key=ac_key)
        if acs:
            out.append((title, acs))
    return out


def scan(root: pathlib.Path, issue: int) -> list[dict]:
    """Tests of the ticket: {"ac", "stage", "name", "kind"} per (AC, test) pair."""
    tests = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root)
        if skipped(rel):
            continue
        if p.suffix == ".feature":
            found, stage, kind = parse_feature(p.read_text(encoding="utf-8"), issue), stage_of(rel), "feature"
        elif p.name.endswith((".test.ts", ".spec.ts")):
            found, stage, kind = parse_vitest_source(p.read_text(encoding="utf-8"), issue), "1", "vitest"
        else:
            continue
        for name, acs in found:
            for ac in acs:
                tests.append({"ac": ac, "stage": stage, "name": name, "kind": kind})
    return tests


def cucumber_status(reports: list) -> dict[str, str]:
    """Scenario name -> 'grün'/'rot' from classic Cucumber JSON (features -> elements -> steps)."""
    passed: dict[str, bool] = {}
    for report in reports:
        for feature in report or []:
            for el in feature.get("elements", []):
                if el.get("type", "scenario") == "background":
                    continue
                ok = all(st.get("result", {}).get("status") == "passed" for st in el.get("steps", []))
                passed[el.get("name", "")] = passed.get(el.get("name", ""), True) and ok
    return {k: "grün" if v else "rot" for k, v in passed.items()}


def vitest_status(reports: list, name: str) -> str:
    """'grün'/'rot' for all assertions whose title equals or fullName contains the source title; '' if none ran."""
    found = []
    for report in reports:
        for tr in (report or {}).get("testResults", []):
            for a in tr.get("assertionResults", []):
                if a.get("title") == name or name in a.get("fullName", ""):
                    found.append(a.get("status") == "passed")
    return "" if not found else ("grün" if all(found) else "rot")


def parse_acs(text: str) -> list[str]:
    """AC ids from the '## Acceptance criteria' / '## Akzeptanzkriterien' section of an issue body."""
    acs, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = re.match(r"##\s+(acceptance criteria|akzeptanzkriterien)\b", line, re.I) is not None
            continue
        m = AC_ITEM_RE.match(line) if inside else None
        if m:
            acs.append(m.group(1) or m.group(2))
    return acs


def cell(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def build(issue: int, root: pathlib.Path, cucumber: list | None = None, vitest: list | None = None,
          verdicts: dict | None = None, reports: dict | None = None, ac_text: str | None = None,
          today: str | None = None) -> str:
    tests = scan(root, issue)
    cuke = cucumber_status(cucumber or [])
    verdicts = verdicts or {}
    judge = {c.get("title", ""): c.get("verdict", "") for c in verdicts.get("real", verdicts.get("cases", []))}
    reports = reports or {}
    acs = parse_acs(ac_text) if ac_text else []
    acs = sorted(set(acs) | {t["ac"] for t in tests}, key=ac_key)
    today = today or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    lines = [f"### Belege zu #{issue} ({today} UTC)", "",
             "| AC | Tests (Stufe · Name) | Letzter Lauf | Richter | Bericht |", "|---|---|---|---|---|"]
    for ac in acs:
        rows = sorted((t for t in tests if t["ac"] == ac), key=lambda t: (STAGES.index(t["stage"]), t["name"]))
        if not rows:
            lines.append(f"| AC{ac} | ohne Test |  |  |  |")
        for t in rows:
            run = cuke.get(t["name"], "") if t["kind"] == "feature" else vitest_status(vitest or [], t["name"])
            richter = judge.get(t["name"], "") if t["stage"] == "Abnahme" else ""
            link = f"[Bericht]({reports[t['stage']]})" if t["stage"] in reports else ""
            lines.append(f"| AC{ac} | {t['stage']} · {cell(t['name'])} | {run} | {richter} | {link} |")
    lines += ["", "Erzeugt von tools/evidence_table.py; nie von Hand pflegen."]
    if verdicts and verdicts.get("judgeValid") is False:
        lines.append("Richterlauf ungültig (Kanarienvogel nicht erkannt).")
    return "\n".join(lines)


def read_json(path: str):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    opts: dict[str, list[str]] = {}
    for i, a in enumerate(argv):
        if a.startswith("--") and i + 1 < len(argv):
            opts.setdefault(a[2:], []).append(argv[i + 1])
    if "issue" not in opts:
        print(__doc__.strip().splitlines()[-2].strip(), file=sys.stderr)
        return 2
    issue = int(opts["issue"][0])
    root = pathlib.Path(opts["root"][0]).resolve() if "root" in opts else ROOT
    reports = dict(r.split("=", 1) for r in opts.get("report", []) if "=" in r)
    verdicts = read_json(opts["verdicts"][0]) if "verdicts" in opts else None
    ac_text = pathlib.Path(opts["ac"][0]).read_text(encoding="utf-8") if "ac" in opts else None
    print(build(issue, root, [read_json(f) for f in opts.get("cucumber", [])],
                [read_json(f) for f in opts.get("vitest", [])], verdicts, reports, ac_text))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
