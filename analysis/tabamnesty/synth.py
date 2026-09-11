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


if __name__ == "__main__":
    import sys
    from .config import FIXTURES
    write(sys.argv[1] if len(sys.argv) > 1 else "synthetic", FIXTURES)
