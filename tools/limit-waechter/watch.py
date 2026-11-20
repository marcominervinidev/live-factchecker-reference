#!/usr/bin/env python3
"""Limit watcher (Limit-Waechter) for Claude Code sessions. Task #54 of the planning repo.

Deterministic script, no agent, no model call. launchd runs it every 60 s (com.lfc.limit-waechter).

Inputs
  <HOME>/sessions/<session_id>.json   written by statusline.sh on every status-line refresh
  ~/.claude.json cachedUsageUtilization fallback when no session file is fresh (undocumented, best effort)
  <HOME>/state.json                   previous state, for hysteresis and transition detection
  ~/.claude/sessions/<pid>.json       Claude Code's own session registry: live sessions and their inbox sockets

Outputs
  <HOME>/state.json   contract of .claude/hooks/limit-guard.sh and context-hint.sh:
                      level, resets_at, sessions{<sid>: {level, context_level, ...}}, updated_at
  <HOME>/events.log   one line per level transition and per delivery attempt
  <HOME>/sent.json    last delivery time per (target, level), rate limit 10 min
  inbox socket        plain-text message to the affected session(s) on a transition (optional)
  osascript           macOS notification on a transition (optional)

HOME is ${LIMIT_WAECHTER_HOME:-~/.claude/limit-waechter}. Python 3.9+ stdlib only; run with python3 -I.
"""
import argparse
import datetime as dt
import glob
import json
import os
import socket
import subprocess
import sys
import tempfile
import time

HOME = os.environ.get("LIMIT_WAECHTER_HOME") or os.path.join(os.path.expanduser("~"), ".claude", "limit-waechter")
REGISTRY = os.environ.get("LIMIT_WAECHTER_REGISTRY") or os.path.join(os.path.expanduser("~"), ".claude", "sessions")
CLAUDE_JSON = os.environ.get("LIMIT_WAECHTER_CLAUDE_JSON") or os.path.join(os.path.expanduser("~"), ".claude.json")

SESSION_MAX_AGE = 15 * 60      # session files older than this are ignored
CACHE_MAX_AGE = 60 * 60        # cachedUsageUtilization older than this is ignored
HYSTERESIS = 5.0               # a level clears only this many points below its threshold
REPEAT_SECONDS = 10 * 60       # same (target, level) is delivered at most once per 10 min
SOCKET_TIMEOUT = 5.0

# Ladders: ascending (level, threshold). A value >= threshold reaches the level.
SESSION_LADDER = (("session_soft", 85.0), ("session_hard", 95.0))
WEEK_LADDER = (("week_soft", 99.0),)
CONTEXT_LADDER = (("context_hint", 60.0), ("context_block", 80.0))

# Global priority, highest first. "ok" is the floor.
PRIORITY = ("session_hard", "week_soft", "context_block", "context_hint", "session_soft", "ok")

ACTION = {
    "session_hard": "No new subagents. Stop all subagents, write the state to the issue, schedule the continuation on the reset minute, halt (CLAUDE.md, Limit watcher).",
    "week_soft": "No new subagents. Give each subagent a deadline, collect the reports, write the state to the issue, plan the continuation for the weekly reset (CLAUDE.md, Limit watcher).",
    "context_block": "Context fill at or above 80 percent: no new subagents. Write the open points as an issue comment, then compact.",
    "context_hint": "Context fill at or above 60 percent: write the open points as an issue comment, then compact.",
    "session_soft": "Five-hour window at or above 85 percent: finish started work, start nothing large; hard stop follows at 95.",
    "ok": "Level cleared, normal work may continue.",
}


# ---------------------------------------------------------------- pure functions (unit-tested)

def rank(level):
    """Lower number = higher priority. Unknown levels rank as ok."""
    return PRIORITY.index(level) if level in PRIORITY else PRIORITY.index("ok")


def combine(levels):
    """Highest-priority level of an iterable; 'ok' for an empty one."""
    best = "ok"
    for lv in levels:
        if rank(lv) < rank(best):
            best = lv
    return best


def ladder_level(value, prev, ladder, hysteresis=HYSTERESIS):
    """Level for a percentage on a ladder with hysteresis.

    value: float or None (unknown). prev: previous level on this ladder or None/'ok'.
    A previously reached level is kept while value >= its threshold - hysteresis.
    An unknown value keeps prev (the caller decides whether prev is still valid).
    """
    names = [name for name, _ in ladder]
    thr = dict(ladder)
    if value is None:
        return prev if prev in names else "ok"
    candidate = "ok"
    for name, t in ladder:
        if value >= t:
            candidate = name
    if prev in names:
        prev_i = names.index(prev)
        cand_i = names.index(candidate) if candidate in names else -1
        if prev_i > cand_i and value >= thr[prev] - hysteresis:
            return prev
    return candidate


