"""Tests for usage_from_logs on a synthetic log tree. Run: python3 -I -m unittest discover -s tools/tests"""
import json, pathlib, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import usage_from_logs as ufl  # noqa: E402


def assistant(req, mid, model, ts, inp=0, out=0, cw5=0, cw1h=0, cr=0):
    return {
        "type": "assistant", "requestId": req, "timestamp": ts, "isSidechain": False,
        "message": {"id": mid, "model": model, "usage": {
            "input_tokens": inp, "output_tokens": out, "cache_read_input_tokens": cr,
            "cache_creation_input_tokens": cw5 + cw1h,
            "cache_creation": {"ephemeral_5m_input_tokens": cw5, "ephemeral_1h_input_tokens": cw1h}}},
    }


class UsageFromLogs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        p = self.project = pathlib.Path(self.tmp.name)
        main = [
            {"type": "user", "timestamp": "2026-10-19T09:00:00Z", "message": {"role": "user"}},
            # one response split over two lines (same requestId and message id): counted once
            assistant("req_1", "msg_1", "claude-opus-5-5", "2026-10-19T09:00:01Z", inp=1000, out=500, cw1h=2000, cr=10000),
            assistant("req_1", "msg_1", "claude-opus-5-5", "2026-10-19T09:00:01Z", inp=1000, out=500, cw1h=2000, cr=10000),
            # before --since: excluded
            assistant("req_0", "msg_0", "claude-opus-5-5", "2026-10-18T09:00:00Z", inp=999999, out=999999),
            # synthetic line is not an API call
            assistant("req_s", "msg_s", "<synthetic>", "2026-10-19T09:00:02Z", inp=5, out=5),
            {"type": "cost-state", "totalCostUSD": 1.0},
        ]
        (p / "s1.jsonl").write_text("\n".join(json.dumps(r) for r in main) + "\n{\"type\": \"assist", encoding="utf-8")
        sub = p / "s1" / "subagents"
        sub.mkdir(parents=True)
        (sub / "agent-a1.jsonl").write_text(
            json.dumps(assistant("req_2", "msg_2", "claude-fable-5-1", "2026-10-19T09:05:00Z", inp=100, out=1000, cw5=4000, cr=20000)) + "\n"
            + json.dumps(assistant("req_3", "msg_3", "claude-unknown-9", "2026-10-19T09:06:00Z", inp=10, out=10)) + "\n",
            encoding="utf-8")
        (sub / "agent-a1.meta.json").write_text(json.dumps({"agentType": "reviewer"}), encoding="utf-8")
        (sub / "agent-a2.jsonl").write_text(
            json.dumps(assistant("req_4", "msg_4", "claude-sonnet-5-5", "2026-10-19T09:07:00Z", inp=50, out=50)) + "\n", encoding="utf-8")
        self.since = ufl.parse_ts("2026-10-19T00:00:00Z")

    def tearDown(self):
        self.tmp.cleanup()

    def test_split_response_keeps_max_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            rows = [
                {"type": "assistant", "requestId": "r1", "timestamp": "2026-10-20T08:00:00Z",
                 "message": {"id": "m1", "model": "claude-opus-5-5", "usage": {"input_tokens": 10, "output_tokens": 1}}},
                {"type": "assistant", "requestId": "r1", "timestamp": "2026-10-20T08:00:01Z",
                 "message": {"id": "m1", "model": "claude-opus-5-5", "usage": {"input_tokens": 10, "output_tokens": 400}}},
            ]
            (d / "s.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
            calls = list(ufl.iter_calls(d))
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][2]["output_tokens"], 400)

    def test_by_role(self):
        d = ufl.aggregate(self.project, self.since)
        self.assertEqual(set(d), {"main", "reviewer", "subagent"})
        m = d["main"]
        self.assertEqual((m["calls"], m["tokens"], m["model"]), (1, 13500, "claude-opus-5-5"))
        # 1000*4 + 2000*4*2 + 10000*0.20 + 500*20 = 32000 per million
        self.assertAlmostEqual(m["cost_usd"], 0.032, places=6)
        r = d["reviewer"]
        self.assertEqual((r["calls"], r["model"]), (2, "claude-fable-5-1"))
        self.assertIsNone(r["cost_usd"], "a model without a price makes the role's cost unknown")
        self.assertEqual(d["subagent"]["model"], "claude-sonnet-5-5")

    def test_by_model_and_cache_write_prices(self):
        d = ufl.aggregate(self.project, self.since, by="model")
        f = d["claude-fable-5-1"]
        # 100*10 + 4000*10*1.25 + 20000*0.25 + 1000*50 = 106000 per million
        self.assertAlmostEqual(f["cost_usd"], 0.106, places=6)
        self.assertNotIn("<synthetic>", d)

    def test_until_and_cli(self):
        d = ufl.aggregate(self.project, self.since, ufl.parse_ts("2026-10-19T09:01:00Z"))
        self.assertEqual(set(d), {"main"})
        out = self.project / "out" / "usage.json"
        rc = ufl.main(["--project", str(self.project), "--since", "2026-10-19T00:00:00Z", "--out", str(out)])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out.read_text())["main"]["tokens"], 13500)
        self.assertEqual(ufl.main(["--project", str(self.project), "--since", "2026-10-19T00:00:00", "--out", str(out)]), 2)


if __name__ == "__main__":
    unittest.main()
