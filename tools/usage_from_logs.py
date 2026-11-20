#!/usr/bin/env python3
"""Token usage and cost per role from Claude Code session logs, as usage.json for tools/agent_balance.py. Stdlib only.

Usage:
  python3 -I tools/usage_from_logs.py --project ~/.claude/projects/<encoded-repo-path> --since 2026-10-19T08:00:00Z \
      [--until <iso>] [--by role|model] [--out .claude/scratch/balance/<issue>/usage.json]

Log format (verified 2026-10-19 on Claude Code session logs, field names only):
- One JSONL file per session in the project directory; each subagent run is a separate file
  <session>/subagents/agent-<id>.jsonl with a sibling agent-<id>.meta.json whose `agentType` names the agent.
- Lines with `type == "assistant"` carry `message.model`, `message.id`, `requestId`, `timestamp` (ISO, UTC "Z") and
  `message.usage` with input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens and
  `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`.
- One API response is split over several lines (one per content block) that repeat the same usage; lines are
  therefore deduplicated by (requestId, message.id). Model "<synthetic>" lines are not API calls and are skipped.

Roles: a subagent file is attributed to its meta.json `agentType`; the main session is "main". If a meta file is
missing the run is "subagent". With --by model the keys are model ids.

Output shape: {"<role or model>": {"model": str, "tokens": int, "cost_usd": float|None, "calls": int,
"models": {model: tokens}}}. `tokens` = input + cache writes + cache reads + output. `cost_usd` is None when a
model is missing from PRICES.
"""
import argparse, datetime, json, pathlib, sys

# USD per million tokens: (input, output, cache read). LIST PRICES as cached in the claude-api skill on 2026-10-06,
# Anthropic first-party API, standard tier; verify before relying on them. Cache writes: 1.25x input (5-minute TTL),
# 2x input (1-hour TTL). Claude Haiku 5.5 uses its <=100K-prompt price.
PRICES = {
    "claude-fable-5-1": (10.00, 50.00, 0.25),
    "claude-fable-5": (10.00, 50.00, 1.00),
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-opus-5": (5.00, 25.00, 0.50),
    "claude-opus-4-8": (5.00, 25.00, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00, 0.10),  # cache read per cost research #56
    "claude-sonnet-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
    "claude-haiku-4-5": (1.00, 5.00, 0.10),
}
WRITE_5M, WRITE_1H = 1.25, 2.0


def parse_ts(s):
    if not s:
        return None
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def role_of(path: pathlib.Path) -> str:
    if path.parent.name != "subagents":
        return "main"
    meta = path.with_name(path.stem + ".meta.json")
    try:
        return json.loads(meta.read_text(encoding="utf-8")).get("agentType") or "subagent"
    except (OSError, ValueError):
        return "subagent"


def usage_cost(model, u):
    price = PRICES.get(model)
    if price is None:
        return None
    p_in, p_out, p_read = price
    cc = u.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens") or 0
    w5m = cc.get("ephemeral_5m_input_tokens")
    if w5m is None:
        w5m = max(0, (u.get("cache_creation_input_tokens") or 0) - w1h)
    return (
        (u.get("input_tokens") or 0) * p_in
        + w5m * p_in * WRITE_5M
        + w1h * p_in * WRITE_1H
        + (u.get("cache_read_input_tokens") or 0) * p_read
        + (u.get("output_tokens") or 0) * p_out
    ) / 1_000_000


def usage_tokens(u):
    return sum(u.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"))


def iter_calls(project: pathlib.Path, since=None, until=None):
    """Yield (role, model, usage) once per API response.

    A response logged as several content blocks repeats its usage, but the early blocks carry a partial
    output_tokens; keep the per-field maximum over all lines of one response (cost research, 2026-10-20).
    """
    calls, order = {}, []
    for path in sorted(project.rglob("*.jsonl")):
        role = role_of(path)
        with path.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue  # a session still being written can end in a partial line
                if rec.get("type") != "assistant":
                    continue
                msg = rec.get("message") or {}
                model, u = msg.get("model"), msg.get("usage")
                if not model or model.startswith("<") or not isinstance(u, dict):
                    continue
                ts = parse_ts(rec.get("timestamp"))
                if ts is not None and ((since and ts < since) or (until and ts >= until)):
                    continue
                key = (rec.get("requestId"), msg.get("id"))
                if key == (None, None):
                    key = ("line", len(order))
                if key in calls:
                    _, _, prev = calls[key]
                    for k, v in u.items():
                        if isinstance(v, (int, float)) and v > (prev.get(k) or 0):
                            prev[k] = v
                    continue
                calls[key] = (role, model, dict(u))
                order.append(key)
    for key in order:
        yield calls[key]


def aggregate(project, since=None, until=None, by="role"):
    out = {}
    for role, model, u in iter_calls(project, since, until):
        e = out.setdefault(role if by == "role" else model, {"model": None, "tokens": 0, "cost_usd": 0.0, "calls": 0, "models": {}})
        t = usage_tokens(u)
        e["tokens"] += t
        e["calls"] += 1
        e["models"][model] = e["models"].get(model, 0) + t
        c = usage_cost(model, u)
        e["cost_usd"] = None if c is None or e["cost_usd"] is None else e["cost_usd"] + c
    for e in out.values():
        e["model"] = max(e["models"], key=e["models"].get)
        if e["cost_usd"] is not None:
            e["cost_usd"] = round(e["cost_usd"], 4)
    return out


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--project", required=True, type=pathlib.Path, help="~/.claude/projects/<encoded repo path>")
    ap.add_argument("--since", required=True, help="ISO timestamp, e.g. 2026-10-19T08:00:00Z")
    ap.add_argument("--until", help="ISO timestamp (exclusive)")
    ap.add_argument("--by", choices=("role", "model"), default="role")
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("usage.json"))
    a = ap.parse_args(argv)
    if not a.project.is_dir():
        print(f"no such project directory: {a.project}", file=sys.stderr)
        return 2
    since, until = parse_ts(a.since), parse_ts(a.until)
    if since.tzinfo is None or (until and until.tzinfo is None):
        print("--since/--until need a timezone (Z or +hh:mm)", file=sys.stderr)
        return 2
    data = aggregate(a.project, since, until, a.by)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(data)} {a.by}(s), {sum(e['calls'] for e in data.values())} calls -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
