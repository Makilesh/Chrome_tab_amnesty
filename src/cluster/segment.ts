/** Session segmentation. Also the source of the event boundaries the UI labels by (§6.5). */
import { GAP_MS } from './params';
import { NEW_INTENT, type TabTrace } from './types';

/** Sort by openedAt; cut on a gap > gapMs OR on a deliberate new start with no opener. */
export function segment(traces: TabTrace[], gapMs = GAP_MS): TabTrace[][] {
  const ordered = [...traces].sort(
    (a, b) => a.openedAt - b.openedAt || (a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0),
  );
  const sessions: TabTrace[][] = [];
  for (const t of ordered) {
    const newStart = NEW_INTENT.has(t.transition) && !t.openerTraceId;
    const last = sessions[sessions.length - 1];
    if (!last || newStart || t.openedAt - last[last.length - 1]!.openedAt > gapMs) {
      sessions.push([t]);
    } else {
      last.push(t);
    }
  }
  return sessions;
}

export function sessionIndex(traces: TabTrace[], gapMs = GAP_MS): Map<string, number> {
  const out = new Map<string, number>();
  segment(traces, gapMs).forEach((s, i) => s.forEach((t) => out.set(t.traceId, i)));
  return out;
}