def pct(obj, key="used_percentage"):
    """Float of obj[key] or None when the window or the field is absent."""
    if not isinstance(obj, dict):
        return None
    v = obj.get(key)
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def aggregate_window(records, key):
    """Max used_percentage over fresh session records for a rate window.

    Returns (percentage or None, resets_at epoch or None, session_id of the max or None).
    Per-terminal values drift (issue #75408), so the maximum is the safe reading.
    """
    best = (None, None, None)
    for rec in records:
        p = pct(rec.get(key))
        if p is None:
            continue
        if best[0] is None or p > best[0]:
            r = rec.get(key, {}).get("resets_at")
            best = (p, r if isinstance(r, (int, float)) else None, rec.get("session_id"))
    return best


def reset_passed(epoch, now):
    return epoch is not None and float(epoch) <= now


def window_state(records, key, prev_window, ladder, now):
    """State of one rate window (five_hour or seven_day) with hysteresis against prev_window.

    A previous level stays valid only until its window reset has passed. When the window is
    absent in every record, the previous reset time is carried while the level is held.
    """
    value, reset, sid = aggregate_window(records, key)
    prev_level = prev_window.get("level")
    prev_reset = prev_window.get("resets_at_epoch")
    if reset_passed(prev_reset, now):
        prev_level = None
    if value is None and reset is None and prev_level:
        reset = prev_reset
    level = ladder_level(value, prev_level, ladder)
    return {"used_percentage": value, "resets_at_epoch": reset,
            "resets_at": iso(reset) if reset is not None else None,
            "level": level, "from_session": sid}


def session_entry(rec, prev_entry, rate_levels, now):
    """Per-session entry: context level with hysteresis, combined level, display facts."""
    ctx = pct(rec.get("context_window") or {})
    ctx_level = ladder_level(ctx, prev_entry.get("context_level"), CONTEXT_LADDER)
    return {
        "context_percentage": ctx,
        "context_level": ctx_level,
        "level": combine(list(rate_levels) + [ctx_level]),
        "five_hour": pct(rec.get("five_hour")),
        "seven_day": pct(rec.get("seven_day")),
        "model": rec.get("model"),
        "cwd": rec.get("cwd"),
        "age_s": int(now - float(rec.get("ts", now))),
    }


def resets_for(level, fh, sd):
    """Reset epoch the hook shows for a level: the window that caused it, else the nearest known."""
    if level in ("session_hard", "session_soft"):
        return fh["resets_at_epoch"]
    if level == "week_soft":
        return sd["resets_at_epoch"]
    return fh["resets_at_epoch"] if fh["resets_at_epoch"] is not None else sd["resets_at_epoch"]


def compute_state(records, prev, now, cached=None):
    """Compute the new state from fresh session records and the previous state.

    records: list of session dicts as statusline.sh writes them (already filtered to fresh ones).
    prev: previous state dict or None. now: epoch seconds. cached: fallback dict with
    five_hour/seven_day like a record, used only when records is empty.
    Returns the new state dict (JSON-serialisable).
    """
    prev = prev or {}
    prev_rate = prev.get("rate", {})
    rate_records, source = (records, "sessions") if records or not cached else ([cached], "cached")
    stale = not rate_records

    fh = window_state(rate_records, "five_hour", prev_rate.get("five_hour", {}), SESSION_LADDER, now)
    sd = window_state(rate_records, "seven_day", prev_rate.get("seven_day", {}), WEEK_LADDER, now)
    rate_levels = (fh["level"], sd["level"])

    prev_sessions = prev.get("sessions", {})
    sessions = {}
    for rec in records:
        sid = rec.get("session_id") or "unknown"
        sessions[sid] = session_entry(rec, prev_sessions.get(sid, {}), rate_levels, now)

    level = combine(list(rate_levels) + [s["context_level"] for s in sessions.values()])
    resets_epoch = resets_for(level, fh, sd)
    return {
        "updated_at": iso(now),
        "level": level,
        "resets_at": iso(resets_epoch) if resets_epoch is not None else None,
        "stale": stale,
        "source": "none" if stale else source,
        "rate": {"five_hour": fh, "seven_day": sd},
        "sessions": sessions,
    }


