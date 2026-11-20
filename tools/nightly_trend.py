#!/usr/bin/env python3
"""One trend comment per night on the issue labelled `nightly` (docs/process/test-strategy.md). Stdlib plus gh.

Usage: python3 -I tools/nightly_trend.py --needs <json> --browser <name> --run-url <url> --artifacts <dir>
Reads job results from the workflow's `needs` JSON and mutation scores from downloaded Stryker reports.
"""
import json, pathlib, subprocess, sys, datetime


def mutation_scores(artifacts: pathlib.Path):
    scores = {}
    for p in artifacts.glob("**/mutation.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        files = d.get("files", {})
        killed = sum(1 for f in files.values() for m in f.get("mutants", []) if m.get("status") in ("Killed", "Timeout"))
        total = sum(1 for f in files.values() for m in f.get("mutants", []) if m.get("status") not in ("Ignored",))
        pkg = p.parts[-4] if len(p.parts) >= 4 else p.parent.name
        scores[pkg] = round(100 * killed / total, 1) if total else None
    return scores


def render(needs, browser, run_url, scores):
    day = datetime.date.today().isoformat()
    lines = [f"### Nacht {day} · [Lauf]({run_url})", "", "| Job | Ergebnis |", "|---|---|"]
    for k, v in needs.items():
        if k == "plan":
            continue
        lines.append(f"| {k} | {v.get('result', '?')} |")
    lines.append("")
    lines.append(f"E2E-Browser: `{browser}` (dreifach)")
    if scores:
        lines.append("")
        lines.append("| Paket | Mutation Score |")
        lines.append("|---|---|")
        for pkg, s in sorted(scores.items()):
            lines.append(f"| {pkg} | {s if s is not None else '–'} % |")
    return "\n".join(lines)


def main(argv):
    def arg(name, default=""):
        return argv[argv.index(name) + 1] if name in argv else default
    needs = json.loads(arg("--needs", "{}"))
    body = render(needs, arg("--browser"), arg("--run-url"), mutation_scores(pathlib.Path(arg("--artifacts", "artifacts"))))
    issue = subprocess.run(["gh", "issue", "list", "--label", "nightly", "--state", "open", "--limit", "1", "--json", "number", "--jq", ".[0].number // empty"], capture_output=True, text=True).stdout.strip()
    if not issue:
        print("no open issue labelled `nightly`; printing instead\n" + body)
        return 0
    tmp = pathlib.Path("nightly-comment.md"); tmp.write_text(body, encoding="utf-8")
    subprocess.run(["gh", "issue", "comment", issue, "--body-file", str(tmp)], check=True)
    print(f"commented on #{issue}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
