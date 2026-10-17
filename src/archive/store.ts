/**
 * IndexedDB access for Phase 1: archive cards, the summarisation queue, the never-remember list.
 * Every write lands immediately (§5.5). Deletion happens only on an explicit user action:
 * `forgetCard`, `forgetTab`, and `addNeverRemember` (which forgets a site). Cards and the never-remember
 * list are also kept in a second store (backup.ts) so a database Chrome replaces does not take
 * them along.
 */
import { db, deleteTrace, getAllTraces, getMeta, getTracesClosedBefore, restoreInto, setMeta, updateTrace } from '../collector/db';
import {
  backupCard,
  backupNeverRemember,
  backupPresses,
  backupSnapshots,
  copyStarted,
  dropCardBackup,
  markRestorePending,
  noteCreated,
  readBackup,
  restorePending,
} from './backup';
import { CLOSED_RECORD_DAYS, recordsToDrop } from './card';
import { type Copy, cardsToBringIn } from './copy';
import { isNeverRemembered, normaliseDomain } from './forget';
import { type RememberedName, withoutTabs } from './naming';
import type { ArchiveCard, SummariseJob } from './types';

// --- archive cards -------------------------------------------------------------------------

/**
 * A card write and its second copy are one step, under one lock shared by the extension's pages,
 * worker and offscreen document (one origin). Without it a summary written into a card landed its
 * copy a moment after Forget had dropped it, leaving the forgotten card in the copy for the next
 * restore to bring back (§6.10; 16 of 16 near-simultaneous trials in the 17 Oct review). Web Locks
 * are not re-entrant: nothing inside may call another locked function — hence the *Unlocked forms.
 * db()'s own first restore (collector/db.ts afterCreate) must not take it: a forget holding it can
 * be the very caller waiting on that db().
 */
function cardsLocked<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  // request() resolves with the callback's own result (a promise is flattened like any other).
  return locks ? (locks.request('tab-amnesty-cards', fn) as unknown as Promise<T>) : fn();
}

export function putCard(card: ArchiveCard): Promise<void> {
  return cardsLocked(async () => {
    await (await db()).put('archive', card);
    await backupCard(card);
  });
}

export async function getCard(cardId: string): Promise<ArchiveCard | undefined> {
  return (await db()).get('archive', cardId);
}

/** Newest first. */
export async function getCards(): Promise<ArchiveCard[]> {
  const all = await (await db()).getAllFromIndex('archive', 'byArchivedAt');
  return all.reverse();
}

export function updateCard(cardId: string, fn: (c: ArchiveCard) => ArchiveCard | null): Promise<ArchiveCard | undefined> {
  return cardsLocked(() => updateCardUnlocked(cardId, fn));
}

async function updateCardUnlocked(cardId: string, fn: (c: ArchiveCard) => ArchiveCard | null): Promise<ArchiveCard | undefined> {
  const tx = (await db()).transaction('archive', 'readwrite');
  const cur = await tx.store.get(cardId);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = fn(cur);
  if (next) await tx.store.put(next);
  await tx.done;
  if (next) await backupCard(next);
  return next ?? cur;
}

/** Forget a whole card: the card, its queued jobs, and the traces behind it. User action only. */
export async function forgetCard(cardId: string): Promise<void> {
  const card = await cardsLocked(async () => {
    const c = await getCard(cardId);
    if (!c) return undefined;
    await dropCardBackup(cardId); // first: an interrupted forget must not come back through a restore
    const tx = (await db()).transaction(['archive', 'jobs'], 'readwrite');
    await tx.objectStore('archive').delete(cardId);
    for (const j of await tx.objectStore('jobs').getAll()) if (j.cardId === cardId) await tx.objectStore('jobs').delete(j.jobId);
    await tx.done;
    return c;
  });
  if (!card) return;
  for (const t of card.tabs) await deleteTrace(t.traceId);
  await forgetNamesOf(card.tabs.map((t) => t.traceId));
}

