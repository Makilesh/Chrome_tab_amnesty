/**
 * IndexedDB access for Phase 1: archive cards, the summarisation queue, the never-remember list.
 * Every write lands immediately (§5.5). Deletion happens in exactly two functions, both named
 * `forget…`, both only ever called from an explicit user action. Cards and the never-remember
 * list are also kept in a second store (backup.ts) so a database Chrome replaces does not take
 * them along.
 */
import { db, deleteTrace, getMeta, setMeta } from '../collector/db';
import { backupCard, backupNeverRemember, backupSnapshots, dropCardBackup, noteCreated, readBackup } from './backup';
import { normaliseDomain } from './forget';
import type { RememberedName } from './naming';
import type { ArchiveCard, SummariseJob } from './types';

// --- archive cards -------------------------------------------------------------------------

export async function putCard(card: ArchiveCard): Promise<void> {
  await (await db()).put('archive', card);
  await backupCard(card);
}

export async function getCard(cardId: string): Promise<ArchiveCard | undefined> {
  return (await db()).get('archive', cardId);
}

/** Newest first. */
export async function getCards(): Promise<ArchiveCard[]> {
  const all = await (await db()).getAllFromIndex('archive', 'byArchivedAt');
  return all.reverse();
}

export async function updateCard(cardId: string, fn: (c: ArchiveCard) => ArchiveCard | null): Promise<ArchiveCard | undefined> {
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
  const card = await getCard(cardId);
  if (!card) return;
  await dropCardBackup(cardId); // first: an interrupted forget must not come back through a restore
  const d = await db();
  const tx = d.transaction(['archive', 'jobs'], 'readwrite');
  await tx.objectStore('archive').delete(cardId);
  for (const j of await tx.objectStore('jobs').getAll()) if (j.cardId === cardId) await tx.objectStore('jobs').delete(j.jobId);
  await tx.done;
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
export async function forgetTab(cardId: string, traceId: string): Promise<void> {
  const card = await getCard(cardId);
  if (card) {
    // The second copy first, as in forgetCard.
    const tabs = card.tabs.filter((t) => t.traceId !== traceId);
    if (tabs.length) await backupCard({ ...card, tabs });
    else await dropCardBackup(cardId);
  }
  const next = await updateCard(cardId, (c) => ({ ...c, tabs: c.tabs.filter((t) => t.traceId !== traceId) }));
  await deleteTrace(traceId);
  await forgetNamesOf([traceId]);
  const d = await db();
  for (const j of await d.getAll('jobs')) if (j.traceId === traceId) await d.delete('jobs', j.jobId);
  if (next && next.tabs.length === 0) {
    await d.delete('archive', cardId);
    await dropCardBackup(cardId); // updateCard just copied the emptied card over
  }
}

// --- summarisation queue -------------------------------------------------------------------

export async function enqueue(jobs: SummariseJob[]): Promise<void> {
  const tx = (await db()).transaction('jobs', 'readwrite');
  for (const j of jobs) await tx.store.put(j);
  await tx.done;
}

export async function pendingJobs(limit: number): Promise<SummariseJob[]> {
  const all = await (await db()).getAllFromIndex('jobs', 'byState', 'pending');
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

export async function getNeverRemember(): Promise<string[]> {
  return (await getMeta('neverRemember')) ?? [];
}

export async function addNeverRemember(domain: string): Promise<string[]> {
  const d = normaliseDomain(domain);
  const list = await getNeverRemember();
  if (d && !list.includes(d)) list.push(d);
  await setMeta('neverRemember', list);
  await backupNeverRemember(list);
  return list;
}

export async function removeNeverRemember(domain: string): Promise<string[]> {
  const d = normaliseDomain(domain);
  const list = (await getNeverRemember()).filter((x) => x !== d);
  await setMeta('neverRemember', list);
  await backupNeverRemember(list);
  return list;
}

// --- the second copy ---------------------------------------------------------------------------

/**
 * Once per install: a build with the second copy arrives on an install that already has records,
 * so copy them over before anything can be lost. Afterwards every write keeps it current.
 */
export async function seedBackup(): Promise<void> {
  const backup = await readBackup();
  if (!backup || backup.createdAt !== undefined) return;
  for (const card of await getCards()) await backupCard(card);
  const never = await getMeta('neverRemember');
  if (never) await backupNeverRemember(never);
  const snapshots = await getMeta('openSnapshots');
  if (snapshots) await backupSnapshots(snapshots);
  await noteCreated(Date.now());
}
