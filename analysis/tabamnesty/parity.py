"""Parity check: the TS clusterer (what ships) against this bench (where signals change).

Runs tools/cluster-cli.ts on a fixture, computes the same thing here, then compares
  1. every pair's signal vector and affinity, exactly (|diff| <= 1e-9) — the arithmetic must match;
  2. the partitions, by ARI between them (>= MIN_ARI). Both sides run the same deterministic
     Louvain (louvain.py / louvain.ts), so this should be 1.0; anything under MIN_ARI is a bug
     to investigate, never noise to accept.

`check()` is also what `ta-score` / `ta-ablate` / `ta-report` call before scoring a fixture, so
the gate number is never reported without the parity number beside it. `npm run parity` (part
of `npm run check`) runs it over every fixture in fixtures/."""
from __future__ import annotations

import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from sklearn.metrics import adjusted_rand_score

from .cluster import cluster, pair_signals
from .config import FIXTURES, SIGNALS, load_betas
from .score import assignments
from .signals import affinity, eligible
from .traces import load_fixture
from .ts import run_cluster_cli

TOL = 1e-9
MIN_ARI = 0.98


@dataclass
class Parity:
    name: str
    pairs: int
    mismatches: int
    worst: float
    ari: float
    ts_partition: dict
    py_partition: object

    @property
    def ok(self) -> bool:
        return self.mismatches == 0 and self.ari >= MIN_ARI

    def line(self) -> str:
        return (f"parity vs python: ARI {self.ari:.4f} (need >= {MIN_ARI}), "
                f"{self.mismatches}/{self.pairs} signal mismatches (worst |diff| {self.worst:.1e}) "
                f"-> {'OK' if self.ok else 'FAIL'}")


def check(name: str, verbose: bool = False) -> Parity:
    with tempfile.TemporaryDirectory() as td:
        ts_part = run_cluster_cli(name, Path(td) / "ts.partition.json", edges=Path(td) / "ts.edges.json")
        ts_edges = {(e["a"], e["b"]): e for e in json.loads((Path(td) / "ts.edges.json").read_text(encoding="utf-8"))}

    traces = load_fixture(FIXTURES / f"{name}.json")
    betas = load_betas()
    kept, _ = eligible(traces)
    _, vecs = pair_signals(kept)

    bad, worst = 0, 0.0
    if set(vecs) != set(ts_edges):
        if verbose:
            print(f"[{name}] pair sets differ: py {len(vecs)} vs ts {len(ts_edges)} (eligibility mismatch?)")
        bad += 1
    for k, v in vecs.items():
        e = ts_edges.get(k)
        if not e:
            continue
        for s in (*SIGNALS, "w"):
            py = affinity(v, betas) if s == "w" else v[s]
            d = abs(py - e[s])
            worst = max(worst, d)
            if d > TOL:
                if verbose and bad < 5:
                    print(f"[{name}] {s} differs for {k[0][:8]}|{k[1][:8]}: py {py!r} ts {e[s]!r}")
                bad += 1

    py_part = cluster(traces, betas, vecs=vecs)
    universe = [t["traceId"] for t in kept]
    a = assignments(py_part.communities, universe)
    b = assignments([c["traceIds"] for c in ts_part["communities"]], universe)
    ari = adjusted_rand_score([a[u] for u in universe], [b[u] for u in universe]) if len(universe) > 1 else 1.0
    return Parity(name, len(vecs), bad, worst, ari, ts_part, py_part)


def real_fixture_names() -> list[str]:
    """Every fixtures/<name>.json that is a trace export (not .labels / .chrome / .partition / .full)."""
    return sorted(p.stem for p in FIXTURES.glob("*.json") if "." not in p.stem)


def main(argv: list[str] | None = None) -> int:
    names = (argv if argv is not None else sys.argv[1:]) or real_fixture_names()
    if not names:
        print("no fixtures in fixtures/ — nothing to compare")
        return 0
    failed = False
    for name in names:
        p = check(name, verbose=True)
        failed |= not p.ok
        print(f"[{name}] communities py {len(p.py_partition.communities)} ts {len(p.ts_partition['communities'])} | {p.line()}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