/** A forgotten tab takes any remembered group name that came from it along (§6.10). */
async function forgetNamesOf(traceIds: string[]): Promise<void> {
  const gone = new Set(traceIds);
  const memory = await getRememberedNames();
  const kept = memory.filter((m) => !m.members.some((id) => gone.has(id)));
  if (kept.length !== memory.length) await saveRememberedNames(kept);
}

/** Forget one tab inside a card. The card stays; if it was the last tab the card goes too. */
export function forgetTab(cardId: string, traceId: string): Promise<void> {
  return forgetTabs(cardId, [traceId]);
}

/**
 * Forget lines of a card: the lines, the sites only they were on, and a name that came from them
 * (naming.withoutTabs; `never`: sites never remembered now, whose names go too). The card stays
 * unless nothing is left of it.
 */
async function forgetTabs(cardId: string, traceIds: string[], never: readonly string[] = []): Promise<void> {
  const gone = new Set(traceIds);
  await cardsLocked(async () => {
    const card = await getCard(cardId);
    if (card) {
      // The second copy first, as in forgetCard.
      const left = withoutTabs(card, gone, never);
      if (left.tabs.length) await backupCard(left);
      else await dropCardBackup(cardId);
    }
    const next = await updateCardUnlocked(cardId, (c) => withoutTabs(c, gone, never));
    if (next && next.tabs.length === 0) {
      await (await db()).delete('archive', cardId);
      await dropCardBackup(cardId); // updateCardUnlocked just copied the emptied card over
    }
  });
  for (const id of traceIds) await deleteTrace(id);
  await forgetNamesOf(traceIds);
  const d = await db();
  for (const j of await d.getAll('jobs')) if (gone.has(j.traceId)) await d.delete('jobs', j.jobId);
}

// --- summarisation queue -------------------------------------------------------------------

export async function enqueue(jobs: SummariseJob[]): Promise<void> {
  const tx = (await db()).transaction('jobs', 'readwrite');
  for (const j of jobs) await tx.store.put(j);
  await tx.done;
}

export async function pendingJobs(limit: number): Promise<SummariseJob[]> {
  return jobsInState('pending', limit);
}

export async function jobsInState(state: SummariseJob['state'], limit: number): Promise<SummariseJob[]> {
  const all = await (await db()).getAllFromIndex('jobs', 'byState', state);
  return all.sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
}

export async function putJob(job: SummariseJob): Promise<void> {
  await (await db()).put('jobs', job);
}

// --- remembered group names ----------------------------------------------------------------

export async function getRememberedNames(): Promise<RememberedName[]> {
  return (await getMeta('groupNames')) ?? [];
}

export async function saveRememberedNames(memory: RememberedName[]): Promise<void> {
  await setMeta('groupNames', memory);
}

// --- never-remember list -------------------------------------------------------------------

/** Entries saved before normaliseDomain parsed urls (e.g. "localhost:3000") are read in today's form. */
export async function getNeverRemember(): Promise<string[]> {
  return [...new Set(((await getMeta('neverRemember')) ?? []).map(normaliseDomain).filter(Boolean))];
}

/**
 * Never remember a site — backwards as well as from now on, because the page promises "nothing
 * about them is kept — no titles, no page text, nothing after they close": closed records on it
 * go, open ones lose their title and page text, and its lines leave archived cards (through
 * forgetTab, so the second copy first, as for any forget).
 */
