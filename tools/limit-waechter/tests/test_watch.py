"""Unit tests for the pure functions of watch.py.
Run: python3 -I -m unittest discover -s tools/limit-waechter/tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import watch  # noqa: E402

NOW = 1_800_000_000.0


def rec(sid, fh=None, sd=None, ctx=None, ts=NOW, fh_reset=NOW + 3600, sd_reset=NOW + 86400):
    r = {"session_id": sid, "ts": ts, "model": "Fable", "five_hour": None, "seven_day": None, "context_window": None}
    if fh is not None:
        r["five_hour"] = {"used_percentage": fh, "resets_at": fh_reset}
    if sd is not None:
        r["seven_day"] = {"used_percentage": sd, "resets_at": sd_reset}
    if ctx is not None:
        r["context_window"] = {"used_percentage": ctx, "remaining_percentage": 100 - ctx}
    return r


class LadderLevel(unittest.TestCase):
    def test_thresholds(self):
        L = watch.SESSION_LADDER
        self.assertEqual(watch.ladder_level(0, None, L), "ok")
        self.assertEqual(watch.ladder_level(84.9, None, L), "ok")
        self.assertEqual(watch.ladder_level(85, None, L), "session_soft")
        self.assertEqual(watch.ladder_level(94.9, None, L), "session_soft")
        self.assertEqual(watch.ladder_level(95, None, L), "session_hard")
        self.assertEqual(watch.ladder_level(120, None, L), "session_hard")

    def test_hysteresis_keeps_level_until_five_below(self):
        L = watch.SESSION_LADDER
        self.assertEqual(watch.ladder_level(93, "session_hard", L), "session_hard")
        self.assertEqual(watch.ladder_level(90, "session_hard", L), "session_hard")
        self.assertEqual(watch.ladder_level(89.9, "session_hard", L), "session_soft")
        self.assertEqual(watch.ladder_level(80, "session_soft", L), "session_soft")
        self.assertEqual(watch.ladder_level(79.9, "session_soft", L), "ok")

    def test_hysteresis_never_lowers_a_reached_level(self):
        self.assertEqual(watch.ladder_level(96, "session_soft", watch.SESSION_LADDER), "session_hard")

    def test_unknown_value_keeps_prev(self):
        self.assertEqual(watch.ladder_level(None, "week_soft", watch.WEEK_LADDER), "week_soft")
        self.assertEqual(watch.ladder_level(None, None, watch.WEEK_LADDER), "ok")
        self.assertEqual(watch.ladder_level(None, "bogus", watch.WEEK_LADDER), "ok")

    def test_context_ladder(self):
        L = watch.CONTEXT_LADDER
        self.assertEqual(watch.ladder_level(59, None, L), "ok")
        self.assertEqual(watch.ladder_level(60, None, L), "context_hint")
        self.assertEqual(watch.ladder_level(80, None, L), "context_block")
        self.assertEqual(watch.ladder_level(76, "context_block", L), "context_block")
        self.assertEqual(watch.ladder_level(74, "context_block", L), "context_hint")
        self.assertEqual(watch.ladder_level(10, "context_hint", L), "ok")  # after /compact


class Combine(unittest.TestCase):
    def test_priority_order(self):
        self.assertEqual(watch.combine([]), "ok")
        self.assertEqual(watch.combine(["ok", "session_soft"]), "session_soft")
        self.assertEqual(watch.combine(["session_soft", "context_hint"]), "context_hint")
        self.assertEqual(watch.combine(["context_hint", "context_block"]), "context_block")
        self.assertEqual(watch.combine(["context_block", "week_soft"]), "week_soft")
        self.assertEqual(watch.combine(["week_soft", "session_hard"]), "session_hard")
        self.assertEqual(watch.combine(["bogus"]), "ok")


class Aggregate(unittest.TestCase):
    def test_max_over_sessions(self):
        p, r, sid = watch.aggregate_window([rec("a", fh=54), rec("b", fh=58, fh_reset=123)], "five_hour")
        self.assertEqual((p, r, sid), (58.0, 123, "b"))

    def test_absent_window(self):
        self.assertEqual(watch.aggregate_window([rec("a"), rec("b", sd=3)], "five_hour"), (None, None, None))

    def test_pct_tolerates_garbage(self):
        self.assertIsNone(watch.pct(None))
        self.assertIsNone(watch.pct({"used_percentage": "x"}))
        self.assertEqual(watch.pct({"used_percentage": "23.5"}), 23.5)


class ComputeState(unittest.TestCase):
    def test_ok_state(self):
        s = watch.compute_state([rec("a", fh=10, sd=20, ctx=5)], None, NOW)
        self.assertEqual(s["level"], "ok")
        self.assertFalse(s["stale"])
        self.assertEqual(s["sessions"]["a"]["context_level"], "ok")
        self.assertEqual(s["rate"]["five_hour"]["used_percentage"], 10.0)
        self.assertIsNotNone(s["resets_at"])

    def test_session_hard_wins_and_carries_five_hour_reset(self):
        s = watch.compute_state([rec("a", fh=96, sd=99.5, ctx=85, fh_reset=NOW + 100)], None, NOW)
        self.assertEqual(s["level"], "session_hard")
        self.assertEqual(s["resets_at"], watch.iso(NOW + 100))
        self.assertEqual(s["sessions"]["a"]["level"], "session_hard")
        self.assertEqual(s["sessions"]["a"]["context_level"], "context_block")

    def test_week_soft_carries_seven_day_reset(self):
        s = watch.compute_state([rec("a", fh=10, sd=99, sd_reset=NOW + 500)], None, NOW)
        self.assertEqual(s["level"], "week_soft")
        self.assertEqual(s["resets_at"], watch.iso(NOW + 500))

    def test_context_levels_are_per_session(self):
        s = watch.compute_state([rec("a", fh=10, ctx=65), rec("b", fh=12, ctx=10)], None, NOW)
        self.assertEqual(s["level"], "context_hint")
        self.assertEqual(s["sessions"]["a"]["level"], "context_hint")
        self.assertEqual(s["sessions"]["b"]["level"], "ok")

    def test_session_soft_is_informational_but_reported(self):
        s = watch.compute_state([rec("a", fh=86)], None, NOW)
        self.assertEqual(s["level"], "session_soft")

    def test_hysteresis_across_runs(self):
        s1 = watch.compute_state([rec("a", fh=95)], None, NOW)
        s2 = watch.compute_state([rec("a", fh=91)], s1, NOW + 60)
        s3 = watch.compute_state([rec("a", fh=89)], s2, NOW + 120)
        self.assertEqual([s1["level"], s2["level"], s3["level"]], ["session_hard", "session_hard", "session_soft"])

    def test_level_clears_when_reset_has_passed(self):
        s1 = watch.compute_state([rec("a", fh=97, fh_reset=NOW + 30)], None, NOW)
        # the window is dropped by Claude Code after the reset; value unknown, reset passed
        s2 = watch.compute_state([rec("a")], s1, NOW + 60)
        self.assertEqual(s1["level"], "session_hard")
        self.assertEqual(s2["level"], "ok")

    def test_stale_keeps_rate_level_until_reset(self):
        s1 = watch.compute_state([rec("a", fh=97, fh_reset=NOW + 3600)], None, NOW)
        s2 = watch.compute_state([], s1, NOW + 60)
        self.assertTrue(s2["stale"])
        self.assertEqual(s2["level"], "session_hard")
        self.assertEqual(s2["sessions"], {})
        s3 = watch.compute_state([], s2, NOW + 3700)
        self.assertEqual(s3["level"], "ok")

    def test_cached_fallback_only_without_sessions(self):
        cached = {"session_id": "cached", "ts": NOW, "five_hour": {"used_percentage": 96, "resets_at": NOW + 10}}
        s = watch.compute_state([], None, NOW, cached)
        self.assertEqual((s["level"], s["source"]), ("session_hard", "cached"))
        s = watch.compute_state([rec("a", fh=10)], None, NOW, cached)
        self.assertEqual((s["level"], s["source"]), ("ok", "sessions"))


class Transitions(unittest.TestCase):
    def test_global_and_per_session(self):
        s1 = watch.compute_state([rec("a", fh=10, ctx=10)], None, NOW)
        s2 = watch.compute_state([rec("a", fh=96, ctx=65)], s1, NOW + 60)
        t = watch.transitions(s1, s2)
        self.assertIn(("global", "ok", "session_hard"), t)
        self.assertIn(("a", "ok", "context_hint"), t)
        self.assertEqual(watch.transitions(s2, s2), [])

    def test_from_no_previous_state(self):
        s = watch.compute_state([rec("a", fh=86)], None, NOW)
        self.assertEqual(watch.transitions(None, s), [("global", "ok", "session_soft")])


class Delivery(unittest.TestCase):
    def test_due_rate_limit(self):
        self.assertTrue(watch.due({}, "a:x", NOW))
        self.assertFalse(watch.due({"a:x": NOW - 599}, "a:x", NOW))
        self.assertTrue(watch.due({"a:x": NOW - 600}, "a:x", NOW))

    def test_message_text_contains_facts(self):
        s = watch.compute_state([rec("a", fh=96, sd=41, ctx=85)], None, NOW)
        m = watch.message_text(s, "a", "context_block")
        self.assertIn("level context_block", m)
        self.assertIn("Context fill of this session: 85 percent", m)
        self.assertIn("Five-hour window: 96 percent, resets at", m)
        self.assertIn("no new subagents", m)
        m = watch.message_text(s, "global", "session_hard")
        self.assertIn("Stop all subagents", m)
        self.assertNotIn("Context fill", m)


if __name__ == "__main__":
    unittest.main()