def transitions(prev, new):
    """List of (scope, old_level, new_level); scope is 'global' or a session_id.

    Per-session entries report changes of the session's own context level only, since the
    global level already carries the rate levels.
    """
    out = []
    prev = prev or {}
    old_g = prev.get("level", "ok")
    new_g = new.get("level", "ok")
    if old_g != new_g:
        out.append(("global", old_g, new_g))
    old_s = prev.get("sessions", {})
    for sid, s in new.get("sessions", {}).items():
        o = old_s.get(sid, {}).get("context_level", "ok")
        n = s.get("context_level", "ok")
        if o != n:
            out.append((sid, o, n))
    return out


def message_text(new, scope, level):
    """Plain facts for a session; the rule in CLAUDE.md says what to do."""
    r = new.get("rate", {})
    fh, sd = r.get("five_hour", {}), r.get("seven_day", {})
    parts = ["Limit watcher: level %s." % level]
    if level in ("context_hint", "context_block") and scope in new.get("sessions", {}):
        c = new["sessions"][scope].get("context_percentage")
        parts.append("Context fill of this session: %s percent." % fmt_pct(c))
    parts.extend([
        "Five-hour window: %s percent%s." % (fmt_pct(fh.get("used_percentage")), fmt_reset(fh.get("resets_at"))),
        "Seven-day window: %s percent%s." % (fmt_pct(sd.get("used_percentage")), fmt_reset(sd.get("resets_at"))),
        ACTION.get(level, ""),
    ])
    return " ".join(p for p in parts if p)


def due(sent, key, now, repeat=REPEAT_SECONDS):
    """True when (target, level) was not delivered within the repeat window."""
    last = sent.get(key)
    return last is None or now - float(last) >= repeat


def fmt_pct(v):
    return "unknown" if v is None else ("%d" % round(v))


def fmt_reset(s):
    return "" if not s else ", resets at %s" % s


def iso(epoch):
    return dt.datetime.fromtimestamp(float(epoch)).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- I/O

