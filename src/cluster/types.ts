/**
 * Shared record types. This file is imported by the collector, the clusterer, the UI and the
 * tools — it must stay free of `chrome.*` so `src/cluster/` can run in plain Node.
 */

/** Bump when the shape of TabTrace changes. Fixtures carry it; old fixtures must fail loudly. */
export const SCHEMA_VERSION = 1;

/**
 * chrome.history TransitionType, plus 'unknown' for when no visit matched `openedAt`.
 * 'unknown' is NOT continuation evidence and must not be treated as 'link'.
 */
export type Transition =
  | 'link'
  | 'typed'
  | 'auto_bookmark'
  | 'auto_subframe'
  | 'manual_subframe'
  | 'generated'
  | 'auto_toplevel'
  | 'form_submit'
  | 'reload'
  | 'keyword'
  | 'keyword_generated'
  | 'unknown';

/** Transitions that mean "a deliberate new start" rather than a continuation. */
export const NEW_INTENT: ReadonlySet<Transition> = new Set<Transition>([
  'typed',
  'generated',
  'auto_bookmark',
]);

export interface Digest {
  /** <meta name=description> or og:description; '' when absent. */
  description: string;
  /** h1..h3 in document order, capped. */
  headings: string[];
  /** First meaningful paragraphs, ≤ 1000 chars. Dropped in shareable exports. */
  leadText: string;
}

export interface TabTrace {
  // --- identity. traceId is the key; tabId/windowId/index are live bindings (§5.3) ---
  traceId: string;
  tabId: number;
  windowId: number;
  index: number;

  // --- lineage & intent. EVENT-TIME ONLY (§5.1) ---
  openerTraceId: string | null;
  /** epoch ms, from onCreated (or the last history visit when backfilled) */
  openedAt: number;
  /** history visit nearest openedAt */
  transition: Transition;
  /**
   * True when openedAt/transition came from chrome.history rather than a live onCreated event —
   * tabs that already existed at install or could not be re-bound on startup. Lineage is never
   * backfilled: openerTraceId is null for these.
   */
  backfilled: boolean;

  // --- activity. Maintained by us, never from tab.lastAccessed (§5.2) ---
  lastActiveAt: number | null;
  activationCount: number;
  dwellMs: number;
  /** traceId -> number of times the two were foregrounded within 60 s of each other */
  coActive: Record<string, number>;

  // --- url features ---
  /** Full URL; needed for (url, windowId) re-bind on startup. Reduced to host+path in shareable exports. */
  url: string;
  host: string;
  eTLD1: string;
  pathTokens: string[];
  /** query key -> value. Values are blanked in shareable exports; keys are kept for S6. */
  queryKeys: Record<string, string>;

  // --- content ---
  title: string;
  digest: Digest | null;
  digestAt: number | null;

  // --- state ---
  pinned: boolean;
  discarded: boolean;
  /** Set when the tab closes. The record is kept — nothing is deleted. Null while open. */
  closedAt: number | null;
}

/** Header + traces, as written by the x-ray page export. */
export interface TraceFixture {
  schemaVersion: number;
  exportedAt: number;
  mode: 'full' | 'shareable';
  traceCount: number;
  openedAtMin: number;
  openedAtMax: number;
  traces: TabTrace[];
}

/** Output of the clusterer. Never a "Miscellaneous" group. */
export interface Partition {
  communities: Community[];
  /** traceIds that did not land in any community. */
  looseEnds: string[];
}

export interface Community {
  /** Stable within a run only. */
  id: number;
  traceIds: string[];
}
