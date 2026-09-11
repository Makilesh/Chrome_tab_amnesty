"""Command-line entry points. All read JSON fixtures and write JSON / tables; nothing here
touches a browser.

  ta-cluster <name> [--betas file] [--out file]   cluster in Python -> partition JSON (research)
  ta-score   <name> [--partition file] [--python] ours vs Chrome vs labels
  ta-ablate  <name> [--python]                    ARI delta per zeroed signal
  ta-report  <name>... [--python]                 per-browser chart -> fixtures/report.png

THE GATE IS MEASURED ON THE SHIPPED CLUSTERER. score / ablate / report run tools/cluster-cli.ts
(the TS code in the extension) and score what it produced; the parity check against this
Python bench runs first and its result is printed in every header. `--python` clusters here
instead — for experiments, never for the gate.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import pandas as pd

from . import parity
from .cluster import ablation_betas, cluster, pair_signals
from .config import FIXTURES, load_betas
from .score import CONVENTION, chrome_groups, placed_by_both, score
from .signals import eligible
from .traces import load_chrome, load_fixture, load_labels
from .ts import groups_of, run_cluster_cli


def _paths(name: str) -> dict[str, Path]:
    return {
        "traces": FIXTURES / f"{name}.json",
        "labels": FIXTURES / f"{name}.labels.json",
        "chrome": FIXTURES / f"{name}.chrome.json",
    }


PY_SOURCE = "partition source: PYTHON BENCH (--python; not the shipped code, not a gate number)"


# ---------------------------------------------------------------------------------------------
# Which partition gets scored
# ---------------------------------------------------------------------------------------------

def _ours(name: str, traces: list, use_python: bool, partition: Path | None) -> tuple[list[list[str]], str, parity.Parity | None]:
    """(groups, source line, parity). Default: the TS partition, with parity checked first."""
    if partition:
        p = json.loads(partition.read_text(encoding="utf-8"))
        return groups_of(p), f"partition source: {p.get('source', '?')} ({partition})", None
    if use_python:
        return cluster(traces).communities, PY_SOURCE, None
    pr = parity.check(name)
    return groups_of(pr.ts_partition), f"partition source: ts (tools/cluster-cli.ts) | {pr.line()}", pr


def _ablation_partitions(name: str, traces: list, use_python: bool) -> tuple[dict[str, list[list[str]]], str, parity.Parity | None]:
    """run name -> groups, one per ablation config."""
    if use_python:
        kept, _ = eligible(traces)
        _, vecs = pair_signals(kept)
        runs = {run: cluster(traces, b, vecs=vecs).communities for run, b in ablation_betas(load_betas()).items()}
        return runs, PY_SOURCE, None
    pr = parity.check(name)
    with tempfile.TemporaryDirectory() as td:
        run_cluster_cli(name, Path(td) / "base.json", ablate_dir=Path(td) / "ablate")
        runs = {}
        for run in ablation_betas(load_betas()):
            p = json.loads((Path(td) / "ablate" / f"{name}.{run}.partition.json").read_text(encoding="utf-8"))
            runs[run] = groups_of(p)
    return runs, f"partition source: ts (tools/cluster-cli.ts --ablate) | {pr.line()}", pr


def _warn_if_parity_failed(pr: parity.Parity | None) -> bool:
    if pr and not pr.ok:
        print("\n   !! PARITY FAILED — the shipped clusterer and the bench disagree. Do not report this number; "
              f"investigate first (npm run parity {pr.name}).")
        return True
    return False


# ---------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------

def cluster_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="cluster a fixture IN PYTHON (research; the gate uses the TS CLI)")
    ap.add_argument("name")
    ap.add_argument("--betas", type=Path, help="alternative betas.json")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--edges", type=Path, help="also dump every pair's signal vector + weight (refit)")
    a = ap.parse_args(argv)
    traces = load_fixture(_paths(a.name)["traces"])
    betas = load_betas(a.betas)
    kept, _ = eligible(traces)
    _, vecs = pair_signals(kept)
    part = cluster(traces, betas, vecs=vecs)
    out = a.out or FIXTURES / f"{a.name}.python.partition.json"
    out.write_text(json.dumps(part.to_json("python", betas), indent=2), encoding="utf-8")
    print(f"{a.name}: {len(part.communities)} communities, {len(part.loose_ends)} loose ends, "
          f"{len(part.excluded)} excluded, resolution {part.resolution:.3f} -> {out}")
    if a.edges:
        from .signals import affinity
        rows = [{"a": k[0], "b": k[1], "w": affinity(v, betas), **v} for k, v in vecs.items()]
        a.edges.write_text(json.dumps(rows), encoding="utf-8")


def _score_table(ours: list[list[str]], labels: dict, chrome: dict | None) -> pd.DataFrame:
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
    ap.add_argument("--partition", type=Path, help="score this partition JSON instead of running the TS CLI")
    ap.add_argument("--python", action="store_true", help="cluster in the Python bench instead (experiments only)")
    a = ap.parse_args(argv)
    paths = _paths(a.name)
    traces = load_fixture(paths["traces"])
    labels = load_labels(paths["labels"])
    chrome = load_chrome(paths["chrome"]) if paths["chrome"].exists() else None
    ours, source, pr = _ours(a.name, traces, a.python, a.partition)

    print(f"== {a.name} | {len(traces)} traces, {len(labels)} labelled")
    print(f"   {source}")
    print(f"   {CONVENTION}")
    if chrome:
        print(f"   chrome baseline: {chrome['method']}, {len(chrome['groups'])} groups, "
              f"{len(chrome.get('ungrouped', []))} ungrouped")
    else:
        print("   no chrome baseline (fixtures/<name>.chrome.json missing)")
    df = _score_table(ours, labels, chrome)
    print(df.to_string())
    if chrome:
        d = df.loc["ours (full set)", "ARI"] - df.loc["chrome (full set)", "ARI"]
        print(f"\n   ARI delta vs chrome (full set): {d:+.4f}   gate needs >= +0.15 on 4 of 5 browsers")
    if _warn_if_parity_failed(pr):
        sys.exit(1)


def _ablation_table(runs: dict[str, list[list[str]]], labels: dict) -> pd.DataFrame:
    universe = list(labels)
    rows, base = [], None
    for run, groups in runs.items():
        s = score(groups, labels, universe)
        base = s.ari if base is None else base
        rows.append({"run": run, "ARI": round(s.ari, 4), "delta": round(s.ari - base, 4),
                     "groups": s.n_groups, "placed": s.n_placed})
    return pd.DataFrame(rows).set_index("run")


def ablate_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="ARI delta per zeroed signal")
    ap.add_argument("name")
    ap.add_argument("--python", action="store_true", help="cluster in the Python bench instead (experiments only)")
    ap.add_argument("--out", type=Path, help="write the table as CSV")
    a = ap.parse_args(argv)
    paths = _paths(a.name)
    traces = load_fixture(paths["traces"])
    labels = load_labels(paths["labels"])
    runs, source, pr = _ablation_partitions(a.name, traces, a.python)
    df = _ablation_table(runs, labels)
    print(f"== {a.name} ablation")
    print(f"   {source}")
    print(f"   {CONVENTION}")
    print(df.to_string())
    gate = df.loc["no_S1_S2_S8", "delta"]
    print(f"\n   zeroing S1/S2/S8: {gate:+.4f}   gate needs <= -0.10")
    print("   note: S3 (same session) is cut from the same timestamps S2 decays over and stays on in that run.")
    if a.out:
        df.to_csv(a.out)
    if _warn_if_parity_failed(pr):
        sys.exit(1)


def report_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="per-browser ARI vs Chrome + ablation chart")
    ap.add_argument("names", nargs="+")
    ap.add_argument("--python", action="store_true", help="cluster in the Python bench instead (experiments only)")
    ap.add_argument("--out", type=Path, default=FIXTURES / "report.png")
    a = ap.parse_args(argv)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    per_browser, per_signal, source_lines, failed = [], {}, [], False
    for name in a.names:
        paths = _paths(name)
        traces = load_fixture(paths["traces"])
        labels = load_labels(paths["labels"])
        universe = list(labels)
        runs, source, pr = _ablation_partitions(name, traces, a.python)
        source_lines.append(f"{name}: {source}")
        failed |= bool(pr and not pr.ok)
        base = score(runs["baseline"], labels, universe).ari
        row = {"browser": name, "ours": base}
        if paths["chrome"].exists():
            row["chrome"] = score(chrome_groups(load_chrome(paths["chrome"])), labels, universe).ari
        per_browser.append(row)
        for run, groups in runs.items():
            per_signal.setdefault(run, {})[name] = score(groups, labels, universe).ari - base
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
    fig.suptitle("partition source: " + ("PYTHON BENCH (not shipped code)" if a.python else "ts (shipped clusterer)"), fontsize=9)
    fig.tight_layout()
    fig.savefig(a.out, dpi=130)
    for line in source_lines:
        print("   " + line)
    print(pb.round(4).to_string())
    print()
    print(ps.round(4).to_string())
    print(f"\n-> {a.out}")
    if failed:
        print("\n   !! PARITY FAILED on at least one fixture — see above. Do not report these numbers.")
        sys.exit(1)


if __name__ == "__main__":  # python -m tabamnesty.cli <cmd> ...
    cmd, rest = sys.argv[1], sys.argv[2:]
    {"cluster": cluster_main, "score": score_main, "ablate": ablate_main, "report": report_main}[cmd](rest)
