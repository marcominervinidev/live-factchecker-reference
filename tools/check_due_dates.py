#!/usr/bin/env python3
"""Dated commitments must not pass their date unnoticed (blueprint review 2026-11-20).

A temporary exception, a paused updater, an advisory gate, a retro or a note that was decided "by" a date carries
a marker in the file where it lives:

    DUE YYYY-MM-DD      anywhere in a tracked text file (comment, Markdown, YAML, table cell)
    exp:YYYY-MM-DD      Trivy's own expiry syntax in .trivyignore

The check fails (exit 1) when a marker's date is before today and prints file, line and the text of the line; it
prints markers that fall due within --warn-days (default 7) as a notice and still exits 0. Removing the marker is
the way to close a commitment: with the exception gone, the gate switched on, or a new owner decision and date.
`docs/process/due.md` is the list for commitments that have no natural file.

Usage: python3 -I tools/check_due_dates.py [--root DIR] [--today YYYY-MM-DD] [--warn-days N]
Tracked files come from `git ls-files`; outside a git checkout the tree is walked. Stdlib only.
"""
import datetime
import os
import pathlib
import re
import subprocess
import sys

MARKER = re.compile(r"\b(?:DUE[ :]+|exp:)(\d{4}-\d{2}-\d{2})\b")
SKIP_DIRS = {"node_modules", ".git", "dist", "coverage", ".stryker-tmp", "worktrees", "reports"}
MAX_BYTES = 2_000_000


def tracked(root: pathlib.Path) -> list[str]:
    try:
        out = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True, check=True).stdout
        files = [p for p in out.decode("utf-8", "replace").split("\0") if p]
        if files:
            return files
    except (OSError, subprocess.CalledProcessError):
        pass
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            found.append(str((pathlib.Path(dirpath) / name).relative_to(root)))
    return found


def markers(root: pathlib.Path) -> list[tuple[datetime.date, str, int, str]]:
    """(date, path, line number, line text) for every marker with a real calendar date."""
    out = []
    for rel in sorted(tracked(root)):
        path = root / rel
        try:
            if not path.is_file() or path.stat().st_size > MAX_BYTES:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:8000]:
            continue
        for number, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
            for match in MARKER.finditer(line):
                try:
                    date = datetime.date.fromisoformat(match.group(1))
                except ValueError:
                    continue
                out.append((date, rel, number, line.strip()[:200]))
    return out


def option(argv: list[str], name: str, default: str) -> str:
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default


def main(argv: list[str]) -> int:
    root = pathlib.Path(option(argv, "--root", str(pathlib.Path(__file__).resolve().parents[1])))
    today = datetime.date.fromisoformat(option(argv, "--today", datetime.date.today().isoformat()))
    warn_days = int(option(argv, "--warn-days", "7"))
    found = markers(root)
    overdue = [m for m in found if m[0] < today]
    soon = [m for m in found if today <= m[0] <= today + datetime.timedelta(days=warn_days)]
    for date, rel, number, text in soon:
        print(f"notice: due {date.isoformat()}: {rel}:{number}: {text}")
    if overdue:
        print("overdue commitments (close each one, or set a new date with an owner decision):", file=sys.stderr)
        for date, rel, number, text in sorted(overdue):
            print(f"  {date.isoformat()}  {rel}:{number}: {text}", file=sys.stderr)
        return 1
    print(f"dated commitments ok ({len(found)} marker(s), none overdue)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
