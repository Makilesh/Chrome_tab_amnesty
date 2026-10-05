"""Synthetic fixtures for unit tests and the parity check. NEVER for the gate: the gate needs
five real browsers. A synthetic browser encodes the thesis it is supposed to test."""
from __future__ import annotations

import json
import random
import uuid
from pathlib import Path

from .traces import SCHEMA_VERSION, Trace

# (project name, hosts it spans, path stem, title words). Two projects share github.com and two
# share docs.python.org on purpose: a topic organiser will merge them, a behavioural one should not.
PROJECTS = [
    ("deploy incident", ["github.com", "grafana.acme.io", "docs.aws.amazon.com"], "acme/deploy", "deploy rollout incident k8s"),
    ("pricing page", ["figma.com", "notion.so", "github.com"], "acme/website/pricing", "pricing plans tiers landing"),
    ("thesis reading", ["arxiv.org", "scholar.google.com", "docs.python.org"], "abs/2406", "attention transformers survey"),
    ("flat hunting", ["rightmove.co.uk", "zoopla.co.uk", "maps.google.com"], "property/flat", "flat rent bedroom balcony"),
    ("pandas bug", ["stackoverflow.com", "docs.python.org", "github.com"], "questions/pandas", "pandas groupby dtype error"),
    ("holiday", ["booking.com", "skyscanner.net", "wikipedia.org"], "hotel/lisbon", "lisbon hotel flight june"),
]
AMBIENT = [("mail.google.com", "gmail.com", "Inbox"), ("open.spotify.com", "spotify.com", "Spotify"),
           ("calendar.google.com", "calendar.google.com", "Calendar")]


def _uid(rng: random.Random) -> str:
    """Seeded so the same seed gives the same fixture in every process."""
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def _etld1(host: str) -> str:
    parts = host.split(".")
    if parts[-2:] == ["co", "uk"]:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _trace(tid: str, host: str, path: str, title: str, opened: int, window: int, index: int,
           opener: str | None, transition: str, **kw) -> Trace:
    toks = [p for p in path.split("/") if p]
    t: Trace = {
        "traceId": tid, "tabId": index + window * 1000, "windowId": window, "index": index,
        "openerTraceId": opener, "openedAt": opened, "transition": transition, "backfilled": False,
        "lastActiveAt": opened, "activationCount": 1, "dwellMs": 20_000, "coActive": {},
        "url": f"https://{host}/{path}", "host": host, "eTLD1": _etld1(host), "pathTokens": toks,
        "queryKeys": {}, "title": title,
        "digest": {"description": f"{title}. Page about {' '.join(toks)}.", "headings": [title], "leadText": ""},
        "digestAt": opened + 3000, "pinned": False, "discarded": False, "closedAt": None,
    }
    t.update(kw)  # type: ignore[typeddict-item]
    return t


def make(seed: int = 1, per_project: tuple[int, int] = (8, 16), windows: int = 2) -> tuple[list[Trace], dict[str, str | None]]:
    rng = random.Random(seed)
    traces: list[Trace] = []
    labels: dict[str, str | None] = {}
    t0 = 1_757_500_000_000
    idx = {w: 0 for w in range(1, windows + 1)}

    def nxt(w: int) -> int:
        idx[w] += 1
        return idx[w]

    # ambient + pinned
    for host, _, title in AMBIENT:
        tid = _uid(rng)
        traces.append(_trace(tid, host, "", title, t0 - 3_600_000, 1, nxt(1), None, "typed", pinned=(title == "Inbox")))
        labels[tid] = None

    clock = t0
    for name, hosts, stem, words in PROJECTS:
        w = rng.randint(1, windows)
        clock += rng.randint(40, 180) * 60_000  # a new sitting, well past the 25-min gap
        n = rng.randint(*per_project)
        wl = words.split()
        root = _uid(rng)
        traces.append(_trace(root, hosts[0], f"{stem}", f"{wl[0].title()} {wl[1]} overview", clock, w, nxt(w), None, "typed"))
        labels[root] = name
        members = [root]
        for i in range(n - 1):
            clock += rng.randint(20, 240) * 1000
            opener = rng.choice(members[-4:])  # bursts branch off recent tabs
            host = rng.choice(hosts)
            tid = _uid(rng)
            title = f"{rng.choice(wl)} {rng.choice(wl)} {rng.randint(1, 99)}"
            traces.append(_trace(tid, host, f"{stem}/{rng.choice(wl)}/{i}", title, clock, w, nxt(w), opener, "link"))
            labels[tid] = name
            members.append(tid)
        # some co-activation inside the project
        for _ in range(n):
            a, b = rng.sample(members, 2)
            ta, tb = next(x for x in traces if x["traceId"] == a), next(x for x in traces if x["traceId"] == b)
            for x, y in ((ta, b), (tb, a)):
                x["coActive"][y] = x["coActive"].get(y, 0) + 1
                x["activationCount"] += 1

    # loose ends: typed one-offs with nothing in common
    for host, title in [("weather.com", "Weather"), ("bbc.co.uk", "News front page"), ("amazon.com", "USB-C cable")]:
        clock += rng.randint(30, 90) * 60_000
        tid = _uid(rng)
        traces.append(_trace(tid, host, title.lower().replace(" ", "-"), title, clock, rng.randint(1, windows), nxt(1), None, "typed"))
        labels[tid] = None
    rng.shuffle(traces)
    return traces, labels


