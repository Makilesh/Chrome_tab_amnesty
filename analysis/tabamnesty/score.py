"""Scoring against hand labels. sklearn is the reference implementation; nothing is hand-rolled.

UNGROUPED CONVENTION: each ungrouped / loose-end tab is its own singleton cluster, applied
identically to both partitions. Never excluded, never lumped into one junk cluster."""
from __future__ import annotations

from dataclasses import dataclass

from sklearn.metrics import adjusted_rand_score
from sklearn.metrics.cluster import pair_confusion_matrix

CONVENTION = ("ungrouped convention: each ungrouped / loose-end tab is its own singleton cluster, "
              "applied identically to both partitions")


def assignments(groups: list[list[str]], universe: list[str]) -> dict[str, str]:
    """traceId -> cluster label over `universe`; anything not in a group is a singleton."""
    out = {tid: f"single:{tid}" for tid in universe}
    for i, g in enumerate(groups):
        for tid in g:
            if tid in out:
                out[tid] = f"g{i}"
    return out


def truth_assignments(labels: dict[str, str | None]) -> dict[str, str]:
    return {tid: (f"p:{p}" if p else f"single:{tid}") for tid, p in labels.items()}


@dataclass
class Score:
    ari: float
    precision: float
    recall: float
    f1: float
    n_groups: int
    n_placed: int
    n_tabs: int

    def row(self) -> dict:
        return {"ARI": round(self.ari, 4), "P": round(self.precision, 3), "R": round(self.recall, 3),
                "F1": round(self.f1, 3), "groups": self.n_groups, "placed": self.n_placed, "tabs": self.n_tabs}


def score(groups: list[list[str]], labels: dict[str, str | None], universe: list[str] | None = None) -> Score:
    universe = universe or list(labels)
    truth = truth_assignments(labels)
    pred = assignments(groups, universe)
    t = [truth[u] for u in universe]
    p = [pred[u] for u in universe]
    ari = adjusted_rand_score(t, p) if len(universe) > 1 else 0.0
    (tn, fp), (fn, tp) = pair_confusion_matrix(t, p) if len(universe) > 1 else ((0, 0), (0, 0))
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    placed = {tid for g in groups for tid in g if len(g) >= 2 and tid in pred}
    return Score(ari, prec, rec, f1, sum(1 for g in groups if len(g) >= 2), len(placed), len(universe))


def placed_by_both(a: list[list[str]], b: list[list[str]], universe: list[str]) -> list[str]:
    pa = {tid for g in a if len(g) >= 2 for tid in g}
    pb = {tid for g in b if len(g) >= 2 for tid in g}
    return [u for u in universe if u in pa and u in pb]


def chrome_groups(chrome: dict) -> list[list[str]]:
    return [list(g["traceIds"]) for g in chrome["groups"]]
