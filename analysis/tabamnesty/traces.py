"""Fixture I/O. A fixture is the JSON the x-ray page exports: header + TabTrace[]."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TypedDict

SCHEMA_VERSION = 1  # must match src/cluster/types.ts


class Trace(TypedDict, total=False):
    traceId: str
    tabId: int
    windowId: int
    index: int
    openerTraceId: str | None
    openedAt: int
    transition: str
    backfilled: bool
    lastActiveAt: int | None
    activationCount: int
    dwellMs: int
    coActive: dict[str, int]
    url: str
    host: str
    eTLD1: str
    pathTokens: list[str]
    queryKeys: dict[str, str]
    title: str
    digest: dict[str, Any] | None
    digestAt: int | None
    pinned: bool
    discarded: bool
    closedAt: int | None


def load_fixture(path: str | Path) -> list[Trace]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):  # bare TabTrace[] — tolerated for hand-made test fixtures
        return data
    v = data.get("schemaVersion")
    if v != SCHEMA_VERSION:
        raise ValueError(f"{path}: schemaVersion {v!r} != {SCHEMA_VERSION}; re-export the fixture")
    return data["traces"]


def load_labels(path: str | Path) -> dict[str, str | None]:
    """traceId -> project name. null means 'no project' and scores as its own singleton.

    '' means 'not labelled yet' (tools/labels-template.ts) and is left out: scoring it as 'no
    project' graded the clusterer against answers nobody gave. count_unlabelled() says how many.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_") and v != ""}


def count_unlabelled(path: str | Path) -> int:
    """Tabs the labels file leaves at '' (not labelled yet) — reported, never scored."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return sum(1 for k, v in raw.items() if not k.startswith("_") and v == "")


def load_chrome(path: str | Path) -> dict:
    """{ method, capturedAt, groups: [{name, color, traceIds}], ungrouped: [], preexisting?: [] }

    `preexisting`: tabs that sat in groups the person already had when the capture page opened.
    Chrome's organiser did not place them, so they are left out of the comparison with Chrome
    rather than scored as its singletons (comparison_universe).
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("method") not in ("captured", "transcribed"):
        raise ValueError(f"{path}: method must be 'captured' or 'transcribed'")
    return data