def chrome_like(traces: list[Trace]) -> dict:
    """What a topic organiser does: one group per eTLD+1 with 2+ tabs. The baseline to beat."""
    by: dict[str, list[str]] = {}
    for t in traces:
        if t["pinned"]:
            continue
        by.setdefault(t["eTLD1"], []).append(t["traceId"])
    groups = [{"name": k, "color": "grey", "traceIds": v} for k, v in by.items() if len(v) >= 2]
    placed = {tid for g in groups for tid in g["traceIds"]}
    return {"method": "transcribed", "capturedAt": 0, "_synthetic": True, "groups": groups,
            "ungrouped": [t["traceId"] for t in traces if t["traceId"] not in placed]}


def write(name: str, out_dir: Path, seed: int = 1) -> None:
    traces, labels = make(seed)
    lo = min(t["openedAt"] for t in traces)
    hi = max(t["openedAt"] for t in traces)
    fixture = {"schemaVersion": SCHEMA_VERSION, "exportedAt": hi, "mode": "full", "_synthetic": True,
               "traceCount": len(traces), "openedAtMin": lo, "openedAtMax": hi, "traces": traces}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{name}.json").write_text(json.dumps(fixture, indent=1), encoding="utf-8")
    (out_dir / f"{name}.labels.json").write_text(
        json.dumps({"_comment": "SYNTHETIC. Not a real browser; never counts toward the gate.", **labels}, indent=1),
        encoding="utf-8")
    (out_dir / f"{name}.chrome.json").write_text(json.dumps(chrome_like(traces), indent=1), encoding="utf-8")



# ---------------------------------------------------------------------------------------------
# Adversarial fixtures: positive controls for the ablation. Four projects on the SAME host with
# the SAME vocabulary, INTERLEAVED in time and on the tab strip, distinguishable by exactly one
# behavioural signal. If zeroing that signal does not crater ARI here, the ablation is broken.
# `multilingual` is the one content control: each project has its own vocabulary in its own
# script and only S7 can tell them apart. It also keeps non-English text under `npm run parity`.
# Mechanics only — never counts toward the gate.
# ---------------------------------------------------------------------------------------------

ADVERSARIAL = ("lineage", "coactive", "temporal", "multilingual")

# Hindi, Tamil, Japanese (no spaces between words), German (accents). Titles are two words drawn
# from one row; the shared path is percent-encoded Japanese, as chrome gives it to us.
MULTILINGUAL_VOCAB = (
    "बजट किराया बिजली बचत खर्च रसीद".split(),
    "தேர்வு பாடம் வினா விடை மதிப்பெண் அட்டவணை".split(),
    "東京旅行 新幹線予約 温泉旅館 観光案内 京都散策 夜行バス".split(),
    "Überweisung Gebühren Kündigung Mietvertrag Nebenkosten Stromanbieter".split(),
)
MULTILINGUAL_PATH = "wiki/%E3%83%A1%E3%82%A4%E3%83%B3"  # /wiki/メイン, identical on every tab


