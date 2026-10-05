import numpy as np

from tabamnesty import laya_probe
from tabamnesty.judge_sim import cold, make_realistic


class FakeLaya:
    """Laya's predict_batch shape, answering from the words the two tabs share."""

    def predict_batch(self, states, questions, batch_size=None):
        (qid, q), = questions.items()
        keys = list(q["criteria"])
        out = []
        for s in states:
            if "tab A" in s:
                wa, wb = set(s["tab A"].lower().split()), set(s["tab B"].lower().split())
                pa = min(0.95, 0.1 + 0.2 * len(wa & wb))
                probs = {"A": pa, "B": 1 - pa}
            else:
                probs = {k: 1 / len(keys) for k in keys}
            out.append({"answers": {qid: {"choice": max(probs, key=probs.get), "probabilities": probs}}})
        return out


class TestLayaProbe:
    def test_state_is_title_host_and_path_only(self):
        t = {"title": "Pricing v3", "host": "figma.com", "pathTokens": ["file", "abc"],
             "digest": {"leadText": "private page text"}}
        assert laya_probe.tab_text(t) == "Pricing v3 (figma.com/file/abc)"

    def test_probe_reports_hard_auc_next_to_free_signals(self):
        traces, labels = make_realistic(0)
        pairs = laya_probe.sample_pairs(cold(traces, 0), labels, per_stratum=30)
        assert {p.stratum for p in pairs} <= set(laya_probe.STRATA)
        p, ms = laya_probe.ask_same(FakeLaya(), pairs)
        r = laya_probe.report(pairs, p)
        for k in ("AUC laya", "AUC free", "AUC combined", "HARD AUC laya", "HARD AUC free"):
            assert 0.0 <= r[k] <= 1.0, (k, r[k])
        assert ms >= 0 and len(p) == len(pairs) == r["pairs"]

    def test_combined_auc_is_out_of_sample(self):
        rng = np.random.default_rng(0)
        y = rng.integers(0, 2, 200)
        noise = rng.random(200)
        assert laya_probe.combined_auc(y, noise, rng.random(200)) < 0.65  # no leakage from fitting
