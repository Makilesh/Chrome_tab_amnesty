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
    """traceId -> project name. null / '' means 'no project' and scores as its own singleton."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return {k: (v or None) for k, v in raw.items() if not k.startswith("_")}


def load_chrome(path: str | Path) -> dict:
    """{ method, capturedAt, groups: [{name, color, traceIds}], ungrouped: [] }"""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("method") not in ("captured", "transcribed"):
        raise ValueError(f"{path}: method must be 'captured' or 'transcribed'")
    return data
