/**
 * How a visit started — typed, a link, a bookmark, a search... — the best task-boundary signal
 * Chrome exposes. It arrives with each page as it commits (webNavigation.onCommitted, in
 * background.ts); Tab Amnesty no longer reads browsing history for it (DECISIONS 2026-11-10).
 */
import type { Transition } from '../cluster/types';

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

/** Chrome's own word for it, in the vocabulary the clusterer uses; 'start_page' is history's 'auto_toplevel'. */
export function asTransition(raw: string | undefined): Transition {
  if (raw === 'start_page') return 'auto_toplevel';
  return raw && KNOWN.has(raw) ? (raw as Transition) : 'unknown';
}
