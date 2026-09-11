"""Deterministic Louvain, identical to src/cluster/louvain.ts.

Why not networkx's: library Louvains shuffle the node order (seeded, but differently in each
library), and on a dense near-uniform graph the local optimum they land in depends on that
order. The parity check showed signal vectors identical to 1e-15 and partitions agreeing only
at ARI 0.77–0.79 on the positive-control fixtures. One algorithm, one order, one tie-break rule
on both sides makes the partitions identical — which is what a parity contract needs.

Algorithm: standard two-phase Louvain (Blondel et al. 2008) with resolution γ.
  - nodes visited in the given order, repeatedly, until a full pass makes no move;
  - a node moves only for a strictly positive gain (> EPS), first-found community wins ties;
  - communities are renumbered by first appearance in node order before aggregation;
  - aggregation sums edge weights in node order so floating-point results match across
    languages bit for bit.
"""
from __future__ import annotations

EPS = 1e-12


def louvain(nodes: list[str], edges: list[tuple[str, str, float]], resolution: float = 1.0) -> list[list[str]]:
    """edges: (a, b, w) with a != b. Returns communities as lists in first-appearance order,
    members in `nodes` order."""
    n = len(nodes)
    index = {v: i for i, v in enumerate(nodes)}
    # canonical edge order: by (min index, max index), so the library that produced them is irrelevant
    canon = sorted(((min(index[a], index[b]), max(index[a], index[b]), w) for a, b, w in edges))
    adj: list[dict[int, float]] = [{} for _ in range(n)]
    for i, j, w in canon:
        adj[i][j] = adj[i].get(j, 0.0) + w
        adj[j][i] = adj[j].get(i, 0.0) + w

    membership = list(range(n))  # original node -> current community id
    cur_nodes = n
    while True:
        moved, com_of = _one_level(adj, resolution)
        # renumber communities by first appearance in node order
        renum: dict[int, int] = {}
        for c in com_of:
            if c not in renum:
                renum[c] = len(renum)
        com_of = [renum[c] for c in com_of]
        membership = [com_of[m] for m in membership]
        if not moved or len(renum) == cur_nodes:
            break
        # aggregate
        cur_nodes = len(renum)
        new_adj: list[dict[int, float]] = [{} for _ in range(cur_nodes)]
        for i in range(len(adj)):
            ci = com_of[i]
            for j, w in adj[i].items():
                cj = com_of[j]
                new_adj[ci][cj] = new_adj[ci].get(cj, 0.0) + w
        adj = new_adj

    groups: dict[int, list[str]] = {}
    for i, c in enumerate(membership):
        groups.setdefault(c, []).append(nodes[i])
    return list(groups.values())


def _one_level(adj: list[dict[int, float]], resolution: float) -> tuple[bool, list[int]]:
    n = len(adj)
    k = [sum(nbrs.values()) for nbrs in adj]  # weighted degree, self-loops included
    m2 = sum(k)
    com = list(range(n))
    if m2 == 0:
        return False, com
    tot = k[:]  # Σ_tot per community
    moved_any = False
    while True:
        moved = False
        for i in range(n):
            ci = com[i]
            ki = k[i]
            # weights from i to each neighbouring community, in adjacency order
            w_to: dict[int, float] = {}
            for j, w in adj[i].items():
                if j == i:
                    continue
                cj = com[j]
                w_to[cj] = w_to.get(cj, 0.0) + w
            tot[ci] -= ki
            best_c = ci
            best_gain = w_to.get(ci, 0.0) - resolution * ki * tot[ci] / m2
            for c, w in w_to.items():
                if c == ci:
                    continue
                gain = w - resolution * ki * tot[c] / m2
                if gain > best_gain + EPS:
                    best_gain, best_c = gain, c
            tot[best_c] += ki
            if best_c != ci:
                com[i] = best_c
                moved = moved_any = True
        if not moved:
            break
    return moved_any, com
