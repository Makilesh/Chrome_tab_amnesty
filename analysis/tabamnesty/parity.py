"""Parity check: the TS clusterer (what ships) against this bench (where signals change).

Runs tools/cluster-cli.ts on a fixture, computes the same thing here, then compares
  1. every pair's signal vector and affinity, exactly (|diff| <= 1e-9) — the arithmetic must match;
  2. the partitions, by ARI between them (>= 0.90) — Louvain implementations differ in tie-breaking
     and random order, so exact community equality is not required, but they must agree.
Exit code 1 on any mismatch. `npm run parity` wraps this."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from sklearn.metrics import adjusted_rand_score

from .cluster import cluster, pair_signals
from .config import FIXTURES, REPO, SIGNALS, load_betas
from .score import assignments
from .signals import affinity, eligible
from .traces import load_fixture

TOL = 1e-9
MIN_ARI = 0.90


def run_ts(name: str, out: Path, edges: Path) -> dict:
    cmd = ["npx", "tsx", "tools/cluster-cli.ts", name, "--out", str(out), "--edges", str(edges)]
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, shell=sys.platform == "win32")
    if r.returncode != 0:
        print(r.stdout, r.stderr, file=sys.stderr)
        raise SystemExit(f"TS cluster CLI failed for {name}")
    return json.loads(out.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    names = (argv if argv is not None else sys.argv[1:]) or ["synthetic"]
    failed = False
    for name in names:
        with tempfile.TemporaryDirectory() as td:
            ts_part = run_ts(name, Path(td) / "ts.partition.json", Path(td) / "ts.edges.json")
            ts_edges = {(e["a"], e["b"]): e for e in json.loads((Path(td) / "ts.edges.json").read_text(encoding="utf-8"))}

        traces = load_fixture(FIXTURES / f"{name}.json")
        betas = load_betas()
        kept, _ = eligible(traces)
        _, vecs = pair_signals(kept)

        # 1. signals + weights, exactly
        bad = 0
        worst = 0.0
        if set(vecs) != set(ts_edges):
            print(f"[{name}] pair sets differ: py {len(vecs)} vs ts {len(ts_edges)} (eligibility mismatch?)")
            bad += 1
        for k, v in vecs.items():
            e = ts_edges.get(k)
            if not e:
                continue
            for s in SIGNALS:
                d = abs(v[s] - e[s])
                worst = max(worst, d)
                if d > TOL:
                    if bad < 5:
                        print(f"[{name}] {s} differs for {k[0][:8]}|{k[1][:8]}: py {v[s]!r} ts {e[s]!r}")
                    bad += 1
            d = abs(affinity(v, betas) - e["w"])
            worst = max(worst, d)
            if d > TOL:
                if bad < 5:
                    print(f"[{name}] affinity differs for {k[0][:8]}|{k[1][:8]}: py {affinity(v, betas)!r} ts {e['w']!r}")
                bad += 1

        # 2. partitions agree
        py_part = cluster(traces, betas, vecs=vecs)
        universe = [t["traceId"] for t in kept]
        a = assignments(py_part.communities, universe)
        b = assignments([c["traceIds"] for c in ts_part["communities"]], universe)
        ari = adjusted_rand_score([a[u] for u in universe], [b[u] for u in universe])

        ok = bad == 0 and ari >= MIN_ARI
        failed |= not ok
        print(f"[{name}] pairs {len(vecs)} | signal/weight mismatches {bad} (worst |diff| {worst:.2e}) | "
              f"communities py {len(py_part.communities)} ts {len(ts_part['communities'])} | "
              f"partition ARI {ari:.4f} (need >= {MIN_ARI}) -> {'OK' if ok else 'FAIL'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
