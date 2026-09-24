"""Measure what Laya actually scores on OUR questions. Opt-in research tool, never shipped.

  pip install -e "analysis[laya]"          # torch + transformers; first run downloads ~1.7 GB
  python -m tabamnesty.laya_probe <name>    # a real fixture with labels
  python -m tabamnesty.laya_probe --generated 4   # judge_sim's generated browsers (install-day titles)

Needs huggingface.co reachable for the first download. Only what install day has goes into a
state: title, host and path. No digest, no page text.

1. "Same project?" on a stratified sample of labelled pairs. The headline is the HARD AUC: can
   it tell "same project, different sitting" (what the clusterer splits) from "different project,
   same site" (what a topic model merges)? Reported next to the free signals on the very same
   pairs, and for the two combined (2-fold logistic regression), because judge_sim says a judge
   only pays when it is right where behaviour is wrong. Its table maps an AUC to an ARI gain.
2. "What was the person doing?" per group, a choice over ACTIVITIES, printed for eyeballing:
   the event-label use case (section 6.5 of the brief) for machines without Gemini Nano.
3. Milliseconds per question on this machine (torch CPU; the in-browser int8 build is slower).
"""
from __future__ import annotations

import argparse
import math
import random
import time
from dataclasses import dataclass

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

from .cluster import cluster, pair_signals
from .config import FIXTURES, SIGNALS, load_betas
from .signals import affinity, eligible
from .traces import load_fixture, load_labels

# Neutral keys: on the English checkpoint `noul` can follow its true/false labels instead of the
# state (laya #156); a two-option choice keyed A/B is the maintainers' workaround.
SAME = {"same": {
    "type": "choice",
    "instructions": "Are these two browser tabs part of the same task or project the person was working on?",
    "criteria": {"A": "yes, the same task or project", "B": "no, different tasks or projects"},
}}
ACTIVITIES = {
    "building or fixing software": "code, pull requests, errors, deploys, developer docs",
    "planning a trip": "flights, hotels, maps, itineraries",
    "shopping or comparing products": "product pages, reviews, prices",
    "looking for a job": "job listings, applications, interviews",
    "looking for a home": "rentals, property listings, viewings",
    "studying or learning": "courses, tutorials, lectures",
    "researching a topic": "papers, articles, references",
    "planning or managing work": "roadmaps, boards, meeting notes, documents",
    "money or admin": "bank, bills, taxes, insurance, forms",
    "entertainment": "videos, music, games, social feeds",
}
DOING = {"doing": {"type": "choice", "instructions": "What was the person doing with these tabs?",
                   "criteria": ACTIVITIES}}
STRATA = ("same project, different sitting", "same project, same sitting",
          "different project, same site", "different project, other")
HARD = (STRATA[0], STRATA[2])


def tab_text(t: dict) -> str:
    path = "/".join(t.get("pathTokens") or [])
    return f"{t.get('title') or ''} ({t.get('host') or ''}/{path})"


@dataclass
class Pair:
    a: dict
    b: dict
    stratum: str
    y: int
    free: float  # shipped-beta affinity: what the clusterer already knows


def sample_pairs(traces: list, labels: dict, per_stratum: int, seed: int = 0) -> list[Pair]:
    kept, _ = eligible(traces)
    by = {t["traceId"]: t for t in kept}
    _, vecs = pair_signals(kept)
    betas = load_betas()
    buckets: dict[str, list[Pair]] = {s: [] for s in STRATA}
    for (a, b), v in vecs.items():
        if a not in labels or b not in labels:
            continue
        la, lb = labels[a], labels[b]
        same = la is not None and la == lb
        if same:
            s = STRATA[0] if v["S3_session"] == 0 else STRATA[1]
        else:
            s = STRATA[2] if la is not None and lb is not None and v["S5_domain"] >= 0.5 else STRATA[3]
        buckets[s].append(Pair(by[a], by[b], s, int(same), affinity(v, betas)))
    rng = random.Random(seed)
    return [p for s in STRATA for p in rng.sample(buckets[s], min(per_stratum, len(buckets[s])))]


