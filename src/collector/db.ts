/**
 * IndexedDB access for the collector. Every write goes here immediately — the MV3 service
 * worker can die at any moment (§5.5), so nothing of consequence lives in a global.
 *
 * Records are keyed on traceId, never tabId (§5.3). tabId is an index for live lookups only.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { type Backup, markRestorePending, mergePresses, mergeSnapshots, noteCreated, noteReset, readBackup, type Reset } from '../archive/backup';
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
  /**
   * Phase 1 study only: when Archive & close was pressed — times, nothing else. Kept when the card
   * is forgotten, so forgetting a card does not un-press it in the study (it used to).
   */
  presses: number[];
  /** Model names remembered per group, so a project keeps its name across sweeps (naming.ts). */
  groupNames: RememberedName[];
  /** Each time Chrome replaced this database with an empty one (copied from backup.ts). */
  resets: Reset[];
  /** When the Summarizer last turned out unavailable here; jobs set aside then are retried daily. */
  summariserCheckedAt: number;
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
/** Not before this moment may this context open the database again (see the versionchange handler). */
let reopenAt = 0;
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
    // Anything in the copy means there was a database before this one — even if the copy was
    // still being filled in (pages write to it before a new worker has seeded it).
    const hadOne =
      backup.createdAt !== undefined || backup.cards.length > 0 || backup.neverRemember !== undefined || backup.openSnapshots !== undefined || backup.presses !== undefined;
    if (!hadOne) {
      await noteCreated(now);
      return;
    }
    const resets = await noteReset({ at: now, dataLoss });
    await markRestorePending(true); // cleared only once the restore has gone through
    await restoreInto(d, backup, resets);
    await markRestorePending(false);
    if (onReset) onReset();
    else await chrome.runtime.sendMessage({ type: 'database-reset' }).catch(() => {});
  } catch {
    // Recording matters more than restoring. The restore stays pending: the worker tries it again
    // on its next start (store.ts seedBackup), and until then the copy is only ever added to.
  }
}

/**
 * Put the second copy back into a database. Safe to repeat: a card already there is left as it
 * is, lists are merged. Forgetting changes the copy first (backup.ts), so nothing forgotten in the
 * meantime comes back through a retry.
 */
export async function restoreInto(d: IDBPDatabase<TabAmnestyDB>, backup: Backup, resets?: Reset[]): Promise<void> {
  const tx = d.transaction(['archive', 'meta'], 'readwrite');
  const archive = tx.objectStore('archive');
  const meta = tx.objectStore('meta');
  for (const card of backup.cards) if (!(await archive.get(card.cardId))) await archive.put(card);
  if (backup.neverRemember) {
    const now = ((await meta.get('neverRemember')) as string[] | undefined) ?? [];
    await meta.put([...new Set([...now, ...backup.neverRemember])], 'neverRemember');
  }
  if (backup.openSnapshots) await meta.put(mergeSnapshots(((await meta.get('openSnapshots')) as OpenSnapshot[] | undefined) ?? [], backup.openSnapshots), 'openSnapshots');
  if (backup.presses) await meta.put(mergePresses(((await meta.get('presses')) as number[] | undefined) ?? [], backup.presses), 'presses');
  if (resets) await meta.put(resets, 'resets');
  await tx.done;
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
    // Only this connection's own events may drop the cached promise, never a newer one's.
    const drop = () => {
      if (dbPromise === opening) dbPromise = null;
    };
    const fresh = { created: false, dataLoss: 'none' };
    const wait = reopenAt - Date.now();
    const opening: Promise<IDBPDatabase<TabAmnestyDB>> = (wait > 0 ? new Promise<void>((r) => setTimeout(r, wait)) : Promise.resolve())
      .then(() => openDB<TabAmnestyDB>(DB_NAME, DB_VERSION, {
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
    }))
      .catch(async (e: unknown) => {
        if ((e as { name?: string })?.name !== 'VersionError') throw e;
        return openDB<TabAmnestyDB>(DB_NAME);
      })
      .then(async (d) => {
        d.addEventListener('versionchange', () => {
          d.close();
          drop();
          // Not straight back in: an open request sent in the same moment as this close could
          // hang for good — never upgrading, never blocked, never failing — with every later
          // request, the upgrade we gave way to included, queued behind it. One run in three of
          // `npm run check` step 9; none in 30 with this pause (DECISIONS 2026-10-17).
          reopenAt = Date.now() + 250;
        });
        // Chrome closes a connection itself on an I/O error, corruption or cleared site data:
        // the 'close' event, never 'versionchange'. Keeping that handle failed every later write
        // until the worker happened to restart.
        d.addEventListener('close', drop);
        if (fresh.created) await afterCreate(d, fresh.dataLoss);
        return d;
      })
      .catch((e: unknown) => {
        drop(); // the next call tries again instead of failing forever
        throw e;
      });
    dbPromise = opening;
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

/** Open traces at exactly this url, through the url index (every new tab asks; the store only grows). */
export async function getOpenTracesByUrl(url: string): Promise<TabTrace[]> {
  const all = await (await db()).getAllFromIndex('traces', 'byUrl', url);
  return all.filter((t) => t.closedAt === null);
}

/** Records of tabs closed before `at`, through the closedAt index (an open record has no key there). */
export async function getTracesClosedBefore(at: number): Promise<TabTrace[]> {
  return (await db()).getAllFromIndex('traces', 'byClosedAt', IDBKeyRange.upperBound(at, true));
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