def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_atomic(path, data):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def log(line):
    try:
        os.makedirs(HOME, exist_ok=True)
        with open(os.path.join(HOME, "events.log"), "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (iso(time.time()), line))
    except OSError:
        pass


def load_records(now):
    """Fresh session records from <HOME>/sessions; stale ones are deleted after 24 h."""
    recs = []
    for p in sorted(glob.glob(os.path.join(HOME, "sessions", "*.json"))):
        rec = read_json(p)
        if not isinstance(rec, dict):
            continue
        try:
            age = now - float(rec.get("ts", 0))
        except (TypeError, ValueError):
            continue
        if age <= SESSION_MAX_AGE:
            recs.append(rec)
        elif age > 24 * 3600:
            try:
                os.unlink(p)
            except OSError:
                pass
    return recs


def parse_reset(value):
    """resets_at of cachedUsageUtilization: ISO string or epoch -> epoch seconds or None."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def load_cached(now):
    """Fallback from ~/.claude.json cachedUsageUtilization (undocumented; best effort)."""
    data = read_json(CLAUDE_JSON)
    c = data.get("cachedUsageUtilization") if isinstance(data, dict) else None
    if not isinstance(c, dict):
        return None
    try:
        fetched = float(c.get("fetchedAtMs", 0)) / 1000.0
    except (TypeError, ValueError):
        return None
    if now - fetched > CACHE_MAX_AGE:
        return None
    out = {"session_id": "cached", "ts": fetched}
    kinds = {"session": "five_hour", "weekly_all": "seven_day"}
    for lim in (c.get("utilization") or {}).get("limits") or []:
        key = kinds.get(lim.get("kind")) if isinstance(lim, dict) else None
        if key:
            out[key] = {"used_percentage": lim.get("percent"), "resets_at": parse_reset(lim.get("resets_at"))}
    return out if ("five_hour" in out or "seven_day" in out) else None


def live_sessions():
    """{session_id: socket_path} for sessions in Claude Code's registry whose process is alive."""
    out = {}
    for p in glob.glob(os.path.join(REGISTRY, "*.json")):
        r = read_json(p)
        if not isinstance(r, dict):
            continue
        sid, pid, sock = r.get("sessionId"), r.get("pid"), r.get("messagingSocketPath")
        if not (sid and sock and isinstance(pid, int)):
            continue
        try:
            os.kill(pid, 0)
        except OSError:
            continue
        if os.path.exists(sock):
            out[sid] = sock
    return out


def send_socket(sock_path, text):
    """Post a plain-text message into a session's inbox socket.

    Wire format taken from Claude Code's own debug line in the CLI binary (2.1.285):
      { echo '{"type":"auth","token":"..."}'; echo '{"type":"user","message":{"role":"user","content":"hello"}}'; } | socat - UNIX-CONNECT:<socket>
    The auth line is optional on macOS and omitted here (the token of another session is not ours).
    """
    line = json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n"
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(SOCKET_TIMEOUT)
    try:
        s.connect(sock_path)
        s.sendall(line.encode("utf-8"))
        try:
            s.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        try:
            reply = s.recv(4096)
        except (socket.timeout, OSError):
            reply = b""
        return reply.decode("utf-8", "replace").strip()
    finally:
        s.close()


def notify(title, text):
    """macOS notification via osascript; failures are logged, never fatal."""
    def q(x):
        return x.replace("\\", "\\\\").replace('"', '\\"')
    try:
        subprocess.run(["osascript", "-e", 'display notification "%s" with title "%s"' % (q(text[:200]), q(title))],
                       check=False, timeout=10, capture_output=True)
    except (OSError, subprocess.SubprocessError) as e:
        log("notify failed: %s" % e)


def socket_targets(scope, live):
    """Sessions to message for a transition: all live ones globally, only the own one for context."""
    if scope == "global":
        return list(live.keys())
    return [scope] if scope in live else []


def post_to_sessions(targets, live, lvl, text, sent, now):
    """Socket delivery to each due target; returns True when sent.json changed."""
    changed = False
    for sid in targets:
        key = "%s:%s" % (sid, lvl)
        if not due(sent, key, now):
            continue
        try:
            reply = send_socket(live[sid], text)
            log("socket %s level %s sent (reply: %s)" % (sid, lvl, reply or "none"))
        except OSError as e:
            log("socket %s level %s failed: %s" % (sid, lvl, e))
        sent[key] = now
        changed = True
    return changed


def deliver(prev, new, now, dry_run):
    """State file is written by the caller; this handles socket, notification and the log."""
    sent_path = os.path.join(HOME, "sent.json")
    sent = read_json(sent_path) or {}
    use_socket = os.environ.get("LIMIT_WAECHTER_SOCKET", "on") != "off" and not dry_run
    use_notify = os.environ.get("LIMIT_WAECHTER_NOTIFY", "on") != "off" and not dry_run
    live = live_sessions() if use_socket else {}
    changed = False
    for scope, old, lvl in transitions(prev, new):
        log("transition %s: %s -> %s" % (scope, old, lvl))
        text = message_text(new, scope, lvl)
        if dry_run:
            print("DRY-RUN transition %s: %s -> %s | %s" % (scope, old, lvl, text), file=sys.stderr)
        changed = post_to_sessions(socket_targets(scope, live), live, lvl, text, sent, now) or changed
        nkey = "notify:%s:%s" % (scope, lvl)
        if use_notify and lvl != "ok" and due(sent, nkey, now):
            notify("Limit-Waechter: %s" % lvl, text)
            sent[nkey] = now
            changed = True
    if changed:
        try:
            write_atomic(sent_path, sent)
        except OSError as e:
            log("sent.json write failed: %s" % e)


def run(dry_run=False):
    now = time.time()
    state_path = os.path.join(HOME, "state.json")
    prev = read_json(state_path)
    records = load_records(now)
    cached = load_cached(now) if not records else None
    new = compute_state(records, prev, now, cached)
    try:
        write_atomic(state_path, new)
    except OSError as e:
        print("limit-waechter: cannot write %s: %s" % (state_path, e), file=sys.stderr)
        return 1
    deliver(prev, new, now, dry_run)
    if dry_run:
        json.dump(new, sys.stdout, indent=1, sort_keys=True)
        print()
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Limit watcher: aggregate session files, write state.json, deliver on transitions.")
    ap.add_argument("--dry-run", action="store_true", help="write state.json but send no socket message and no notification; print the state on stdout, transitions on stderr")
    ap.add_argument("--send-test", nargs=2, metavar=("SOCKET", "TEXT"), help="post TEXT into SOCKET once and print the reply (to verify the wire format)")
    a = ap.parse_args(argv)
    if a.send_test:
        try:
            print("reply: %r" % send_socket(a.send_test[0], a.send_test[1]))
            return 0
        except OSError as e:
            print("send failed: %s" % e, file=sys.stderr)
            return 1
    return run(dry_run=a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
