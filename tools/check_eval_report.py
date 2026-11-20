#!/usr/bin/env python3
"""Golden Set regression stage 2 trigger (docs/process/test-strategy.md). Stdlib only.

When a PR changes prompts, model fields or pipeline parameters, a committed eval report whose metadata names
the PR head commit, or an earlier commit at which the changed files already read exactly as at head, must exist
under evals/reports/. The second case covers the usual order (run on the code commit, then commit the report) and
squash or rebase onto a newer main. The owner starts the paid run himself; CI only checks.
Since 2026-10-25 only the Markdown evaluation is committed (raw run JSON stays local or an Actions artifact):
a `*.md` report counts when a line in its head reads `Commit: <sha>`; older JSON reports with meta.commit still
count. Mock reports (`*-mock.md`, meta.mock) never do.
Usage: python3 -I tools/check_eval_report.py <base> <head>
"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRIGGER = re.compile(r"^evals/configs/(prompts/|baseline\.json|arms/|pricing\.json)|^(packages|services)/pipeline/")
MODEL_FIELD = re.compile(r'"(model|judge|extractor_model|resolver_model|topic_model)"\s*:')
MD_COMMIT = re.compile(r"^\W*commit\W*:?\W*([0-9a-f]{7,40})\b", re.I | re.M)


def changed_files(base, head):
    out = subprocess.run(["git", "diff", "--name-only", f"{base}...{head}"], capture_output=True, text=True, check=True).stdout
    return [l for l in out.splitlines() if l]


def needs_report(files, base, head) -> list[str]:
    hits = [f for f in files if TRIGGER.search(f)]
    # Any other json under evals/configs counts only if a model field changed.
    for f in files:
        if f.startswith("evals/configs/") and f.endswith(".json") and f not in hits:
            diff = subprocess.run(["git", "diff", f"{base}...{head}", "--", f], capture_output=True, text=True).stdout
            if any(MODEL_FIELD.search(l) for l in diff.splitlines() if l.startswith(("+", "-")) and not l.startswith(("+++", "---"))):
                hits.append(f)
    return hits


def matches(head_sha: str, commit: str) -> bool:
    return bool(commit) and (head_sha.startswith(commit) or commit.startswith(head_sha[:7]))


def same_files(commit: str, head: str, files) -> bool:
    """True when `commit` exists and every file in `files` reads at `commit` exactly as at `head`."""
    if subprocess.run(["git", "cat-file", "-e", f"{commit}^{{commit}}"], capture_output=True).returncode != 0:
        return False
    return subprocess.run(["git", "diff", "--quiet", commit, head, "--", *files], capture_output=True).returncode == 0


def report_for(head_sha: str, reports_dir: pathlib.Path, same=lambda commit: False) -> pathlib.Path | None:
    """First non-mock report that names head_sha or a commit for which same(commit) holds."""
    ok = lambda c: matches(head_sha, c) or same(c)
    for p in sorted(reports_dir.rglob("*.md")):
        if p.name.endswith("-mock.md"):
            continue
        head = "\n".join(p.read_text(encoding="utf-8", errors="replace").splitlines()[:40])
        if any(ok(c) for c in MD_COMMIT.findall(head)):
            return p
    for p in sorted(reports_dir.glob("*.json")):
        try:
            meta = json.loads(p.read_text(encoding="utf-8")).get("meta", {})
        except (json.JSONDecodeError, OSError):
            continue
        commit = str(meta.get("commit", ""))
        if commit and ok(commit) and not meta.get("mock"):
            return p
    return None


def main(argv):
    base, head = (argv + ["origin/main", "HEAD"])[:2]
    files = changed_files(base, head)
    hits = needs_report(files, base, head)
    if not hits:
        print("no prompt, model or pipeline-parameter change; no eval report required")
        return 0
    head_sha = subprocess.run(["git", "rev-parse", head], capture_output=True, text=True, check=True).stdout.strip()
    report = report_for(head_sha, ROOT / "evals" / "reports", lambda c: same_files(c, head, hits))
    if report:
        print(f"eval report present: {report.relative_to(ROOT)} (head {head_sha[:7]}, changed files as measured)")
        return 0
    print("Eval-Bericht fehlt: changed " + ", ".join(hits), file=sys.stderr)
    print(f"Run stage 2 for the changed arm(s) with your keys and commit the Markdown report with a head line `Commit: <sha of the measured commit>` (head, or an earlier commit with the same changed files).", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
