import math

import pytest

from tabamnesty.cluster import ablation_betas, build_graph, cluster, partition_to_target
from tabamnesty.config import load_ambient, load_betas
from tabamnesty.lexical import cosine, tfidf_vectors, tokens
from tabamnesty.score import assignments, score
from tabamnesty.segment import segment
from tabamnesty.signals import (Context, eligible, s1_lineage, s2_temporal, s4_strip, s5_domain,
                                s6_path_query, s8_coactive, signal_vector)
from tabamnesty.synth import chrome_like, make, make_adversarial


def tr(tid, opened=0, opener=None, transition="link", window=1, index=0, host="a.com", etld1=None,
       path=(), title="", pinned=False, url=None, **kw):
    t = {
        "traceId": tid, "tabId": index, "windowId": window, "index": index, "openerTraceId": opener,
        "openedAt": opened, "transition": transition, "backfilled": False, "lastActiveAt": None,
        "activationCount": 0, "dwellMs": 0, "coActive": {}, "url": url or f"https://{host}/" + "/".join(path),
        "host": host, "eTLD1": etld1 or host, "pathTokens": list(path), "queryKeys": {}, "title": title,
        "digest": None, "digestAt": None, "pinned": pinned, "discarded": False, "closedAt": None,
    }
    t.update(kw)
    return t


MIN = 60_000


class TestSegment:
    def test_gap_cuts(self):
        s = segment([tr("a", 0), tr("b", 5 * MIN), tr("c", 40 * MIN)])
        assert [[t["traceId"] for t in x] for x in s] == [["a", "b"], ["c"]]

    def test_new_intent_without_opener_cuts(self):
        s = segment([tr("a", 0), tr("b", 1 * MIN, transition="typed"), tr("c", 2 * MIN, opener="b")])
        assert [[t["traceId"] for t in x] for x in s] == [["a"], ["b", "c"]]

    def test_new_intent_with_opener_does_not_cut(self):
        s = segment([tr("a", 0), tr("b", 1 * MIN, opener="a", transition="typed")])
        assert len(s) == 1

    def test_unknown_is_not_a_boundary(self):
        s = segment([tr("a", 0), tr("b", 1 * MIN, transition="unknown")])
        assert len(s) == 1


