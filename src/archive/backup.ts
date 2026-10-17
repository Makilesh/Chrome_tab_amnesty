/**
 * A second copy of what nothing else can give back: archived projects, the never-remember list
 * and the study's open-tab snapshots. Chrome replaces an IndexedDB database it cannot open with an
 * empty one — it did on the owner's machine on 7 Oct (DECISIONS 2026-10-07) — and when the
 * database comes back empty, `db()` puts these back before anything reads it.
 *
 * It lives in the extension's Cache Storage: a separate store from its IndexedDB database, and
 * like it reachable only from the extension's own pages and worker. Not chrome.storage.local —
 * content scripts can read and write that from inside every web page (security review of 59db5a7).
 *
 * Order rule (§6.10): forgetting changes this copy FIRST, so an interrupted forget can never come
 * back through a restore. Everything else writes IndexedDB first, then this copy.
 *
 * Traces are not copied: they change on every tab switch, and after a reset the collector adopts
 * the open tabs again (what is lost is where they came from and what they were switched with).
 */
import { MAX_SNAPSHOTS, type OpenSnapshot } from './study';
import type { ArchiveCard } from './types';

const CACHE = 'tab-amnesty-backup';
/** Cache Storage keys must be http(s) URLs. Nothing is ever fetched from this one. */
const KEY = 'https://tab-amnesty.invalid/';
const CARD = 'card/';
const MAX_RESETS = 20;

export interface Reset {
  at: number;
  /** What Chrome said it lost ('total' when it replaced the database), when it says. */
  dataLoss: string;
}

export interface Backup {
  cards: ArchiveCard[];
  neverRemember?: string[];
  openSnapshots?: OpenSnapshot[];
  /** When Archive & close was pressed (study; times only). */
  presses?: number[];
  /** When this install's database was first created, or when this copy was first made. */
  createdAt?: number;
  /** Each time Chrome handed back an empty database after that. */
  resets?: Reset[];
}

/** null where there is no Cache Storage (plain Node). */
async function open(): Promise<Cache | null> {
  return typeof caches === 'undefined' ? null : caches.open(CACHE);
}

async function put(name: string, value: unknown): Promise<void> {
  await (await open())?.put(KEY + name, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }));
}

async function get<T>(cache: Cache, name: string): Promise<T | undefined> {
  const res = await cache.match(KEY + name);
  return res ? ((await res.json()) as T) : undefined;
}

const cardKey = (cardId: string) => CARD + encodeURIComponent(cardId);

export async function backupCard(card: ArchiveCard): Promise<void> {
  await put(cardKey(card.cardId), card);
}

export async function dropCardBackup(cardId: string): Promise<void> {
  await (await open())?.delete(KEY + cardKey(cardId));
}

// While a restore is pending the database holds less than this copy, so the lists below are merged
// into the copy instead of replacing it — before, the first snapshot after a failed restore cut the
// copy's study snapshots down to that one (and a never-remember add, the list to that one site).

export async function backupNeverRemember(list: string[]): Promise<void> {
  const cache = await open();
  if (cache && (await pending(cache))) list = [...new Set([...((await get<string[]>(cache, 'neverRemember')) ?? []), ...list])];
  await put('neverRemember', list);
}

export async function backupSnapshots(list: OpenSnapshot[]): Promise<void> {
  const cache = await open();
  if (cache && (await pending(cache))) list = mergeSnapshots((await get<OpenSnapshot[]>(cache, 'openSnapshots')) ?? [], list);
  await put('openSnapshots', list);
}

export async function backupPresses(list: number[]): Promise<void> {
  const cache = await open();
  if (cache && (await pending(cache))) list = mergePresses((await get<number[]>(cache, 'presses')) ?? [], list);
  await put('presses', list);
}

/** Snapshots from both, one per moment, oldest first, as many as the study keeps. */
export function mergeSnapshots(a: OpenSnapshot[], b: OpenSnapshot[]): OpenSnapshot[] {
  return [...new Map([...a, ...b].map((s) => [s.at, s])).values()].sort((x, y) => x.at - y.at).slice(-MAX_SNAPSHOTS);
}

export function mergePresses(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

async function pending(cache: Cache): Promise<boolean> {
  return (await cache.match(KEY + 'restorePending')) !== undefined;
}

/**
 * Set before a restore starts and cleared when it has finished, so a restore that fails (a full
 * disk on the day Chrome replaced the database, say) is tried again on every worker start
 * (store.ts seedBackup) instead of never.
 */
export async function markRestorePending(on: boolean): Promise<void> {
  const cache = await open();
  if (!cache) return;
  if (on) await put('restorePending', Date.now());
  else await cache.delete(KEY + 'restorePending');
}

export async function restorePending(): Promise<boolean> {
  const cache = await open();
  return !!cache && (await pending(cache));
}

export async function readBackup(): Promise<Backup | null> {
  const cache = await open();
  if (!cache) return null;
  const cards: ArchiveCard[] = [];
  for (const req of await cache.keys()) {
    if (!req.url.startsWith(KEY + CARD)) continue;
    const res = await cache.match(req);
    if (res) cards.push((await res.json()) as ArchiveCard);
  }
  return {
    cards,
    neverRemember: await get<string[]>(cache, 'neverRemember'),
    openSnapshots: await get<OpenSnapshot[]>(cache, 'openSnapshots'),
    presses: await get<number[]>(cache, 'presses'),
    createdAt: await get<number>(cache, 'createdAt'),
    resets: await get<Reset[]>(cache, 'resets'),
  };
}

export async function noteCreated(at: number): Promise<void> {
  await put('createdAt', at);
}

/**
 * Whether this install's copy was ever started — one key, not every card, because the worker asks
 * on every start and the archive only grows. null where there is no Cache Storage.
 */
export async function copyStarted(): Promise<boolean | null> {
  const cache = await open();
  if (!cache) return null;
  return (await cache.match(KEY + 'createdAt')) !== undefined;
}

/** Returns every reset so far, this one last. */
export async function noteReset(reset: Reset): Promise<Reset[]> {
  const cache = await open();
  if (!cache) return [reset];
  const all = [...((await get<Reset[]>(cache, 'resets')) ?? []), reset].slice(-MAX_RESETS);
  await put('resets', all);
  return all;
}
