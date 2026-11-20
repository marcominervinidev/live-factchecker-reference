#!/usr/bin/env python3
"""Evaluates Semgrep's JSON report for the Semgrep check of make ci-local (ticket #187).

Owner decision G9 of 2026-11-06 („g überall ja“) and gate 1 of 2026-11-18: every Semgrep error fails the check, a
`Timeout`, a parse error or an error without a path (a rule pack that does not load), except an error on a path
that matches EXEMPT below. The exemption is for errors only: a finding fails wherever it is.

Prints per finding `<check_id>  <path>:<line>`, per error its type (of a list type such as
["PartialParsing", [<spans>]] only the first element), path and rule where the report gives them, then one summary
line. Never a matched line, a fix or a span, and never the message of an error with a path: a parse error's message
holds the source, a secret included. An error without a path concerns Semgrep itself; it prints the first line of
its message, cut to MESSAGE_LIMIT characters (gate 1, „Meldung ja“).

Usage: python3 -I tools/check_semgrep_report.py --semgrep-exit <code> <report.json>
Exit 0 on a pass; 1 on a finding, an error in scope or a non-zero Semgrep exit code; 2 on a missing, empty or
unreadable report or a missing or non-integer --semgrep-exit. Stdlib only; run by scripts/ci/local.sh.
"""
import argparse, json, pathlib, re, sys

# Errors on these paths are printed and counted but do not fail the check. `*` is exactly one path segment; a glob
# matches the whole path (anchored at both ends), case-sensitive. The 19 Golden Set pages time out on every run.
EXEMPT = ("evals/golden/*/korrektur.html",)
MESSAGE_LIMIT = 200
EXEMPT_PATTERNS = tuple(re.compile(re.escape(glob).replace(r"\*", "[^/]+")) for glob in EXEMPT)


class BadReport(Exception):
    """The report cannot be evaluated; the check fails and names the report."""


def exit_code(text: str) -> int:
    if not re.fullmatch(r"[0-9]+", text, re.ASCII):
        raise argparse.ArgumentTypeError(f"Semgrep's exit code must be a non-negative integer, got {text!r}")
    return int(text)


def load(path: str) -> dict:
    try:
        text = pathlib.Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise BadReport(f"cannot read it ({exc.strerror or type(exc).__name__})") from None
    except UnicodeDecodeError:
        raise BadReport("not UTF-8") from None
    if not text.strip():
        raise BadReport("empty")
    try:
        report = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BadReport(f"not JSON ({exc.msg} at line {exc.lineno})") from None
    except (ValueError, RecursionError) as exc:  # an integer beyond Python's digit limit, nesting beyond the stack
        raise BadReport(f"not usable JSON ({type(exc).__name__})") from None
    if not isinstance(report, dict):
        raise BadReport("not a JSON object")
    for key in ("results", "errors"):
        if not isinstance(report.get(key), list):
            raise BadReport(f"no list '{key}'")
    paths = report.get("paths")
    if not isinstance(paths, dict) or not isinstance(paths.get("scanned"), list):
        raise BadReport("no list 'paths.scanned'")
    return report


def printable(value) -> str:
    """str(value) with every non-printable character (newline, CR, ESC, other C0 and C1 controls, line separators)
    escaped as ascii() writes it: a crafted file name, rule or message cannot start a forged summary line or rewrite
    the error line in a terminal. A path of printable characters stays byte-identical."""
    text = str(value)
    return text if text.isprintable() else "".join(c if c.isprintable() else ascii(c)[1:-1] for c in text)


def finding_line(entry) -> str:
    try:
        return f"{printable(entry['check_id'])}  {printable(entry['path'])}:{printable(entry['start']['line'])}"
    except (KeyError, TypeError):
        raise BadReport("a result without check_id, path or start.line") from None


def error_kind(entry) -> str:
    kind = entry.get("type") if isinstance(entry, dict) else None
    if isinstance(kind, list) and kind:
        kind = kind[0]
    if not isinstance(kind, str) or not kind:
        raise BadReport("an error without a type")
    return kind


def first_line(message) -> str:
    if not isinstance(message, str) or not message.strip():
        return ""
    line = message.strip().splitlines()[0]
    return line if len(line) <= MESSAGE_LIMIT else line[:MESSAGE_LIMIT] + "..."


def evaluate(report: dict):
    """Returns the lines to print and (findings, in scope, timeouts in scope, out of scope, timeouts out of scope)."""
    lines = [finding_line(entry) for entry in report["results"]]
    counts = {True: [0, 0], False: [0, 0]}  # in scope -> [errors, timeouts]
    for entry in report["errors"]:
        kind, path, rule = error_kind(entry), entry.get("path"), entry.get("rule_id")
        if path is not None and not isinstance(path, str):
            raise BadReport("an error whose path is not a string")
        in_scope = path is None or not any(p.fullmatch(path) for p in EXEMPT_PATTERNS)
        counts[in_scope][0] += 1
        counts[in_scope][1] += kind == "Timeout"
        where = "(no path)" if path is None else printable(path)
        line = f"error {'in scope' if in_scope else 'out of scope'}: {printable(kind)}  {where}"
        if rule is not None:
            line += f"  (rule {printable(rule)})"
        message = first_line(entry.get("message")) if path is None else ""
        lines.append(line + (f"  message: {printable(message)}" if message else ""))
    return lines, (len(report["results"]), *counts[True], *counts[False])


def main(argv) -> int:
    parser = argparse.ArgumentParser(description="Evaluates Semgrep's JSON report for make ci-local (#187).")
    parser.add_argument("--semgrep-exit", required=True, type=exit_code, metavar="CODE",
                        help="Semgrep's exit code; anything but 0 fails the check")
    parser.add_argument("report", help="Semgrep's JSON report (semgrep scan --json -o <report>)")
    args = parser.parse_args(argv)
    semgrep_failed = f"semgrep exited with {args.semgrep_exit}, not 0: the check fails"
    try:
        report = load(args.report)
        lines, (findings, errors, timeouts, out_of_scope, out_of_scope_timeouts) = evaluate(report)
    except BadReport as exc:
        print(f"{args.report}: not a usable Semgrep JSON report: {exc}", file=sys.stderr)
        if args.semgrep_exit:
            print(semgrep_failed, file=sys.stderr)
        return 2
    for line in lines:
        print(line)
    if args.semgrep_exit:
        print(semgrep_failed)
    print(f"{len(report['paths']['scanned'])} files, {findings} finding(s), {errors} error(s) in scope "
          f"({timeouts} timeout(s)), {out_of_scope} error(s) out of scope ({out_of_scope_timeouts} timeout(s))")
    return 1 if findings or errors or args.semgrep_exit else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