class TestSignals:
    def test_lineage_distances(self):
        ts = [tr("root"), tr("c1", opener="root"), tr("c2", opener="root"), tr("g1", opener="c1"), tr("x")]
        ctx = Context(ts)
        by = ctx.by_id
        assert s1_lineage(ctx, by["root"], by["c1"]) == 1 / 2
        assert s1_lineage(ctx, by["c1"], by["c2"]) == 1 / 3      # siblings, distance 2
        assert s1_lineage(ctx, by["g1"], by["c2"]) == 1 / 4      # cousin path, distance 3
        assert s1_lineage(ctx, by["root"], by["x"]) == 0.0

    def test_lineage_through_an_opener_outside_the_corpus(self):
        ts = [tr("c1", opener="gone"), tr("c2", opener="gone")]
        ctx = Context(ts)
        assert s1_lineage(ctx, ts[0], ts[1]) == pytest.approx(1 / 3)

    def test_lineage_cycle_does_not_hang(self):
        ts = [tr("a", opener="b"), tr("b", opener="a")]
        ctx = Context(ts)
        assert s1_lineage(ctx, ts[0], ts[1]) > 0

    def test_temporal(self):
        assert s2_temporal(tr("a", 0), tr("b", 0)) == 1.0
        assert s2_temporal(tr("a", 0), tr("b", 8 * MIN)) == pytest.approx(math.exp(-1))

    def test_strip(self):
        assert s4_strip(tr("a", index=3), tr("b", index=3)) == 1.0
        assert s4_strip(tr("a", index=0), tr("b", index=4)) == pytest.approx(math.exp(-1))
        assert s4_strip(tr("a", window=1), tr("b", window=2)) == 0.0

    def test_domain_and_siblings(self):
        assert s5_domain(tr("a", etld1="github.com"), tr("b", etld1="github.com")) == 1.0
        assert s5_domain(tr("a", etld1="github.com"), tr("b", etld1="github.io")) == 0.5
        assert s5_domain(tr("a", etld1="go.com"), tr("b", etld1="go.dev")) == 0.0   # short brand: no
        assert s5_domain(tr("a", etld1="a.com"), tr("b", etld1="b.com")) == 0.0

    def test_path_query_jaccard(self):
        ts = [tr("a", path=("acme", "deploy"), queryKeys={"tab": "files"}),
              tr("b", path=("acme", "billing"), queryKeys={"tab": "files"})]
        assert s6_path_query(Context(ts), ts[0], ts[1]) == pytest.approx(2 / 4)

    def test_coactive_relative_to_strongest_partner(self):
        a = tr("a", coActive={"b": 2, "c": 5})
        b = tr("b", coActive={"a": 2})
        c = tr("c", coActive={"a": 1})
        ctx = Context([a, b, c])
        assert s8_coactive(ctx, a, c) == pytest.approx(1.0)      # a's strongest partner
        assert s8_coactive(ctx, a, b) == pytest.approx(4 / 6)    # 2+2 vs a's strongest 5+1
        assert s8_coactive(ctx, b, c) == 0.0
        assert s8_coactive(Context([tr("x"), tr("y")]), tr("x"), tr("y")) == 0.0

    def test_vector_keys_match_betas(self):
        ts = [tr("a"), tr("b")]
        assert set(signal_vector(Context(ts), *ts)) == set(load_betas())

    def test_exclusion(self):
        ts = [tr("pin", pinned=True), tr("mail", host="mail.google.com", etld1="google.com"),
              tr("music", host="open.spotify.com", etld1="spotify.com"), tr("new", url="chrome://newtab/"),
              tr("search", host="www.google.com", etld1="google.com", path=("search",)),
              tr("ok", host="github.com")]
        kept, excluded = eligible(ts, load_ambient())
        assert [t["traceId"] for t in kept] == ["ok"]
        assert len(excluded) == 5


class TestLexical:
    def test_tokens_drop_stop_and_numbers(self):
        t = tr("a", title="The Deploy Runbook 42", path=("acme", "deploy"))
        assert tokens(t) == ["deploy", "runbook", "acme", "deploy"]

    def test_cosine_bounds(self):
        ts = [tr("a", title="pandas groupby error"), tr("b", title="pandas groupby dtype"), tr("c", title="lisbon hotel")]
        v = tfidf_vectors(ts)
        assert cosine(v["a"], v["a"]) == pytest.approx(1.0)
        assert cosine(v["a"], v["b"]) > cosine(v["a"], v["c"]) == 0.0


class TestCluster:
    def test_recovers_synthetic_projects(self):
        traces, labels = make(seed=3)
        part = cluster(traces)
        s = score(part.communities, labels, list(labels))
        assert s.ari > 0.75
        assert 3 <= len(part.communities) <= 9 + 2  # target range, plus possible >15 splits
        assert not any(len(c) < 2 for c in part.communities)
        assert set(part.excluded) >= {t["traceId"] for t in traces if t["pinned"]}

    def test_beats_topic_grouping_on_synthetic(self):
        # Not the gate. Just proves the harness can tell the two apart in the intended direction.
        traces, labels = make(seed=5)
        ours = score(cluster(traces).communities, labels).ari
        chrome = score([g["traceIds"] for g in chrome_like(traces)["groups"]], labels).ari
        assert ours > chrome

    def test_partition_to_target_lands_in_range(self):
        traces, _ = make(seed=7, per_project=(6, 8))
        kept, _ = eligible(traces)
        g = build_graph(kept, load_betas())
        comms, _ = partition_to_target(g, 3, 9)
        assert 3 <= sum(1 for c in comms if len(c) >= 2) <= 9

    def test_empty_graph_is_all_loose_ends(self):
        ts = [tr("a", 0, host="a.com", window=1, index=0), tr("b", 10**9, host="b.com", window=2, index=50)]
        part = cluster(ts)
        assert part.communities == [] and sorted(part.loose_ends) == ["a", "b"]

    def test_ablation_runs_cover_every_signal(self):
        runs = ablation_betas(load_betas())
        assert "no_S1_S2_S8" in runs and all(runs[f"no_{s}"][s] == 0.0 for s in load_betas())


