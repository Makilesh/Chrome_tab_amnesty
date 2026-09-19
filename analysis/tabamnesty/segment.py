"""Session segmentation. Also the source of the event boundaries the UI labels by (§6.5)."""
from __future__ import annotations

from .config import GAP_MS
from .traces import Trace

NEW_INTENT = frozenset({"typed", "generated", "auto_bookmark"})

# A backfilled trace's openedAt comes from history. When the best visit history had was a
# 'reload' (session restore, F5) or nothing at all ('unknown' -> adoption time), that timestamp
# is when the browser restarted, not when the tab was opened: every pre-install tab shares it to
# within seconds. Such timing is evidence of nothing.
FAKE_TIMING = frozenset({"reload", "unknown"})


def timing_known(t: Trace) -> bool:
    return not t.get("backfilled") or t["transition"] not in FAKE_TIMING


def segment(traces: list[Trace], gap_ms: int = GAP_MS) -> list[list[Trace]]:
    """Sort by openedAt; cut on a gap > gap_ms OR on a deliberate new start with no opener.
    Traces with unknown timing take no part in the gaps and each become their own session,
    appended after the real ones."""
    key = lambda t: (t["openedAt"], t["traceId"])  # noqa: E731
    ordered = sorted((t for t in traces if timing_known(t)), key=key)
    sessions: list[list[Trace]] = []
    for t in ordered:
        new_start = t["transition"] in NEW_INTENT and not t.get("openerTraceId")
        if not sessions or new_start or t["openedAt"] - sessions[-1][-1]["openedAt"] > gap_ms:
            sessions.append([t])
        else:
            sessions[-1].append(t)
    sessions.extend([t] for t in sorted((t for t in traces if not timing_known(t)), key=key))
    return sessions


def session_index(traces: list[Trace], gap_ms: int = GAP_MS) -> dict[str, int]:
    return {t["traceId"]: i for i, s in enumerate(segment(traces, gap_ms)) for t in s}
