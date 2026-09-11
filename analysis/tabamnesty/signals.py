"""The affinity signals S1–S8, N1. One function each, all in [0, 1], plus the weighted sum.

Changing a signal here means changing it in src/cluster/affinity.ts too; `npm run parity`
fails until both agree."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .config import STRIP_TAU, TEMPORAL_TAU_MS, load_ambient
from .lexical import cosine, tfidf_vectors
from .segment import session_index
from .traces import Trace


# ---------------------------------------------------------------------------------------------
# Exclusion — not down-weighting. These belong to every project so they belong to none.
# ---------------------------------------------------------------------------------------------

def is_ambient(t: Trace, ambient: dict[str, set[str]]) -> bool:
    host = (t.get("host") or "").lower()
    if host in ambient["hosts"] or (t.get("eTLD1") or "").lower() in ambient["etld1"]:
        return True
    hp = host + "/" + "/".join(t.get("pathTokens") or [])
    return any(hp.startswith(p) for p in ambient["search_paths"])


def eligible(traces: list[Trace], ambient: dict[str, set[str]] | None = None) -> tuple[list[Trace], list[Trace]]:
    """(kept, excluded). Excluded: pinned, ambient hosts, closed, and non-http URLs."""
    ambient = ambient or load_ambient()
    kept, excluded = [], []
    for t in traces:
        url = t.get("url") or ""
        if (t.get("pinned") or t.get("closedAt") is not None
                or not url.startswith(("http://", "https://")) or is_ambient(t, ambient)):
            excluded.append(t)
        else:
            kept.append(t)
    return kept, excluded


# ---------------------------------------------------------------------------------------------
# Per-corpus context computed once
# ---------------------------------------------------------------------------------------------

@dataclass
class Context:
    traces: list[Trace]
    by_id: dict[str, Trace] = field(init=False)
    parent: dict[str, str | None] = field(init=False)
    depth: dict[str, int] = field(init=False)      # depth in the opener forest
    root: dict[str, str] = field(init=False)       # root of the opener tree
    session: dict[str, int] = field(init=False)
    tfidf: dict[str, dict[str, float]] = field(init=False)
    feats: dict[str, set[str]] = field(init=False)  # S6: path tokens + query key=value

    def __post_init__(self) -> None:
        self.by_id = {t["traceId"]: t for t in self.traces}
        # Lineage may point at a trace outside the eligible set (closed or ambient opener); the
        # tree is still walked through that id so siblings via an excluded parent stay related.
        self.parent = {}
        for t in self.traces:
            p = t.get("openerTraceId")
            self.parent[t["traceId"]] = p if p and p != t["traceId"] else None
        self.depth, self.root = {}, {}
        for tid in list(self.parent):
            self._resolve(tid)
        self.session = session_index(self.traces)
        self.tfidf = tfidf_vectors(self.traces)
        self.feats = {}
        for t in self.traces:
            f = set(t.get("pathTokens") or [])
            f.update(f"{k}={v}" for k, v in (t.get("queryKeys") or {}).items())
            self.feats[t["traceId"]] = f

    def _resolve(self, tid: str) -> None:
        chain: list[str] = []
        cur: str | None = tid
        while cur is not None and cur not in self.depth and cur not in chain:
            chain.append(cur)
            cur = self.parent.get(cur)  # ids outside the corpus have no parent entry -> root
        if cur is not None and cur in self.depth:
            base_depth, base_root = self.depth[cur], self.root[cur]
        else:  # reached a root (or a cycle, cut at the last node so the forest stays a forest)
            base_depth, base_root = -1, chain[-1]
            self.parent[chain[-1]] = None
        for i, node in enumerate(reversed(chain)):
            self.depth[node] = base_depth + 1 + i
            self.root[node] = base_root

    def tree_distance(self, a: str, b: str) -> int | None:
        """Path length between a and b in the opener forest; None if in different trees."""
        if self.root.get(a) != self.root.get(b):
            return None
        anc: dict[str, int] = {}
        cur: str | None = a
        while cur is not None:
            anc[cur] = self.depth.get(cur, 0)
            cur = self.parent.get(cur)
        cur = b
        while cur is not None:
            if cur in anc:  # lowest common ancestor
                return (self.depth[a] - anc[cur]) + (self.depth[b] - self.depth.get(cur, 0))
            cur = self.parent.get(cur)
        return None


# ---------------------------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------------------------

def s1_lineage(ctx: Context, a: Trace, b: Trace) -> float:
    d = ctx.tree_distance(a["traceId"], b["traceId"])
    return 0.0 if d is None else 1.0 / (1.0 + d)


def s2_temporal(a: Trace, b: Trace) -> float:
    return math.exp(-abs(a["openedAt"] - b["openedAt"]) / TEMPORAL_TAU_MS)


def s8_coactive(a: Trace, b: Trace) -> float:
    """Pair count normalised by the smaller activation count: of the times either was
    foregrounded, how often was the other foregrounded within the window."""
    n = (a.get("coActive") or {}).get(b["traceId"], 0) + (b.get("coActive") or {}).get(a["traceId"], 0)
    if n == 0:
        return 0.0
    denom = max(1, min(a.get("activationCount", 0), b.get("activationCount", 0)))
    return min(1.0, n / (2.0 * denom))  # each foregrounding is recorded on both sides


def s3_session(ctx: Context, a: Trace, b: Trace) -> float:
    return 1.0 if ctx.session[a["traceId"]] == ctx.session[b["traceId"]] else 0.0


def s6_path_query(ctx: Context, a: Trace, b: Trace) -> float:
    fa, fb = ctx.feats[a["traceId"]], ctx.feats[b["traceId"]]
    union = len(fa | fb)
    return len(fa & fb) / union if union else 0.0


def s4_strip(a: Trace, b: Trace) -> float:
    if a["windowId"] != b["windowId"]:
        return 0.0
    return math.exp(-abs(a["index"] - b["index"]) / STRIP_TAU)


def s7_lexical(ctx: Context, a: Trace, b: Trace) -> float:
    return cosine(ctx.tfidf[a["traceId"]], ctx.tfidf[b["traceId"]])


def _brand(etld1: str) -> str:
    return etld1.split(".")[0] if etld1 else ""


def s5_domain(a: Trace, b: Trace) -> float:
    ea, eb = (a.get("eTLD1") or "").lower(), (b.get("eTLD1") or "").lower()
    if not ea or not eb:
        return 0.0
    if ea == eb:
        return 1.0
    # sibling: same brand label under a different suffix (github.com / github.io)
    return 0.5 if _brand(ea) == _brand(eb) and len(_brand(ea)) >= 4 else 0.0


def n1_cross_window(a: Trace, b: Trace, s1: float) -> float:
    return 1.0 if a["windowId"] != b["windowId"] and s1 == 0.0 else 0.0


def signal_vector(ctx: Context, a: Trace, b: Trace) -> dict[str, float]:
    s1 = s1_lineage(ctx, a, b)
    return {
        "S1_lineage": s1,
        "S2_temporal": s2_temporal(a, b),
        "S8_coactive": s8_coactive(a, b),
        "S3_session": s3_session(ctx, a, b),
        "S6_path_query": s6_path_query(ctx, a, b),
        "S4_strip": s4_strip(a, b),
        "S7_lexical": s7_lexical(ctx, a, b),
        "S5_domain": s5_domain(a, b),
        "N1_cross_window": n1_cross_window(a, b, s1),
    }


def affinity(vec: dict[str, float], betas: dict[str, float]) -> float:
    return sum(betas[k] * v for k, v in vec.items())