class TestScore:
    def test_singleton_convention_is_symmetric(self):
        universe = ["a", "b", "c", "d"]
        labels = {"a": "p", "b": "p", "c": None, "d": None}
        assert assignments([], universe)["c"] != assignments([], universe)["d"]
        assert score([["a", "b"]], labels, universe).ari == pytest.approx(1.0)
        # a partition that groups everything is not rewarded for a junk bucket
        assert score([["a", "b", "c", "d"]], labels, universe).ari < 1.0

    def test_pairwise_prf(self):
        labels = {"a": "p", "b": "p", "c": "p", "d": "q"}
        s = score([["a", "b"], ["c", "d"]], labels, list(labels))
        assert s.precision == pytest.approx(0.5) and s.recall == pytest.approx(1 / 3)


class TestDeterminism:
    def test_same_input_same_partition_across_processes(self):
        # networkx subgraph views iterate node *sets*; a partition must not depend on PYTHONHASHSEED.
        import json
        import subprocess
        import sys
        code = ("import json,sys;from tabamnesty.cluster import cluster;from tabamnesty.synth import make;"
                "t,_=make(seed=11,per_project=(14,20));print(json.dumps(cluster(t).communities))")
        outs = {subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                               env={"PYTHONHASHSEED": str(i), "PATH": __import__('os').environ['PATH'],
                                    "SYSTEMROOT": __import__('os').environ.get('SYSTEMROOT', '')},
                               cwd=__import__('pathlib').Path(__file__).resolve().parents[1]).stdout for i in (1, 2, 3)}
        assert len(outs) == 1, "partition varies with PYTHONHASHSEED"


class TestAblationPositiveControls:
    """Fixtures where projects are distinguishable by ONE behavioural signal. If zeroing that
    signal does not drop ARI, the ablation cannot detect anything and a flat real-browser
    ablation would be uninterpretable. Mechanics only; never counts toward the gate."""

    @staticmethod
    def _ari(kind: str, betas: dict[str, float]) -> float:
        traces, labels = make_adversarial(kind)
        return score(cluster(traces, betas).communities, labels).ari

    def test_lineage_is_detected(self):
        b = load_betas()
        full, zero = self._ari("lineage", b), self._ari("lineage", {**b, "S1_lineage": 0.0})
        assert full - zero >= 0.10, (full, zero)

    def test_coactivation_is_detected(self):
        b = load_betas()
        full, zero = self._ari("coactive", b), self._ari("coactive", {**b, "S8_coactive": 0.0})
        assert full > 0.6 and full - zero >= 0.30, (full, zero)

    def test_temporal_is_detected_only_together_with_session(self):
        # S3 (same session) is cut from the same timestamps S2 decays over, so the two are
        # redundant evidence: zeroing S2 alone leaves S3 carrying the boundary. Report this when
        # reading the gate's "zero S1/S2/S8" condition — S3 still stands in that run.
        b = load_betas()
        full = self._ari("temporal", b)
        zero_s2 = self._ari("temporal", {**b, "S2_temporal": 0.0})
        zero_both = self._ari("temporal", {**b, "S2_temporal": 0.0, "S3_session": 0.0})
        assert full > 0.95 and zero_s2 > 0.95 and full - zero_both >= 0.5, (full, zero_s2, zero_both)
