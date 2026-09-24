"""What would a content judge (Laya on-device, or Jev as an API) add to grouping?

Measured before buying one. A "judge" answers "are these the same project?" with a probability.
We do not have Laya's weights or real browsers yet, so the judge is SIMULATED at a chosen
quality (pairwise AUC) and plugged into five designs that cost very different numbers of calls:

  pairs-all    every pair of tabs judged, fed to refit as a tenth signal       n(n-1)/2 calls
  pairs-top8   only each tab's 8 most likely partners judged (others neutral)   ~n*8 calls
  merge        after clustering, "are group A and group B one project?"         k(k-1)/2 calls
  reassign     every tab: "which of these groups, or none?" (one choice)        n calls
  judge-only   group by the judge alone, no behaviour (a topic organiser's way)  n(n-1)/2 calls

Browsers come from `make_realistic` below: projects resumed across days, sittings that
interleave two projects, topic twins (two trips, two backend incidents), one-offs. Each is
scored WARM (lineage, co-activation, page digests: what the collector has after days) and
COLD (install day: no lineage, no co-activation, titles only, and some openedAt values
replaced by a later revisit, which is what history backfill gives).

Weights are always leave-one-browser-out refits, with and without the judge, so the gain is
the judge's and not the refit's. Judge errors are partly systematic: a shared noise term per
pair of projects (rho) models a topic model that confuses two trips everywhere, not in
independent coin flips. Mechanics and orders of magnitude only; the generator is ours, and
real browsers decide.

  python -m tabamnesty.judge_sim [--browsers 12] [--resumed 0.5]
"""
from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass

import networkx as nx
import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from .cluster import pair_signals, partition_to_target, split_large
from .config import SIGNALS, W_MIN, load_betas
from .score import score
from .signals import affinity, eligible
from .synth import _trace, _uid

# ---------------------------------------------------------------------------------------------
# A browser that looks like the ones we expect
# ---------------------------------------------------------------------------------------------

# (project, hosts, topic words). Twins on purpose: two trips, two backend incidents, two dev
# learning projects share hosts and vocabulary. A topic judge confuses them; the owner does not.
POOL = [
    ("billing migration", ["github.com", "docs.aws.amazon.com", "stackoverflow.com", "grafana.acme.io"],
     "billing service migration postgres schema deploy"),
    ("auth outage", ["github.com", "grafana.acme.io", "docs.aws.amazon.com", "status.acme.io"],
     "auth service outage deploy rollback token"),
    ("pricing redesign", ["figma.com", "notion.so", "github.com", "acme.atlassian.net"],
     "pricing plans tiers redesign landing"),
    ("q3 planning", ["docs.google.com", "notion.so", "acme.atlassian.net"],
     "okr quarterly goals roadmap planning"),
    ("lisbon trip", ["booking.com", "skyscanner.net", "en.wikipedia.org", "tripadvisor.com"],
     "lisbon hotel flight itinerary alfama"),
    ("porto trip", ["booking.com", "skyscanner.net", "en.wikipedia.org", "tripadvisor.com"],
     "porto hotel flight itinerary ribeira"),
    ("flat hunting", ["rightmove.co.uk", "zoopla.co.uk", "maps.google.com", "reddit.com"],
     "flat rent bedroom deposit viewing"),
    ("job search", ["linkedin.com", "greenhouse.io", "glassdoor.com", "docs.google.com"],
     "job application engineer interview salary"),
    ("pandas course", ["youtube.com", "docs.python.org", "stackoverflow.com", "kaggle.com"],
     "pandas dataframe groupby tutorial course"),
    ("ml paper", ["arxiv.org", "scholar.google.com", "github.com", "paperswithcode.com"],
     "transformer attention paper benchmark"),
    ("new laptop", ["amazon.com", "reddit.com", "youtube.com", "rtings.com"],
     "laptop review thinkpad battery"),
    ("adhd reading", ["medium.com", "reddit.com", "youtube.com", "additudemag.com"],
     "adhd focus executive function"),
]
# What a site puts in a title whatever the project is about.
GENERIC = {
    "github.com": ["Pull request", "Issue", "Actions run", "Compare changes"],
    "stackoverflow.com": ["How to fix error", "Why does this fail"],
    "docs.google.com": ["Untitled document", "Meeting notes", "Draft"],
    "notion.so": ["Notes", "Untitled", "Tasks"],
    "figma.com": ["Frame 12", "Draft v3", "Components"],
    "acme.atlassian.net": ["Board", "ACME-412", "Sprint 14"],
    "youtube.com": ["Watch later", "Episode 3", "Full course"],
    "reddit.com": ["Comments", "r/help", "Megathread"],
    "maps.google.com": ["Google Maps", "Directions"],
    "booking.com": ["Booking.com", "Your search results", "Reservation"],
}
ONE_OFF = ["weather.com", "bbc.co.uk", "nytimes.com", "imdb.com", "x.com", "theverge.com",
           "wikipedia.org", "etsy.com", "ebay.com", "spotify.com/podcast"]
