import numpy as np
from sklearn.metrics import roc_auc_score

from tabamnesty.judge_sim import Judge, cold, make_realistic, merge_groups, browser


class TestJudgeSim:
    def test_simulated_judge_hits_its_target_auc(self):
        # The whole sweep is indexed by this number, so it has to mean what it says.
        labels = {f"t{i}": f"p{i % 6}" for i in range(120)}
        ids = list(labels)
        pairs = [(a, b) for i, a in enumerate(ids) for b in ids[i + 1:]]
        y = [int(labels[a] == labels[b]) for a, b in pairs]
        for auc in (0.7, 0.9):
            j = Judge(auc, rho=0.0, seed=1)
            assert abs(roc_auc_score(y, [j.pair(a, b, labels) for a, b in pairs]) - auc) < 0.02

    def test_generated_browser_is_deterministic_and_has_one_offs(self):
        a, la = make_realistic(3)
        b, lb = make_realistic(3)
        assert [t["traceId"] for t in a] == [t["traceId"] for t in b] and la == lb
        assert None in la.values() and len({v for v in la.values() if v}) == 9

    def test_cold_start_keeps_only_what_install_day_has(self):
        traces, _ = make_realistic(1)
        c = cold(traces, 1)
        assert all(t["openerTraceId"] is None and t["coActive"] == {} and t["digest"] is None for t in c)
        assert all(t["backfilled"] for t in c)

    def test_merge_needs_confidence_and_never_chains(self):
        traces, labels = make_realistic(2)
        b = browser(traces, labels)
        groups = [[t] for t in b.kept[:12]]
        merged = merge_groups([g * 2 for g in groups], b, Judge(0.6, rho=0.0, seed=4))
        assert all(len(g) <= 4 for g in merged)  # at most one merge per group
        perfect = merge_groups(groups, b, Judge(1.0, rho=0.0, seed=4))
        assert all(len({labels[t] for t in g}) == 1 for g in perfect if all(labels[t] for t in g))
