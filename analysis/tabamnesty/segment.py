"""Session segmentation. Also the source of the event boundaries the UI labels by (§6.5)."""
from __future__ import annotations

from .config import GAP_MS
from .traces import Trace

NEW_INTENT = frozenset({"typed", "generated", "auto_bookmark"})


def segment(traces: list[Trace], gap_ms: int = GAP_MS) -> list[list[Trace]]:
    """Sort by openedAt; cut on a gap > gap_ms OR on a deliberate new start with no opener."""
    ordered = sorted(traces, key=lambda t: (t["openedAt"], t["traceId"]))
    sessions: list[list[Trace]] = []
    for t in ordered:
        new_start = t["transition"] in NEW_INTENT and not t.get("openerTraceId")
        if not sessions or new_start or t["openedAt"] - sessions[-1][-1]["openedAt"] > gap_ms:
            sessions.append([t])
        else:
            sessions[-1].append(t)
    return sessions


def session_index(traces: list[Trace], gap_ms: int = GAP_MS) -> dict[str, int]:
    return {t["traceId"]: i for i, s in enumerate(segment(traces, gap_ms)) for t in s}