export async function addNeverRemember(domain: string): Promise<string[]> {
  const d = normaliseDomain(domain);
  const list = await getNeverRemember();
  if (!d || list.includes(d)) return list;
  list.push(d);
  await backupNeverRemember(list); // first, like forgetting: an interrupted add must not be undone by a restore
  await setMeta('neverRemember', list);
  for (const card of await getCards()) {
    const lines = card.tabs.filter((t) => isNeverRemembered(t, list)).map((t) => t.traceId);
    if (lines.length) await forgetTabs(card.cardId, lines, list);
  }
  for (const t of await getAllTraces()) {
    if (!isNeverRemembered(t, list)) continue;
    if (t.closedAt !== null) await deleteTrace(t.traceId);
    else if (t.title || t.digest) await updateTrace(t.traceId, (x) => ({ ...x, title: '', digest: null, digestAt: null }));
  }
  return list;
}

export async function removeNeverRemember(domain: string): Promise<string[]> {
  const d = normaliseDomain(domain);
  const list = (await getNeverRemember()).filter((x) => x !== d);
  await setMeta('neverRemember', list);
  await backupNeverRemember(list);
  return list;
}

// --- closed records --------------------------------------------------------------------------

/**
 * Records of tabs closed more than CLOSED_RECORD_DAYS ago go, unless a card holds them. Nothing
 * reads them — grouping reads open tabs, Bring back and Open all their own cards' records — and
 * kept for ever they would be a log of every page ever opened (DECISIONS 2026-10-17). What was put
 * away stays until the person forgets it. Returns how many went.
 */
export async function pruneClosedRecords(now = Date.now()): Promise<number> {
  const old = await getTracesClosedBefore(now - CLOSED_RECORD_DAYS * 24 * 60 * 60_000);
  if (old.length === 0) return 0;
  const drop = recordsToDrop(old, await getCards());
  for (const id of drop) await deleteTrace(id);
  return drop.length;
}

// --- keep a copy -------------------------------------------------------------------------------

/**
 * Bring in a copy the person saved (copy.ts): every card this browser does not have, without
 * anything on a site never remembered here or in the copy. Nothing here is changed or replaced —
 * not even the never-remember list: adding a site to it forgets what is kept about the site, so
 * the copy's sites missing here are only returned (`neverOffered`), for the person to add or not.
 */
export async function bringInCopy(copy: Copy): Promise<{ added: ArchiveCard[]; neverOffered: string[] }> {
  const here = await getNeverRemember();
  const added = cardsToBringIn(copy, new Set((await getCards()).map((c) => c.cardId)), [...here, ...copy.neverRemember]);
  for (const c of added) await putCard(c);
  return { added, neverOffered: copy.neverRemember.filter((d) => !here.includes(d)) };
}

// --- study: presses ----------------------------------------------------------------------------

/** Phase 1 study: Archive & close was pressed at `at`. A time only; it outlives the card (db.ts MetaRecords.presses). */
export async function notePress(at: number): Promise<void> {
  const list = [...((await getMeta('presses')) ?? []), at];
  await setMeta('presses', list);
  await backupPresses(list);
}

export async function getPresses(): Promise<number[]> {
  return (await getMeta('presses')) ?? [];
}

// --- the second copy ---------------------------------------------------------------------------

/**
 * Once per install: a build with the second copy arrives on an install that already has records,
 * so copy them over before anything can be lost. Afterwards every write keeps it current.
 */
export async function seedBackup(): Promise<void> {
  if (await restorePending()) {
    // A restore that failed (a full disk on the day Chrome replaced the database, say) is tried
    // again on every worker start until it goes through. Read and restored under the card lock,
    // so a Forget cannot slip in between and be undone.
    await cardsLocked(async () => {
      const backup = await readBackup();
      if (backup) await restoreInto(await db(), backup);
      await markRestorePending(false);
    });
    return;
  }
  if ((await copyStarted()) !== false) return; // already seeded, or no Cache Storage here
  for (const card of await getCards()) await backupCard(card);
  const never = await getMeta('neverRemember');
  if (never) await backupNeverRemember(never);
  const snapshots = await getMeta('openSnapshots');
  if (snapshots) await backupSnapshots(snapshots);
  const presses = await getMeta('presses');
  if (presses) await backupPresses(presses);
  await noteCreated(Date.now());
}
