"""Command-line entry points. All read JSON fixtures and write JSON / tables; nothing here
touches a browser.

  ta-cluster <name> [--betas file] [--out file]   cluster fixtures/<name>.json -> partition JSON
  ta-score   <name> [--partition file]            ours vs Chrome vs labels
  ta-ablate  <name>                               ARI delta per zeroed signal
  ta-report  <name>...                            per-browser chart -> fixtures/report.png
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from .cluster import Partition, ablation_betas, cluster, pair_signals
from .config import FIXTURES, load_betas
from .score import CONVENTION, chrome_groups, placed_by_both, score
from .signals import eligible
from .traces import load_chrome, load_fixture, load_labels


def _paths(name: str) -> dict[str, Path]:
    return {
        "traces": FIXTURES / f"{name}.json",
        "labels": FIXTURES / f"{name}.labels.json",
        "chrome": FIXTURES / f"{name}.chrome.json",
        "partition": FIXTURES / f"{name}.partition.json",
    }


def _partition_groups(p: dict) -> list[list[str]]:
    return [c["traceIds"] for c in p["communities"]]


def cluster_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="cluster a fixture")
    ap.add_argument("name")
    ap.add_argument("--betas", type=Path, help="alternative betas.json")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--edges", type=Path, help="also dump every pair's signal vector + weight (parity, refit)")
    a = ap.parse_args(argv)
    paths = _paths(a.name)
    traces = load_fixture(paths["traces"])
    betas = load_betas(a.betas)
    kept, _ = eligible(traces)
    _, vecs = pair_signals(kept)
    part = cluster(traces, betas, vecs=vecs)
    out = a.out or paths["partition"]
    out.write_text(json.dumps(part.to_json("python", betas), indent=2), encoding="utf-8")
    if a.edges:
        from .signals import affinity
        rows = [{"a": k[0], "b": k[1], "w": affinity(v, betas), **v} for k, v in vecs.items()]
        a.edges.write_text(json.dumps(rows), encoding="utf-8")
    print(f"{a.name}: {len(part.communities)} communities, {len(part.loose_ends)} loose ends, "
          f"{len(part.excluded)} excluded, resolution {part.resolution:.3f} -> {out}")


def _score_table(name: str, ours: list[list[str]], labels: dict, chrome: dict | None) -> pd.DataFrame:
    universe = list(labels)
    rows = {"ours (full set)": score(ours, labels, universe).row()}
    if chrome:
        cg = chrome_groups(chrome)
        rows["chrome (full set)"] = score(cg, labels, universe).row()
        both = placed_by_both(ours, cg, universe)
        sub = {u: labels[u] for u in both}
        rows["ours (placed by both)"] = score(ours, sub, both).row()
        rows["chrome (placed by both)"] = score(cg, sub, both).row()
    return pd.DataFrame(rows).T


def score_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="score a partition against hand labels")
    ap.add_argument("name")
    ap.add_argument("--partition", type=Path, help="partition JSON (default: cluster now in Python)")
    a = ap.parse_args(argv)
    paths = _paths(a.name)
    traces = load_fixture(paths["traces"])
    labels = load_labels(paths["labels"])
    chrome = load_chrome(paths["chrome"]) if paths["chrome"].exists() else None
    if a.partition:
        p = json.loads(a.partition.read_text(encoding="utf-8"))
        ours, source = _partition_groups(p), p.get("source", "?")
    else:
        part = cluster(traces)
        ours, source = part.communities, "python"

    print(f"== {a.name} | {len(traces)} traces, {len(labels)} labelled | partition source: {source}")
    print(f"   {CONVENTION}")
    if chrome:
        print(f"   chrome baseline: {chrome['method']}, {len(chrome['groups'])} groups, "
              f"{len(chrome.get('ungrouped', []))} ungrouped")
    else:
        print("   no chrome baseline (fixtures/<name>.chrome.json missing)")
    df = _score_table(a.name, ours, labels, chrome)
    print(df.to_string())
    if chrome:
        d = df.loc["ours (full set)", "ARI"] - df.loc["chrome (full set)", "ARI"]
        print(f"\n   ARI delta vs chrome (full set): {d:+.4f}   gate needs >= +0.15 on 4 of 5 browsers")


def ablate_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="ARI delta per zeroed signal")
    ap.add_argument("name")
    ap.add_argument("--out", type=Path, help="write the table as CSV")
    a = ap.parse_args(argv)
    paths = _paths(a.name)
    traces = load_fixture(paths["traces"])
    labels = load_labels(paths["labels"])
    universe = list(labels)
    kept, _ = eligible(traces)
    _, vecs = pair_signals(kept)  # signals once; only the weights change per run
    rows = []
    base = None
    for run, betas in ablation_betas(load_betas()).items():
        part = cluster(traces, betas, vecs=vecs)
        s = score(part.communities, labels, universe)
        if base is None:
            base = s.ari
        rows.append({"run": run, "ARI": round(s.ari, 4), "delta": round(s.ari - base, 4),
                     "groups": s.n_groups, "placed": s.n_placed})
    df = pd.DataFrame(rows).set_index("run")
    print(f"== {a.name} ablation | {CONVENTION}")
    print(df.to_string())
    gate = df.loc["no_S1_S2_S8", "delta"]
    print(f"\n   zeroing S1/S2/S8: {gate:+.4f}   gate needs <= -0.10")
    if a.out:
        df.to_csv(a.out)


def report_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="per-browser ARI vs Chrome + ablation chart")
    ap.add_argument("names", nargs="+")
    ap.add_argument("--out", type=Path, default=FIXTURES / "report.png")
    a = ap.parse_args(argv)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    per_browser, per_signal = [], {}
    for name in a.names:
        paths = _paths(name)
        traces = load_fixture(paths["traces"])
        labels = load_labels(paths["labels"])
        universe = list(labels)
        ours = cluster(traces).communities
        row = {"browser": name, "ours": score(ours, labels, universe).ari}
        if paths["chrome"].exists():
            row["chrome"] = score(chrome_groups(load_chrome(paths["chrome"])), labels, universe).ari
        per_browser.append(row)
        kept, _ = eligible(traces)
        _, vecs = pair_signals(kept)
        base = None
        for run, betas in ablation_betas(load_betas()).items():
            s = score(cluster(traces, betas, vecs=vecs).communities, labels, universe).ari
            base = s if base is None else base
            per_signal.setdefault(run, {})[name] = s - base
    pb = pd.DataFrame(per_browser).set_index("browser")
    ps = pd.DataFrame(per_signal).T.drop(index="baseline", errors="ignore")

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.5))
    pb.plot.bar(ax=ax1, rot=0)
    ax1.set_title("ARI vs hand labels (higher is better)")
    ax1.set_ylim(-0.1, 1.0)
    ax1.axhline(0, color="grey", lw=0.5)
    ps.plot.barh(ax=ax2)
    ax2.set_title("ARI delta when a signal is zeroed (more negative = signal matters)")
    ax2.axvline(-0.10, color="red", lw=0.8, ls="--", label="gate (S1/S2/S8)")
    ax2.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(a.out, dpi=130)
    print(pb.round(4).to_string())
    print()
    print(ps.round(4).to_string())
    print(f"\n-> {a.out}")


if __name__ == "__main__":  # python -m tabamnesty.cli <cmd> ...
    cmd, rest = sys.argv[1], sys.argv[2:]
    {"cluster": cluster_main, "score": score_main, "ablate": ablate_main, "report": report_main}[cmd](rest)
