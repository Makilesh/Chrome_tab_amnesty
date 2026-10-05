"""Laya vs Gemini Nano on the same questions. Research only; nothing here ships.

  python -m tabamnesty.judge_compare items [names...] [--generated N] [--pairs K]   -> .real/compare/items.json
  python -m tabamnesty.judge_compare laya                                           -> .real/compare/laya.json
  npx tsx tools/judge-nano.ts answer                                                -> .real/compare/nano.json
  python -m tabamnesty.judge_compare report                                         (prints both side by side)

Both judges get exactly the same items:
  - pairs, sampled by laya_probe.sample_pairs (four strata; the HARD ones are "same project,
    different sitting" vs "different project, same site"), each tab shown as title (host/path) —
    what install day has;
  - groups, the shipped partition (the Python bench equals TS by parity), each shown as its
    titles; both judges pick an activity from laya_probe.ACTIVITIES, and Nano also writes the
    name the extension would show (the extension's own prompt, fed naming.evidence()).

Items hold tab titles, so they live in .real/ (git-ignored), never in fixtures/. A browser whose
labels are a draft (`_status` in the labels file) is marked so in every line of the report.
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

from .cluster import cluster
from .config import FIXTURES
from .laya_probe import ACTIVITIES, DOING, HARD, SAME, STRATA, _auc, combined_auc, sample_pairs, tab_text
from .traces import load_fixture, load_labels

OUT = FIXTURES.parent / ".real" / "compare"


def _label_kind(name: str) -> str:
    """'draft' (proposed, not the owner's), 'by construction' (scripted browser), 'owner', or 'none'."""
    p = FIXTURES / f"{name}.labels.json"
    if not p.exists():
        return "none"
    raw = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(raw.get("_status"), str) and "DRAFT" in raw["_status"]:
        return "draft"
    return "by construction" if "_scripted" in raw else "owner"


def build_items(names: list[str], generated: int, per_stratum: int) -> dict:
    browsers = []
    sources: list[tuple[str, list, dict | None, str]] = []
    for n in names:
        lp = FIXTURES / f"{n}.labels.json"
        labels = load_labels(lp) if lp.exists() else None
        sources.append((n, load_fixture(FIXTURES / f"{n}.json"), labels, _label_kind(n)))
    if generated:
        from .judge_sim import cold, make_realistic
        for s in range(generated):
            traces, labels = make_realistic(s)
            sources.append((f"generated-{s}", cold(traces, s), labels, "by construction"))
    for name, traces, labels, kind in sources:
        part = cluster(traces)
        pairs = sample_pairs(traces, labels, per_stratum) if labels else []
        used = {t for c in part.communities for t in c} | {p.a["traceId"] for p in pairs} | {p.b["traceId"] for p in pairs}
        browsers.append({
            "name": name,
            "labels": kind,
            "traces": [t for t in traces if t["traceId"] in used],
            "groups": [{"id": i, "traceIds": list(c)} for i, c in enumerate(part.communities)],
            "pairs": [{"a": p.a["traceId"], "b": p.b["traceId"], "stratum": p.stratum, "y": p.y, "free": p.free,
                       "textA": tab_text(p.a), "textB": tab_text(p.b)} for p in pairs],
        })
    return {"activities": list(ACTIVITIES), "browsers": browsers}


def run_laya(items: dict, checkpoint: str = "english") -> dict:
    from .laya_probe import load_agent
    agent = load_agent(checkpoint)
    out = {"checkpoint": checkpoint, "browsers": {}}
    for b in items["browsers"]:
        by = {t["traceId"]: t for t in b["traces"]}
        res: dict = {}
        if b["pairs"]:
            states = [{"tab A": p["textA"], "tab B": p["textB"]} for p in b["pairs"]]
            t0 = time.perf_counter()
            ans = agent.predict_batch(states, SAME, batch_size=16)
            res["ms_per_pair"] = (time.perf_counter() - t0) * 1000 / len(states)
            res["pairs"] = [r["answers"]["same"]["probabilities"]["A"] for r in ans]
        if b["groups"]:
            states = [{"tabs": [by[t]["title"] for t in g["traceIds"][:15]]} for g in b["groups"]]
            t0 = time.perf_counter()
            ans = agent.predict_batch(states, DOING)
            res["ms_per_group"] = (time.perf_counter() - t0) * 1000 / len(states)
            res["groups"] = [{"activity": r["answers"]["doing"]["choice"],
                              "p": r["answers"]["doing"]["probabilities"][r["answers"]["doing"]["choice"]]} for r in ans]
        out["browsers"][b["name"]] = res
        print(f"laya: {b['name']} done ({len(b['pairs'])} pairs, {len(b['groups'])} groups)")
    return out


def _labels_for(name: str) -> dict | None:
    if name.startswith("generated-"):
        from .judge_sim import make_realistic
        return make_realistic(int(name.split("-", 1)[1]))[1]
    p = FIXTURES / f"{name}.labels.json"
    return load_labels(p) if p.exists() else None


def _truth(labels: dict | None, ids: list[str]) -> str:
    """The group's majority project and its share of the group — what a good name should say."""
    if not labels:
        return "-"
    from collections import Counter
    c = Counter(labels.get(i) for i in ids)
    top, n = c.most_common(1)[0]
    return f"{top or '(no project)'} {n}/{len(ids)}"


def _fmt(v) -> str:
    return "   -  " if v is None or (isinstance(v, float) and math.isnan(v)) else f"{v:6.3f}"


def report(items: dict, laya: dict | None, nano: dict | None, extra: dict | None = None) -> None:
    print("Laya vs Gemini Nano — same items. AUC: 0.5 = coin flip, 1.0 = perfect. HARD = same project on")
    print("another day vs a different project on the same site (where behaviour alone is weakest).\n")
    for b in items["browsers"]:
        name, kind = b["name"], b["labels"]
        L = (laya or {}).get("browsers", {}).get(name, {})
        N = (nano or {}).get("browsers", {}).get(name, {})
        tag = {"draft": "  [labels: DRAFT, not the owner's — indicative only]", "by construction": "  [simulated; truth by construction]",
               "owner": "  [owner's labels]", "none": "  [no labels: names only]"}[kind]
        print(f"== {name}{tag}")
        if b["pairs"]:
            y = np.array([p["y"] for p in b["pairs"]])
            free = np.array([p["free"] for p in b["pairs"]])
            hard = np.array([p["stratum"] in HARD for p in b["pairs"]])
            rows = [("free signals (shipped)", free)]
            if "pairs" in L:
                rows.append(("Laya (english)", np.array(L["pairs"])))
            for ck, data in (extra or {}).items():
                X = (data or {}).get("browsers", {}).get(name, {})
                if "pairs" in X:
                    rows.append((f"Laya ({ck})", np.array(X["pairs"])))
            if "pairs" in N:
                rows.append(("Gemini Nano", np.array(N["pairs"])))
            print(f"   {len(y)} pairs ({int(y.sum())} same-project), {int(hard.sum())} hard   " +
                  "  ".join(f"{s.split(',')[0][:4]}…{sum(1 for p in b['pairs'] if p['stratum'] == s)}" for s in STRATA))
            print(f"   {'':26s} {'AUC':>6s} {'HARD':>6s} {'+free':>6s} {'+free HARD':>10s}")
            for label, s in rows:
                plus = combined_auc(y, free, np.clip(s, 1e-6, 1 - 1e-6)) if label != "free signals (shipped)" else None
                plus_h = combined_auc(y[hard], free[hard], np.clip(s[hard], 1e-6, 1 - 1e-6)) if label != "free signals (shipped)" else None
                print(f"   {label:26s} {_fmt(_auc(y, s))} {_fmt(_auc(y[hard], s[hard]))} {_fmt(plus)} {_fmt(plus_h):>10s}")
            for label, d in (("Laya", L), ("Nano", N)):
                if "ms_per_pair" in d:
                    print(f"   {label} time per pair: {d['ms_per_pair']:.0f} ms")
        if b["groups"]:
            labels = _labels_for(name)
            before = N.get("groups_before")
            print("   per group:  truth (majority project, share) | heuristic | Laya activity | Nano name" + (" before -> now" if before else ""))
            hn = N.get("heuristic", [])
            for i, g in enumerate(b["groups"]):
                lg = (L.get("groups") or [None] * len(b["groups"]))[i]
                ng = (N.get("groups") or [None] * len(b["groups"]))[i]
                hosts = sorted({t["host"] for t in b["traces"] if t["traceId"] in set(g["traceIds"])})[:3]
                now = (ng.get("name") or "-") if ng else "-"
                if ng and ng.get("repeat"):
                    now += " (model repeated a name; fallback kept)"
                nano_col = f"{before[i]} -> {now}" if before else now
                print(f"   {len(g['traceIds']):2d} tabs  {_truth(labels, g['traceIds']):26s} | {(hn[i] if i < len(hn) else '?'):14s} | "
                      f"{(lg['activity']) if lg else '-':28s} | {nano_col}   ({', '.join(hosts)})")
        print()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Laya vs Gemini Nano on the same items (research only)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("items")
    i.add_argument("names", nargs="*")
    i.add_argument("--generated", type=int, default=0)
    i.add_argument("--pairs", type=int, default=40, help="pairs per stratum")
    la = sub.add_parser("laya")
    la.add_argument("--checkpoint", default="english", choices=["english", "multilingual", "typed-decisions"])
    sub.add_parser("report")
    a = ap.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    if a.cmd == "items":
        items = build_items(a.names, a.generated, a.pairs)
        (OUT / "items.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        for b in items["browsers"]:
            print(f"{b['name']:16s} labels={b['labels']:16s} {len(b['pairs']):4d} pairs  {len(b['groups']):3d} groups")
        print(f"-> {OUT / 'items.json'}")
    elif a.cmd == "laya":
        items = json.loads((OUT / "items.json").read_text(encoding="utf-8"))
        dest = OUT / ("laya.json" if a.checkpoint == "english" else f"laya-{a.checkpoint}.json")
        dest.write_text(json.dumps(run_laya(items, a.checkpoint)), encoding="utf-8")
        print(f"-> {dest}")
    else:
        items = json.loads((OUT / "items.json").read_text(encoding="utf-8"))
        load = lambda p: json.loads(p.read_text(encoding="utf-8")) if p.exists() else None  # noqa: E731
        extra = {p.stem.removeprefix("laya-"): load(p) for p in sorted(OUT.glob("laya-*.json"))}
        report(items, load(OUT / "laya.json"), load(OUT / "nano.json"), extra)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