def ask_same(agent, pairs: list[Pair], batch: int = 16) -> tuple[np.ndarray, float]:
    states = [{"tab A": tab_text(p.a), "tab B": tab_text(p.b)} for p in pairs]
    t0 = time.perf_counter()
    out = agent.predict_batch(states, SAME, batch_size=batch)
    ms = (time.perf_counter() - t0) * 1000 / max(1, len(states))
    return np.array([r["answers"]["same"]["probabilities"]["A"] for r in out]), ms


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _auc(y, s) -> float:
    return float(roc_auc_score(y, s)) if len(set(y)) == 2 else math.nan


def combined_auc(y: np.ndarray, free: np.ndarray, judge: np.ndarray) -> float:
    """2-fold out-of-sample AUC of a logistic regression on [free affinity, judge logit]."""
    if min(np.bincount(y, minlength=2)) < 2:
        return math.nan
    x = np.c_[free, _logit(judge)]
    scores = np.zeros(len(y))
    for tr, te in StratifiedKFold(2, shuffle=True, random_state=0).split(x, y):
        scores[te] = LogisticRegression().fit(x[tr], y[tr]).decision_function(x[te])
    return _auc(y, scores)


def report(pairs: list[Pair], p: np.ndarray) -> dict[str, float]:
    y = np.array([q.y for q in pairs])
    free = np.array([q.free for q in pairs])
    hard = np.array([q.stratum in HARD for q in pairs])
    out = {"pairs": len(pairs), "AUC laya": _auc(y, p), "AUC free": _auc(y, free),
           "AUC combined": combined_auc(y, free, p),
           "HARD AUC laya": _auc(y[hard], p[hard]), "HARD AUC free": _auc(y[hard], free[hard]),
           "HARD AUC combined": combined_auc(y[hard], free[hard], p[hard])}
    for s in STRATA:
        m = np.array([q.stratum == s for q in pairs])
        out[f"mean P(same) | {s}"] = float(p[m].mean()) if m.any() else math.nan
    return out


def load_agent(checkpoint: str):
    try:
        import laya
    except ImportError as e:
        raise SystemExit('laya is not installed: pip install -e "analysis[laya]"') from e
    try:
        sub = None if checkpoint == "english" else checkpoint
        return laya.load("convaiinnovations/laya", subfolder=sub, device="cpu")
    except Exception as e:  # network, auth, disk: say which, do not stack-trace
        raise SystemExit(f"could not load Laya ({type(e).__name__}: {e}). Is huggingface.co reachable?") from e


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="measure Laya on Tab Amnesty's questions")
    ap.add_argument("name", nargs="?", help="fixture name (fixtures/<name>.json + .labels.json)")
    ap.add_argument("--generated", type=int, default=0, help="use N judge_sim browsers instead (install-day titles)")
    ap.add_argument("--pairs", type=int, default=100, help="pairs per stratum")
    ap.add_argument("--checkpoint", default="english", choices=["english", "multilingual", "typed-decisions"])
    a = ap.parse_args(argv)
    if bool(a.name) == bool(a.generated):
        ap.error("give a fixture name or --generated N")

    if a.generated:
        from .judge_sim import cold, make_realistic
        browsers = []
        for s in range(a.generated):
            traces, labels = make_realistic(s)
            browsers.append((f"generated-{s}", cold(traces, s), labels))
    else:
        browsers = [(a.name, load_fixture(FIXTURES / f"{a.name}.json"), load_labels(FIXTURES / f"{a.name}.labels.json"))]

    agent = load_agent(a.checkpoint)
    for name, traces, labels in browsers:
        pairs = sample_pairs(traces, labels, a.pairs)
        p, ms = ask_same(agent, pairs)
        print(f"== {name} | laya {a.checkpoint} | {ms:.0f} ms per question (torch CPU, this machine)")
        for k, v in report(pairs, p).items():
            print(f"   {k:48s} {v:.3f}" if isinstance(v, float) else f"   {k:48s} {v}")
        part = cluster(traces)
        by = {t["traceId"]: t for t in traces}
        states = [{"tabs": [by[t]["title"] for t in c[:15]]} for c in part.communities]
        answers = agent.predict_batch(states, DOING) if states else []
        print("   what the person was doing, per group:")
        for c, r in zip(part.communities, answers):
            ans = r["answers"]["doing"]
            hosts = sorted({by[t]["host"] for t in c})[:3]
            print(f"     {ans['choice']:32s} ({ans['probabilities'][ans['choice']]:.2f})  {', '.join(hosts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
