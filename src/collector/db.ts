/**
 * IndexedDB access for the collector. Every write goes here immediately — the MV3 service
 * worker can die at any moment (§5.5), so nothing of consequence lives in a global.
 *
 * Records are keyed on traceId, never tabId (§5.3). tabId is an index for live lookups only.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OpenSnapshot } from '../archive/study';
import type { ArchiveCard, SummariseJob } from '../archive/types';
import type { TabTrace } from '../cluster/types';

export const DB_NAME = 'tab-amnesty';
/** v2 (Phase 1): archive cards, the summarisation queue and the never-remember list. */
export const DB_VERSION = 2;

/** Window of foregroundings that count as co-activation (§7 Phase 0a). */
export const CO_ACTIVE_WINDOW_MS = 60_000;

/** One entry per recent foregrounding, kept in the meta store so it survives worker death. */
export interface Activation {
  traceId: string;
  at: number;
}

interface MetaRecords {
  /** The tab currently in the foreground, and since when. Used to accrue dwellMs. */
  activeNow: { traceId: string; since: number } | null;
  /** Foregroundings inside the last CO_ACTIVE_WINDOW_MS, newest last. */
  recentActivations: Activation[];
  /** Registrable domains the person asked us never to remember (§6.10). Lower-case eTLD+1. */
  neverRemember: string[];
  /** Phase 1 study only: open-tab count every few hours. Never shown in the product (§6.1). */
  openSnapshots: OpenSnapshot[];
}

interface TabAmnestyDB extends DBSchema {
  traces: {
    key: string;
    value: TabTrace;
    indexes: { byTabId: number; byUrl: string; byClosedAt: number };
  };
  meta: {
    key: keyof MetaRecords;
    value: MetaRecords[keyof MetaRecords];
  };
  archive: {
    key: string;
    value: ArchiveCard;
    indexes: { byArchivedAt: number };
  };
  jobs: {
    key: string;
    value: SummariseJob;
    indexes: { byState: string };
  };
}

let dbPromise: Promise<IDBPDatabase<TabAmnestyDB>> | null = null;

/** Cached connection. Safe to cache: if the worker dies the module re-evaluates and re-opens. */
export function db(): Promise<IDBPDatabase<TabAmnestyDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TabAmnestyDB>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const traces = d.createObjectStore('traces', { keyPath: 'traceId' });
          traces.createIndex('byTabId', 'tabId');
          traces.createIndex('byUrl', 'url');
          traces.createIndex('byClosedAt', 'closedAt');
          d.createObjectStore('meta');
        }
        if (oldVersion < 2) {
          d.createObjectStore('archive', { keyPath: 'cardId' }).createIndex('byArchivedAt', 'archivedAt');
          d.createObjectStore('jobs', { keyPath: 'jobId' }).createIndex('byState', 'state');
        }
      },
    });
  }
  return dbPromise;
}

export async function putTrace(trace: TabTrace): Promise<void> {
  await (await db()).put('traces', trace);
}

export async function getTrace(traceId: string): Promise<TabTrace | undefined> {
  return (await db()).get('traces', traceId);
}

/**
 * The live trace for a tabId: open (closedAt null) and, if several stale records share the id
 * from before a restart, the most recently opened.
 */
export async function getTraceByTabId(tabId: number): Promise<TabTrace | undefined> {
  const all = await (await db()).getAllFromIndex('traces', 'byTabId', tabId);
  return all
    .filter((t) => t.closedAt === null)
    .sort((a, b) => b.openedAt - a.openedAt)[0];
}

export async function getOpenTraces(): Promise<TabTrace[]> {
  const all = await (await db()).getAll('traces');
  return all.filter((t) => t.closedAt === null);
}

export async function getAllTraces(): Promise<TabTrace[]> {
  return (await db()).getAll('traces');
}

/** The one legitimate deletion: the person said "forget this" (§6.10). */
export async function deleteTrace(traceId: string): Promise<void> {
  await (await db()).delete('traces', traceId);
}

/**
 * Read-modify-write inside one readwrite transaction so concurrent events on the same tab
 * (onActivated racing onUpdated, say) cannot clobber each other. `fn` returns the new record or
 * null to leave it untouched.
 */
export async function updateTrace(
  traceId: string,
  fn: (t: TabTrace) => TabTrace | null,
): Promise<TabTrace | undefined> {
  const tx = (await db()).transaction('traces', 'readwrite');
  const current = await tx.store.get(traceId);
  if (!current) {
    await tx.done;
    return undefined;
  }
  const next = fn(current);
  if (next) await tx.store.put(next);
  await tx.done;
  return next ?? current;
}

/** Same as updateTrace but resolves the trace by live tabId first. */
export async function updateTraceByTabId(
  tabId: number,
  fn: (t: TabTrace) => TabTrace | null,
): Promise<TabTrace | undefined> {
  const t = await getTraceByTabId(tabId);
  if (!t) return undefined;
  return updateTrace(t.traceId, fn);
}

export async function getMeta<K extends keyof MetaRecords>(key: K): Promise<MetaRecords[K] | undefined> {
  return (await db()).get('meta', key) as Promise<MetaRecords[K] | undefined>;
}

export async function setMeta<K extends keyof MetaRecords>(key: K, value: MetaRecords[K]): Promise<void> {
  await (await db()).put('meta', value, key);
}
