"""Refit the affinity weights from hand-labelled pairs: a calibrated P(same project | S1..N1).

  ta-refit <name>... [--C 1.0] [--out fixtures/refit.betas.json]

This is the typed-decision idea behind Jev/Laya ("answer one fixed question with a calibrated
probability, trained on a proper scoring rule") at the size of our problem: ten numbers, not
421M parameters. See docs/research-jev-laya.md.

Pair signals come from the shipped clusterer (tools/cluster-cli.ts --edges). A pair is positive
when both tabs carry the same non-null hand label; pairs with an unlabelled tab are skipped.
Logistic regression gives logit P = b0 + sum(beta_i * s_i); the betas are rescaled by W_MIN / -b0
so that affinity >= W_MIN exactly where P(same project) >= 0.5 — the graph then keeps the edges
the model believes in, and Louvain's modularity is unchanged by the scale.

Evaluation is leave-one-browser-out: each fixture is scored with betas fit on the OTHER fixtures
(held-out log loss and Brier against a base-rate predictor, and the TS partition's ARI with those
betas next to the shipped ones). Only that column is evidence. With one fixture there is nothing
to hold out and the output says so. src/cluster/betas.json is never written: adopting refit
betas is the user's decision, logged in docs/DECISIONS.md.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss

from .config import FIXTURES, SIGNALS, W_MIN, load_betas
from .score import score
from .traces import load_labels
from .ts import groups_of, run_cluster_cli

OUT = FIXTURES / "refit.betas.json"


@dataclass
class Pairs:
    name: str
    x: np.ndarray  # (pairs, len(SIGNALS)), columns in SIGNALS order
    y: np.ndarray  # 1 = both tabs carry the same hand label
    labels: dict[str, str | None]
    shipped: dict | None = None  # TS partition with the shipped betas


def pairs_from_rows(name: str, rows: list[dict], labels: dict[str, str | None]) -> Pairs:
    rows = [r for r in rows if r["a"] in labels and r["b"] in labels]
    x = np.array([[r[s] for s in SIGNALS] for r in rows], dtype=float).reshape(-1, len(SIGNALS))
    y = np.array([int(labels[r["a"]] is not None and labels[r["a"]] == labels[r["b"]]) for r in rows], dtype=int)
    return Pairs(name, x, y, labels)


def load_pairs(name: str, work: Path) -> Pairs:
    labels = load_labels(FIXTURES / f"{name}.labels.json")
    part = run_cluster_cli(name, work / f"{name}.partition.json", edges=work / f"{name}.edges.json")
    p = pairs_from_rows(name, json.loads((work / f"{name}.edges.json").read_text(encoding="utf-8")), labels)
    p.shipped = part
    return p


@dataclass
class Fit:
    intercept: float
    coef: dict[str, float]
    model: LogisticRegression

    def betas(self) -> dict[str, float]:
        """Scaled so that affinity >= W_MIN exactly where P(same project) >= 0.5."""
        if self.intercept >= 0:
            raise ValueError(f"intercept {self.intercept:+.3f} >= 0: a pair with no evidence at all would be "
                             "predicted 'same project', so no threshold on affinity matches P = 0.5. "
                             "Check the labels (one giant project?).")
        k = W_MIN / -self.intercept
        return {s: self.coef[s] * k for s in SIGNALS}

    def proba(self, x: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(x)[:, 1]


def fit(sets: list[Pairs], c: float = 1.0) -> Fit:
    x = np.vstack([p.x for p in sets])
    y = np.concatenate([p.y for p in sets])
    if len(set(y.tolist())) < 2:
        raise ValueError("need both same-project and different-project pairs to fit")
    m = LogisticRegression(C=c, max_iter=5000).fit(x, y)
    return Fit(float(m.intercept_[0]), {s: float(v) for s, v in zip(SIGNALS, m.coef_[0])}, m)


def held_out(test: Pairs, train: list[Pairs], c: float, work: Path) -> dict:
    """Score `test` with betas it never saw."""
    f = fit(train, c)
    p = f.proba(test.x)
    base = np.full(len(test.y), np.concatenate([t.y for t in train]).mean())
    betas_path = work / f"{test.name}.heldout.betas.json"
    betas_path.write_text(json.dumps(f.betas()), encoding="utf-8")
    part = run_cluster_cli(test.name, work / f"{test.name}.heldout.partition.json", betas=betas_path)
    return {
        "fixture": test.name,
        "pairs": len(test.y),
        "same": int(test.y.sum()),
        "log loss": log_loss(test.y, p, labels=[0, 1]),
        "log loss base": log_loss(test.y, base, labels=[0, 1]),
        "Brier": brier_score_loss(test.y, p),
        "Brier base": brier_score_loss(test.y, base),
        "ARI shipped": score(groups_of(test.shipped), test.labels).ari,
        "ARI refit": score(groups_of(part), test.labels).ari,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="refit affinity weights from hand-labelled pairs (leave-one-browser-out)")
    ap.add_argument("names", nargs="+")
    ap.add_argument("--C", type=float, default=1.0, dest="c", help="inverse L2 strength (sklearn), default 1.0")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args(argv)
    synthetic = [n for n in a.names
                 if json.loads((FIXTURES / f"{n}.json").read_text(encoding="utf-8")).get("_synthetic")]

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        sets = [load_pairs(n, work) for n in a.names]
        n_pairs, n_same = sum(len(s.y) for s in sets), sum(int(s.y.sum()) for s in sets)
        print(f"== refit | {', '.join(a.names)} | {n_pairs} labelled pairs, {n_same} same-project")
        print("   signals: ts (tools/cluster-cli.ts --edges) | model: logistic regression, "
              f"L2 C={a.c} | betas scaled so affinity >= W_MIN ({W_MIN}) exactly where P(same) >= 0.5")
        if synthetic:
            print(f"   !! SYNTHETIC ({', '.join(synthetic)}): mechanics only; these weights say nothing about real browsers")
        print()
        if len(sets) >= 2:
            print("   leave-one-browser-out: each row uses betas fit on the OTHER fixtures. Only this table is evidence.")
            df = pd.DataFrame([held_out(t, [s for s in sets if s is not t], a.c, work) for t in sets]).set_index("fixture")
            print(df.round(4).to_string())
            print(f"\n   mean ARI refit - shipped (held out): {(df['ARI refit'] - df['ARI shipped']).mean():+.4f}")
        else:
            print("   one fixture: nothing to hold out. The fit below is in-sample and is NOT evidence.")
        f = fit(sets, a.c)

    x = np.vstack([s.x for s in sets])
    flat = [s for i, s in enumerate(SIGNALS) if np.ptp(x[:, i]) == 0]
    betas = f.betas()
    table = pd.DataFrame({"shipped": load_betas(), "refit": betas, "raw coef": f.coef}).loc[list(SIGNALS)]
    print(f"\n   fit on all fixtures (intercept {f.intercept:+.4f}):")
    print(table.round(4).to_string())
    if flat:
        print(f"   no variation in the data for {', '.join(flat)}: its weight reflects missing evidence, not a useless signal")
    a.out.write_text(json.dumps({
        "_comment": "REFIT CANDIDATE — not read by anything. Adopting it means copying into src/cluster/betas.json "
                    "and logging the decision in docs/DECISIONS.md.",
        "_fit": {"fixtures": a.names, "synthetic": synthetic, "pairs": n_pairs, "same": n_same, "C": a.c,
                 "intercept": f.intercept, "raw_coef": f.coef, "w_min": W_MIN},
        **betas,
    }, indent=2), encoding="utf-8")
    print(f"\n-> {a.out}   (src/cluster/betas.json untouched)")
    print(f"   try it: npx tsx tools/cluster-cli.ts <name> --betas {a.out} --out <file>, "
          "then npm run score <name> -- --partition <file>")
    return 0


if __name__ == "__main__":  # python -m tabamnesty.refit <name>...
    sys.exit(main())