SIZES = [3, 4, 5, 6, 8, 10, 12, 15, 20]
DAY = 86_400_000
MIN = 60_000


def make_realistic(seed: int, projects: int = 9, resumed: float = 0.5, one_offs: float = 0.12,
                   windows: int = 2) -> tuple[list, dict[str, str | None]]:
    rng = random.Random(seed)
    chosen = rng.sample(POOL, projects)
    t0 = 1_757_500_000_000
    # sittings: (start ms, project index, tab count)
    sittings = []
    for p, _ in enumerate(chosen):
        n = rng.choice(SIZES)
        k = 1 + (rng.random() < resumed) + (rng.random() < resumed / 2)
        k = min(k, n)
        cuts = sorted(rng.sample(range(1, n), k - 1)) if k > 1 else []
        parts = [b - a for a, b in zip([0, *cuts], [*cuts, n])]
        for part in parts:
            start = t0 + rng.randrange(10) * DAY + rng.randrange(9, 23) * 3_600_000
            sittings.append([start, p, part])
    sittings.sort()
    # a sitting that starts within 40 min of the previous one interleaves with it
    blocks: list[list[list]] = []
    for s in sittings:
        if blocks and s[0] - blocks[-1][0][0] < 40 * MIN:
            blocks[-1].append(s)
        else:
            blocks.append([s])

    traces, labels = [], {}
    by_project: dict[int, list[str]] = {p: [] for p in range(len(chosen))}
    index = {w: 0 for w in range(1, windows + 1)}
    for block in blocks:
        clock = block[0][0]
        w = rng.randint(1, windows)
        remaining = {s[1]: s[2] for s in block}
        fresh = {s[1]: True for s in block}
        sitting_tabs: dict[int, list[str]] = {s[1]: [] for s in block}
        while any(remaining.values()):
            p = rng.choice([q for q, r in remaining.items() if r])
            for _ in range(min(rng.randint(1, 4), remaining[p])):
                remaining[p] -= 1
                clock += rng.randint(20, 240) * 1000
                name, hosts, words = chosen[p]
                wl = words.split()
                host = rng.choice(hosts)
                opener, transition = None, "typed"
                if fresh[p]:
                    if by_project[p] and rng.random() < 0.3:  # resumed from a tab still open
                        opener, transition = rng.choice(by_project[p]), "link"
                    fresh[p] = False
                elif rng.random() < 0.8:
                    opener, transition = rng.choice(sitting_tabs[p][-4:]), "link"
                index[w] += 1
                tid = _uid(rng)
                # Real titles carry the project's words only some of the time.
                generic = rng.choice(GENERIC.get(host, ["Home", "Overview", "Dashboard"]))
                title = (f"{rng.choice(wl).title()} {rng.choice(wl)} - {generic}" if rng.random() < 0.5
                         else f"{generic} {rng.randint(2, 999)}" if rng.random() < 0.5
                         else f"{rng.choice(wl).title()} - {generic}")
                traces.append(_trace(tid, host, f"{rng.choice(wl)}/{rng.randint(1, 999)}", title, clock, w,
                                     index[w], opener, transition))
                labels[tid] = name
                by_project[p].append(tid)
                sitting_tabs[p].append(tid)
        # switching inside the sitting, mostly within a project, some across
        ids = [t for tabs in sitting_tabs.values() for t in tabs]
        by = {t["traceId"]: t for t in traces[-len(ids):]}
        for tabs in sitting_tabs.values():
            for _ in range(len(tabs)):
                if len(tabs) >= 2:
                    a, b = rng.sample(tabs, 2)
                    by[a]["coActive"][b] = by[a]["coActive"].get(b, 0) + 1
        for _ in range(len(ids) // 4):
            a, b = rng.sample(ids, 2)
            by[a]["coActive"][b] = by[a]["coActive"].get(b, 0) + 1
    n_one = max(1, round(len(traces) * one_offs))
    for _ in range(n_one):
        host = rng.choice(ONE_OFF)
        w = rng.randint(1, windows)
        index[w] += 1
        tid = _uid(rng)
        traces.append(_trace(tid, host.split("/")[0], "article/" + str(rng.randint(1, 999)),
                             f"{host.split('.')[0].title()} story {rng.randint(1, 99)}",
                             t0 + rng.randrange(10 * DAY), w, index[w], None, "typed"))
        labels[tid] = None
    return traces, labels


def cold(traces: list, seed: int, revisited: float = 0.3) -> list:
    """Install day: no lineage, no switching history, no digest; some openedAt values are a later
    revisit (history backfill gives the LAST visit, not the opening one)."""
    rng = random.Random(seed + 10_000)
    out = []
    for t in traces:
        c = {**t, "openerTraceId": None, "coActive": {}, "activationCount": 0, "dwellMs": 0,
             "digest": None, "digestAt": None, "backfilled": True}
        if rng.random() < revisited:
            c["openedAt"] = t["openedAt"] + rng.randrange(1, 4 * DAY)
        out.append(c)
    return out


# ---------------------------------------------------------------------------------------------
# The simulated judge
# ---------------------------------------------------------------------------------------------

@dataclass
class Judge:
    """P(same project) with marginal pairwise AUC `auc`; a fraction `rho` of the noise variance is
    shared by every pair between the same two projects (systematic confusion)."""
    auc: float
    rho: float
    seed: int

    def __post_init__(self) -> None:
        self.mu = norm.ppf(min(self.auc, 0.999999)) / math.sqrt(2) if self.auc < 1 else math.inf
        self.rng = np.random.default_rng(self.seed)
        self.block: dict[tuple, float] = {}

    def _key(self, la, lb, a, b):
        ka, kb = la or a, lb or b
        return (ka, kb) if ka <= kb else (kb, ka)

    def z(self, same: bool, key) -> float:
        if math.isinf(self.mu):
            return 10.0 if same else -10.0
        if key not in self.block:
            self.block[key] = self.rng.standard_normal()
        noise = math.sqrt(self.rho) * self.block[key] + math.sqrt(1 - self.rho) * self.rng.standard_normal()
        return self.mu * (1 if same else -1) + noise

    def pair(self, a: str, b: str, labels) -> float:
        la, lb = labels.get(a), labels.get(b)
        return 1 / (1 + math.exp(-self.z(la is not None and la == lb, self._key(la, lb, a, b))))


# ---------------------------------------------------------------------------------------------
# Clustering with arbitrary pair weights, refit with an optional tenth column
# ---------------------------------------------------------------------------------------------

def _partition(kept_ids: list[str], weights: dict[tuple[str, str], float]) -> tuple[list[list[str]], list[str]]:
    g = nx.Graph()
    g.add_nodes_from(kept_ids)
    for (a, b), w in weights.items():
        if w >= W_MIN:
            g.add_edge(a, b, weight=w)
    comms, _ = partition_to_target(g)
    comms = split_large(g, comms)
    return [sorted(c) for c in comms if len(c) >= 2], [next(iter(c)) for c in comms if len(c) < 2]


@dataclass
class Browser:
    labels: dict[str, str | None]
    kept: list[str]
    keys: list[tuple[str, str]]
    x: np.ndarray  # SIGNALS columns
    y: np.ndarray
    cheap: np.ndarray  # shipped-beta affinity, for candidate selection


def browser(traces, labels) -> Browser:
    kept, _ = eligible(traces)
    _, vecs = pair_signals(kept)
    keys = list(vecs)
    x = np.array([[vecs[k][s] for s in SIGNALS] for k in keys])
    y = np.array([int(labels.get(a) is not None and labels.get(a) == labels.get(b)) for a, b in keys])
    betas = load_betas()
    cheap = np.array([affinity(vecs[k], betas) for k in keys])
    return Browser(labels, [t["traceId"] for t in kept], keys, x, y, cheap)


def _fit(xs: list[np.ndarray], ys: list[np.ndarray]) -> np.ndarray:
    m = LogisticRegression(C=1.0, max_iter=5000).fit(np.vstack(xs), np.concatenate(ys))
    return m.coef_[0] * (W_MIN / -m.intercept_[0])  # affinity >= W_MIN  <=>  P >= 0.5


def _groups(b: Browser, w: np.ndarray, x: np.ndarray):
    aff = x @ w
    return _partition(b.kept, {k: float(v) for k, v in zip(b.keys, aff)})


def top_k_mask(b: Browser, k: int = 8) -> np.ndarray:
    """Each tab's k strongest partners by the cheap (no-model) affinity."""
    idx: dict[str, list[tuple[float, int]]] = {}
    for i, (a, c) in enumerate(b.keys):
        idx.setdefault(a, []).append((b.cheap[i], i))
        idx.setdefault(c, []).append((b.cheap[i], i))
    mask = np.zeros(len(b.keys), dtype=bool)
    for lst in idx.values():
        for _, i in sorted(lst, reverse=True)[:k]:
            mask[i] = True
    return mask


def judge_column(b: Browser, judge: Judge, mask: np.ndarray | None = None) -> np.ndarray:
    """2P-1 for judged pairs, 0 (no evidence) for pairs the design never asks about."""
    col = np.zeros(len(b.keys))
    for i, (a, c) in enumerate(b.keys):
        if mask is None or mask[i]:
            col[i] = 2 * judge.pair(a, c, b.labels) - 1
    return col


CONFIDENT = math.log(0.85 / 0.15)  # act only where P >= 0.85 (Laya's own gating example)


def merge_groups(groups: list[list[str]], b: Browser, judge: Judge) -> list[list[str]]:
    """"Are these two groups one project?" for every pair of groups. A pair merges only when the
    judge is confident, and each group merges at most once (its most confident partner): chained
    merges at a 0.5 threshold collapse a browser into one blob at any realistic judge quality."""
    maj = [_majority(g, b.labels) for g in groups]
    best: list[tuple[float, int, int]] = []
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            same = maj[i] is not None and maj[i] == maj[j]
            z = judge.z(same, tuple(sorted((f"g{maj[i]}", f"g{maj[j]}"))))
            if z >= CONFIDENT:
                best.append((z, i, j))
    used: set[int] = set()
    out = [list(g) for g in groups]
    for _, i, j in sorted(best, reverse=True):
        if i in used or j in used:
            continue
        used |= {i, j}
        out[i] = out[i] + out[j]
        out[j] = []
    return [g for g in out if g]


def reassign(groups: list[list[str]], loose: list[str], b: Browser, judge: Judge) -> list[list[str]]:
    """One choice question per tab: "which of these groups does this tab belong to, or none?"
    Moves a tab only when the judge confidently prefers another group; takes it out (loose end)
    only when the judge confidently rejects every group."""
    maj = [_majority(g, b.labels) for g in groups]
    home = {t: i for i, g in enumerate(groups) for t in g}
    out = [list(g) for g in groups]
    for t in [*home, *loose]:
        lt = b.labels.get(t)
        z = [judge.z(lt is not None and lt == m, (f"t{lt}", f"g{m}")) for m in maj]
        if not z:
            continue
        k = int(np.argmax(z))
        cur = home.get(t)
        if z[k] >= CONFIDENT and k != cur:
            if cur is not None:
                out[cur].remove(t)
            out[k].append(t)
        elif cur is not None and max(z) <= -CONFIDENT:
            out[cur].remove(t)
    return [g for g in out if len(g) >= 2]


def _majority(g: list[str], labels) -> str | None:
    counts: dict[str | None, int] = {}
    for t in g:
        counts[labels.get(t)] = counts.get(labels.get(t), 0) + 1
    return max(counts, key=counts.get)


# ---------------------------------------------------------------------------------------------
# The experiment
# ---------------------------------------------------------------------------------------------

AUCS = (0.7, 0.8, 0.9, 0.95, 0.98, 1.0)


TWINS = {frozenset((a[0], b[0])) for a in POOL for b in POOL if a[0] < b[0] and len(set(a[1]) & set(b[1])) >= 2}


def error_mix(b: Browser, groups: list[list[str]]) -> dict[str, int]:
    """Where the clusterer is wrong, by kind: the pairs a judge would have to get right."""
    gid = {t: i for i, g in enumerate(groups) for t in g}
    s3 = SIGNALS.index("S3_session")
    out = dict.fromkeys(["split: same sitting", "split: across sittings", "merged: topic twins",
                         "merged: one-off absorbed", "merged: other"], 0)
    for (a, c), row in zip(b.keys, b.x):
        la, lc = b.labels.get(a), b.labels.get(c)
        same_l = la is not None and la == lc
        same_g = a in gid and gid.get(a) == gid.get(c)
        if same_l and not same_g:
            out["split: same sitting" if row[s3] == 1 else "split: across sittings"] += 1
        elif same_g and not same_l:
            if la is None or lc is None:
                out["merged: one-off absorbed"] += 1
            elif frozenset((la, lc)) in TWINS:
                out["merged: topic twins"] += 1
            else:
                out["merged: other"] += 1
    return out


def run(n_browsers: int = 12, resumed: float = 0.5, rho: float = 0.5) -> pd.DataFrame:
    rows = []
    for condition in ("warm", "cold"):
        bs = []
        for s in range(n_browsers):
            traces, labels = make_realistic(s, resumed=resumed)
            bs.append(browser(cold(traces, s) if condition == "cold" else traces, labels))
        shipped = np.array([load_betas()[s] for s in SIGNALS])
        for i, b in enumerate(bs):
            train = [o for j, o in enumerate(bs) if j != i]
            base = score(_groups(b, shipped, b.x)[0], b.labels).ari
            w = _fit([o.x for o in train], [o.y for o in train])
            groups, loose = _groups(b, w, b.x)
            refit_ari = score(groups, b.labels).ari
            n = len(b.kept)
            common = {"condition": condition, "browser": i, "tabs": n, "shipped": base, "refit": refit_ari,
                      **{f"err {k}": v for k, v in error_mix(b, groups).items()},
                      # how well the FREE signals already answer "same project?" (pairwise AUC)
                      "auc S7": roc_auc_score(b.y, b.x[:, SIGNALS.index("S7_lexical")]),
                      "auc shipped": roc_auc_score(b.y, b.cheap), "auc refit": roc_auc_score(b.y, b.x @ w)}
            for auc in AUCS:
                seed = 1000 * i + int(auc * 100)
                r = dict(common, auc=auc)
                # pairs-all / pairs-top8: judge column, refit with it on the other browsers
                for design, mk in (("pairs-all", lambda o: None), ("pairs-top8", top_k_mask)):
                    cols = [judge_column(o, Judge(auc, rho, seed + j), mk(o)) for j, o in enumerate(train)]
                    wj = _fit([np.c_[o.x, c] for o, c in zip(train, cols)], [o.y for o in train])
                    mask = mk(b)
                    xj = np.c_[b.x, judge_column(b, Judge(auc, rho, seed + 99), mask)]
                    r[design] = score(_groups(b, wj, xj)[0], b.labels).ari
                    r[f"{design} calls"] = int(len(b.keys) if mask is None else mask.sum())
                r["merge"] = score(merge_groups(groups, b, Judge(auc, rho, seed + 7)), b.labels).ari
                r["merge calls"] = len(groups) * (len(groups) - 1) // 2
                r["reassign"] = score(reassign(groups, loose, b, Judge(auc, rho, seed + 8)), b.labels).ari
                r["reassign calls"] = n
                # judge-only: group by the model alone, the way a topic organiser does
                cols = [judge_column(o, Judge(auc, rho, seed + j)) for j, o in enumerate(train)]
                wo = _fit([c[:, None] for c in cols], [o.y for o in train])
                jo = judge_column(b, Judge(auc, rho, seed + 99))[:, None]
                r["judge-only"] = score(_groups(b, wo, jo)[0], b.labels).ari
                rows.append(r)
    return pd.DataFrame(rows)


# Laya English q8 in the browser (laya-web, ORT-web 1.30 wasm, 8 threads, M-series):
# 333 ms at 43 tokens, 974 ms at 195, 2437 ms at 512. Least-squares line through those.
_L = np.array([43, 195, 512])
_MS = np.array([333, 974, 2437])
SLOPE, INTERCEPT = np.polyfit(_L, _MS, 1)


def laya_seconds(calls: float, tokens: float) -> float:
    return calls * (INTERCEPT + SLOPE * tokens) / 1000


def summary(df: pd.DataFrame) -> pd.DataFrame:
    designs = ["pairs-all", "pairs-top8", "merge", "reassign", "judge-only"]
    out = df.groupby(["condition", "auc"])[["shipped", "refit", *designs]].mean()
    for d in designs:
        out[f"+{d}"] = out[d] - out["refit"]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="value of a simulated content judge for grouping")
    ap.add_argument("--browsers", type=int, default=12)
    ap.add_argument("--resumed", type=float, default=0.5, help="chance a project is resumed in another sitting")
    ap.add_argument("--rho", type=float, default=0.5, help="share of judge noise that is systematic per project pair")
    a = ap.parse_args(argv)
    df = run(a.browsers, a.resumed, a.rho)
    pd.set_option("display.width", 200)
    print(f"== judge_sim | {a.browsers} generated browsers | resumed {a.resumed} | rho {a.rho} | "
          f"tabs per browser {df['tabs'].mean():.0f} (min {df['tabs'].min()}, max {df['tabs'].max()})")
    print("   SIMULATED judge on GENERATED browsers: mechanics and orders of magnitude, not a gate number.")
    print("   ARI, mean over browsers; every weight is a leave-one-browser-out refit.\n")
    s = summary(df)
    print(s.round(3).to_string())
    err = df[df.auc == AUCS[0]].groupby("condition")[[c for c in df.columns if c.startswith("err ")]].sum()
    print("\n   where the refit clusterer is wrong (share of wrong pairs, all browsers):")
    print((err.div(err.sum(axis=1), axis=0) * 100).round(1).rename(columns=lambda c: c[4:]).to_string())
    free = df[df.auc == AUCS[0]].groupby("condition")[["auc S7", "auc shipped", "auc refit"]].mean()
    print("\n   what the free signals already score on the same question (pairwise AUC, mean):")
    print(free.round(3).to_string())
    calls = df[df.auc == AUCS[0]].groupby("condition")[[c for c in df.columns if c.endswith("calls")]].mean()
    print("\n   judge calls per browser (mean):")
    print(calls.round(0).to_string())
    print(f"\n   Laya q8 in-browser latency model: {INTERCEPT:.0f} ms + {SLOPE:.2f} ms/token (M-series, 8 threads)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