def make_adversarial(kind: str, seed: int = 1, projects: int = 4, per_project: int = 10,
                     burst: tuple[int, int] = (1, 4)) -> tuple[list[Trace], dict[str, str | None]]:
    """Projects interleave in bursts of `burst` tabs (a person works on A for a few tabs, then B,
    then back). Strict one-tab round-robin is too pathological: every tab's nearest neighbours
    in time and on the strip belong to other projects, and with the brief's weights the
    contemporaneity signals (S2+S3+S4 ≈ 4.5) then outvote lineage (S1 ≈ 0.9 on average) —
    see docs/DECISIONS.md."""
    assert kind in ADVERSARIAL
    rng = random.Random(seed)
    host, stem = "github.com", "acme/platform"
    vocab = "deploy pipeline config service module release".split()
    clock = 1_757_500_000_000
    traces: list[Trace] = []
    labels: dict[str, str | None] = {}
    members: list[list[str]] = [[] for _ in range(projects)]
    remaining = [per_project] * projects
    idx = 0

    def add(p: int) -> None:
        nonlocal clock, idx
        remaining[p] -= 1
        clock += rng.randint(15, 45) * 1000
        idx += 1
        tid = _uid(rng)
        opener = rng.choice(members[p][-3:]) if kind == "lineage" and members[p] else None
        if kind == "multilingual":
            words = MULTILINGUAL_VOCAB[p % len(MULTILINGUAL_VOCAB)]
            title = f"{rng.choice(words)} {rng.choice(words)}"
            traces.append(_trace(tid, "wikipedia.org", MULTILINGUAL_PATH, title, clock, 1, idx, opener, "link"))
        else:
            title = f"{rng.choice(vocab)} {rng.choice(vocab)}"
            traces.append(_trace(tid, host, f"{stem}/{rng.choice(vocab)}", title, clock, 1, idx, opener, "link"))
        labels[tid] = f"project {p}"
        members[p].append(tid)

    if kind == "temporal":
        # not interleaved: the projects are separated only by gaps in time
        for p in range(projects):
            if p:
                clock += 40 * 60_000  # longer than GAP_MS
            while remaining[p]:
                add(p)
    else:
        while any(remaining):
            p = rng.choice([i for i in range(projects) if remaining[i]])
            for _ in range(min(rng.randint(*burst), remaining[p])):
                add(p)
    if kind == "coactive":
        by = {t["traceId"]: t for t in traces}
        for group in members:
            for a in group:
                for b in group:
                    if a < b:
                        by[a]["coActive"][b] = 1
                        by[b]["coActive"][a] = 1
            for a in group:
                by[a]["activationCount"] = len(group)
    return traces, labels


def write_adversarial(out_dir: Path, seed: int = 1) -> None:
    for kind in ADVERSARIAL:
        traces, labels = make_adversarial(kind, seed)
        lo, hi = min(t["openedAt"] for t in traces), max(t["openedAt"] for t in traces)
        name = f"synthetic_{kind}"
        fixture = {"schemaVersion": SCHEMA_VERSION, "exportedAt": hi, "mode": "full", "_synthetic": True,
                   "traceCount": len(traces), "openedAtMin": lo, "openedAtMax": hi, "traces": traces}
        (out_dir / f"{name}.json").write_text(json.dumps(fixture, indent=1, ensure_ascii=False), encoding="utf-8")
        (out_dir / f"{name}.labels.json").write_text(
            json.dumps({"_comment": f"SYNTHETIC positive control for {kind}. Never counts toward the gate.", **labels},
                       indent=1, ensure_ascii=False),
            encoding="utf-8")
        (out_dir / f"{name}.chrome.json").write_text(json.dumps(chrome_like(traces), indent=1), encoding="utf-8")

if __name__ == "__main__":
    import sys
    from .config import FIXTURES
    write(sys.argv[1] if len(sys.argv) > 1 else "synthetic", FIXTURES)
    write_adversarial(FIXTURES)
