/**
 * IndexedDB access for the collector. Every write goes here immediately — the MV3 service
 * worker can die at any moment (§5.5), so nothing of consequence lives in a global.
 *
 * Records are keyed on traceId, never tabId (§5.3). tabId is an index for live lookups only.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { noteCreated, noteReset, readBackup } from '../archive/backup';
import type { RememberedName } from '../archive/naming';
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
  /** Model names remembered per group, so a project keeps its name across sweeps (naming.ts). */
  groupNames: RememberedName[];
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
let onReset: (() => void) | null = null;

/**
 * What the collector's worker does after Chrome hands back an empty database: adopt the open tabs
 * again. When an extension page is the first to open the empty database, the worker is told by a
 * `database-reset` message instead.
 */
export function onDatabaseReset(fn: () => void): void {
  onReset = fn;
}

/**
 * The database was just created from nothing: a first install, or Chrome replacing a database it
 * could not open (the owner's, 7 Oct 00:09 — DECISIONS 2026-10-07). After a replacement, put the
 * second copy back (archived projects, the never-remember list, the study's snapshots) before
 * anything reads, note when it happened, and get the open tabs adopted again.
 */
async function afterCreate(d: IDBPDatabase<TabAmnestyDB>, dataLoss: string): Promise<void> {
  try {
    const backup = await readBackup();
    if (!backup) return;
    const now = Date.now();
    if (backup.createdAt === undefined) {
      await noteCreated(now);
      return;
    }
    const tx = d.transaction(['archive', 'meta'], 'readwrite');
    for (const card of backup.cards) await tx.objectStore('archive').put(card);
    if (backup.neverRemember) await tx.objectStore('meta').put(backup.neverRemember, 'neverRemember');
    if (backup.openSnapshots) await tx.objectStore('meta').put(backup.openSnapshots, 'openSnapshots');
    await tx.done;
    await noteReset({ at: now, dataLoss });
    if (onReset) onReset();
    else await chrome.runtime.sendMessage({ type: 'database-reset' }).catch(() => {});
  } catch {
    // Recording matters more than restoring: the copy stays where it is for the next start.
  }
}

/**
 * Cached connection. Safe to cache: if the worker dies the module re-evaluates and re-opens.
 *
 * Builds of different ages can share this database: Chrome keeps running the worker it registered
 * until the extension is reloaded, while pages load whatever build is on disk. So this connection
 * gives way when a newer build asks to upgrade, and a database already past DB_VERSION is opened
 * as it is — later versions only ever add stores. The 11 Sep worker had neither and recorded
 * nothing for two weeks once a Phase 1 page moved the database to v2 (DECISIONS 2026-10-06).
 */
export function db(): Promise<IDBPDatabase<TabAmnestyDB>> {
  if (!dbPromise) {
    const giveWay = (d: IDBPDatabase<TabAmnestyDB>) => () => {
      d.close();
      dbPromise = null;
    };
    const fresh = { created: false, dataLoss: 'none' };
    dbPromise = openDB<TabAmnestyDB>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion, _newVersion, _tx, event) {
        if (oldVersion < 1) {
          fresh.created = true;
          // Chrome-only: 'total' when it had to throw the previous database away.
          fresh.dataLoss = (event as IDBVersionChangeEvent & { dataLoss?: string }).dataLoss ?? 'unknown';
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
    })
      .catch(async (e: unknown) => {
        if ((e as { name?: string })?.name !== 'VersionError') throw e;
        return openDB<TabAmnestyDB>(DB_NAME);
      })
      .then(async (d) => {
        d.addEventListener('versionchange', giveWay(d));
        if (fresh.created) await afterCreate(d, fresh.dataLoss);
        return d;
      })
      .catch((e: unknown) => {
        dbPromise = null; // the next call tries again instead of failing forever
        throw e;
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
