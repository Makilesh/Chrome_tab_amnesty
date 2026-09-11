/**
 * Transition lookup via chrome.history. The transition type (typed / link / generated / ...) is
 * the best task-boundary signal Chrome exposes, and it only lives in history, so we read it there.
 */
import type { Transition } from '../cluster/types';

/** A visit further than this from openedAt is not the visit that opened the tab. */
const MATCH_TOLERANCE_MS = 60_000;

const KNOWN: ReadonlySet<string> = new Set<Transition>([
  'link',
  'typed',
  'auto_bookmark',
  'auto_subframe',
  'manual_subframe',
  'generated',
  'auto_toplevel',
  'form_submit',
  'reload',
  'keyword',
  'keyword_generated',
]);

function asTransition(raw: string | undefined): Transition {
  return raw && KNOWN.has(raw) ? (raw as Transition) : 'unknown';
}

async function visitsFor(url: string): Promise<chrome.history.VisitItem[]> {
  if (!/^https?:/.test(url)) return [];
  try {
    return await chrome.history.getVisits({ url });
  } catch {
    return [];
  }
}

/** The transition of the visit nearest `openedAt`, or 'unknown' if none is close enough. */
export async function transitionNear(url: string, openedAt: number): Promise<Transition> {
  const visits = await visitsFor(url);
  let best: chrome.history.VisitItem | undefined;
  let bestDt = Infinity;
  for (const v of visits) {
    if (v.visitTime === undefined) continue;
    const dt = Math.abs(v.visitTime - openedAt);
    if (dt < bestDt) {
      bestDt = dt;
      best = v;
    }
  }
  if (!best || bestDt > MATCH_TOLERANCE_MS) return 'unknown';
  return asTransition(best.transition);
}

/**
 * For tabs we did not see open (install-time adoption, failed re-bind): the most recent visit to
 * that URL, giving a backfilled openedAt and transition.
 */
export async function lastVisit(
  url: string,
): Promise<{ visitTime: number; transition: Transition } | null> {
  const visits = await visitsFor(url);
  let best: chrome.history.VisitItem | undefined;
  for (const v of visits) {
    if (v.visitTime === undefined) continue;
    if (!best || v.visitTime > (best.visitTime ?? 0)) best = v;
  }
  if (!best || best.visitTime === undefined) return null;
  return { visitTime: best.visitTime, transition: asTransition(best.transition) };
}
