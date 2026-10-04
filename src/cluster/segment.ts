/** Session segmentation. Also the source of the event boundaries the UI labels by (§6.5). */
import { GAP_MS } from './params';
import { NEW_INTENT, type TabTrace, type Transition } from './types';

/**
 * A backfilled trace's openedAt comes from history. When the best visit history had was a
 * 'reload' (session restore, F5) or nothing at all ('unknown' -> adoption time), that timestamp
 * is when the browser restarted, not when the tab was opened: every pre-install tab shares it to
 * within seconds. Such timing is evidence of nothing.
 */
const FAKE_TIMING: ReadonlySet<Transition> = new Set<Transition>(['reload', 'unknown']);

/**
 * The opener that counts as lineage. Chrome reports an openerTabId for a tab opened with Ctrl+T
 * and then typed into (or searched, or a bookmark) — the tab you happened to be on. On the first
 * real exports every typed and generated visit had one. A deliberate new start is not a
 * continuation, so it roots a new tree; its own children still hang off it.
 */
export function lineageParent(t: TabTrace): string | null {
  const p = t.openerTraceId;
  if (!p || p === t.traceId || NEW_INTENT.has(t.transition)) return null;
  return p;
}

export function timingKnown(t: TabTrace): boolean {
  return !t.backfilled || !FAKE_TIMING.has(t.transition);
}

const byTime = (a: TabTrace, b: TabTrace): number =>
  a.openedAt - b.openedAt || (a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0);

/**
 * Sort by openedAt; cut on a gap > gapMs OR on a deliberate new start (typed, searched,
 * bookmark) whatever opener Chrome reports for it — see lineageParent(). Traces
 * with unknown timing take no part in the gaps and each become their own session, appended
 * after the real ones.
 */
export function segment(traces: TabTrace[], gapMs = GAP_MS): TabTrace[][] {
  const ordered = traces.filter(timingKnown).sort(byTime);
  const sessions: TabTrace[][] = [];
  for (const t of ordered) {
    const newStart = NEW_INTENT.has(t.transition);
    const last = sessions[sessions.length - 1];
    if (!last || newStart || t.openedAt - last[last.length - 1]!.openedAt > gapMs) {
      sessions.push([t]);
    } else {
      last.push(t);
    }
  }
  for (const t of traces.filter((t) => !timingKnown(t)).sort(byTime)) sessions.push([t]);
  return sessions;
}

export function sessionIndex(traces: TabTrace[], gapMs = GAP_MS): Map<string, number> {
  const out = new Map<string, number>();
  segment(traces, gapMs).forEach((s, i) => s.forEach((t) => out.set(t.traceId, i)));
  return out;
}
