"""Graph + Louvain + partition-to-target. The whole clusterer, end to end.

Louvain, not connected components and not single-link: both chain, so one weak bridge merges
two real projects. Louvain optimises modularity and a lone bridge does not survive that."""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

import networkx as nx

from .config import (MAX_COMMUNITY, RESOLUTION_ITERS, SIGNALS, TARGET_HI, TARGET_LO, W_MIN,
                     load_betas)
from .louvain import louvain
from .signals import Context, affinity, eligible, signal_vector
from .traces import Trace


@dataclass
class Partition:
    communities: list[list[str]]
    loose_ends: list[str]
    resolution: float = 1.0
    excluded: list[str] = field(default_factory=list)  # pinned / ambient / non-http, never scored as ours

    def to_json(self, source: str, betas: dict[str, float]) -> dict:
        return {
            "schemaVersion": 1,
            "source": source,
            "betas": betas,
            "resolution": self.resolution,
            "communities": [{"id": i, "traceIds": c} for i, c in enumerate(self.communities)],
            "looseEnds": self.loose_ends,
            "excluded": self.excluded,
        }


def pair_signals(traces: list[Trace]) -> tuple[Context, dict[tuple[str, str], dict[str, float]]]:
    """Every unordered pair's signal vector. O(n²); fine for a few hundred tabs."""
    ctx = Context(traces)
    vecs = {}
    for a, b in itertools.combinations(traces, 2):
        vecs[(a["traceId"], b["traceId"])] = signal_vector(ctx, a, b)
    return ctx, vecs


def build_graph(traces: list[Trace], betas: dict[str, float], w_min: float = W_MIN,
                vecs: dict[tuple[str, str], dict[str, float]] | None = None) -> nx.Graph:
    if vecs is None:
        _, vecs = pair_signals(traces)
    g = nx.Graph()
    g.add_nodes_from(t["traceId"] for t in traces)
    for (a, b), vec in vecs.items():
        w = affinity(vec, betas)
        if w >= w_min:
            g.add_edge(a, b, weight=w)
    return g


def _louvain(g: nx.Graph, resolution: float) -> list[set[str]]:
    """Our deterministic Louvain (louvain.py), not networkx's — see that file for why."""
    edges = [(a, b, d["weight"]) for a, b, d in g.edges(data=True)]
    return [set(c) for c in louvain(list(g.nodes), edges, resolution)]


def partition_to_target(g: nx.Graph, lo: int = TARGET_LO, hi: int = TARGET_HI,
                        iters: int = RESOLUTION_ITERS) -> tuple[list[set[str]], float]:
    """Binary-search Louvain's resolution (log scale) until the number of real communities
    (size >= 2) lands in [lo, hi]. Group count is a product guarantee, not an algorithm output."""
    lo_r, hi_r = math.log(0.02), math.log(20.0)
    best, best_res, best_gap = None, 1.0, math.inf
    for _ in range(iters):
        mid = (lo_r + hi_r) / 2
        res = math.exp(mid)
        comms = _louvain(g, res)
        n = sum(1 for c in comms if len(c) >= 2)
        gap = 0 if lo <= n <= hi else min(abs(n - lo), abs(n - hi))
        if gap < best_gap or (gap == best_gap and abs(mid) < abs(math.log(best_res))):
            best, best_res, best_gap = comms, res, gap
        if gap == 0:
            break
        if n > hi:
            hi_r = mid  # too many groups -> lower resolution
        else:
            lo_r = mid
    assert best is not None
    return best, best_res


def _induced(g: nx.Graph, nodes: set[str]) -> nx.Graph:
    """Induced subgraph with nodes in the parent graph's order. Not g.subgraph(): a subgraph view
    over a small node set iterates the *set*, so Louvain's tie-breaking — and the partition —
    would depend on PYTHONHASHSEED."""
    h = nx.Graph()
    h.add_nodes_from(n for n in g.nodes if n in nodes)
    h.add_edges_from((a, b, d) for a, b, d in g.edges(data=True) if a in nodes and b in nodes)
    return h


def split_large(g: nx.Graph, comms: list[set[str]], max_size: int = MAX_COMMUNITY) -> list[set[str]]:
    out: list[set[str]] = []
    for c in comms:
        if len(c) <= max_size:
            out.append(c)
            continue
        sub = _louvain(_induced(g, c), 1.0)
        if len(sub) <= 1:  # Louvain will not split it; keep rather than force
            out.append(c)
        else:
            out.extend(split_large(g, sub, max_size))
    return out


def cluster(traces: list[Trace], betas: dict[str, float] | None = None, w_min: float = W_MIN,
            lo: int = TARGET_LO, hi: int = TARGET_HI,
            vecs: dict[tuple[str, str], dict[str, float]] | None = None) -> Partition:
    betas = betas or load_betas()
    kept, excluded = eligible(traces)
    if not kept:
        return Partition([], [], excluded=[t["traceId"] for t in excluded])
    g = build_graph(kept, betas, w_min, vecs)
    comms, res = partition_to_target(g, lo, hi)
    comms = split_large(g, comms)
    order = {t["traceId"]: i for i, t in enumerate(kept)}
    real = sorted((sorted(c, key=order.get) for c in comms if len(c) >= 2),
                  key=lambda c: (-len(c), order[c[0]]))
    loose = sorted((next(iter(c)) for c in comms if len(c) < 2), key=order.get)
    return Partition(real, loose, res, [t["traceId"] for t in excluded])


def ablation_betas(betas: dict[str, float]) -> dict[str, dict[str, float]]:
    """Every beta zeroed one at a time, plus the S1+S2+S8 gate condition together."""
    runs = {"baseline": dict(betas)}
    for s in SIGNALS:
        runs[f"no_{s}"] = {**betas, s: 0.0}
    runs["no_S1_S2_S8"] = {**betas, "S1_lineage": 0.0, "S2_temporal": 0.0, "S8_coactive": 0.0}
    return runs
