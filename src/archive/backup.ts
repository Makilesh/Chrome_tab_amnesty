/**
 * A second copy, in chrome.storage.local, of what nothing else can give back: archived projects,
 * the never-remember list and the study's open-tab snapshots. chrome.storage.local is a separate
 * store from the IndexedDB database. Chrome replaces an IndexedDB database it cannot open with an
 * empty one — it did on the owner's machine on 7 Oct (DECISIONS 2026-10-07) — and when the
 * database comes back empty, `db()` puts these back before anything reads it.
 *
 * Order rule (§6.10): forgetting changes this copy FIRST, so an interrupted forget can never come
 * back through a restore. Everything else writes IndexedDB first, then this copy.
 *
 * Traces are not copied: they change on every tab switch, and after a reset the collector adopts
 * the open tabs again (what is lost is where they came from and what they were switched with).
 */
import type { OpenSnapshot } from './study';
import type { ArchiveCard } from './types';

const CARD = 'card:';
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
  /** When this install's database was first created, or when this copy was first made. */
  createdAt?: number;
  /** Each time Chrome handed back an empty database after that. */
  resets?: Reset[];
}

function area(): chrome.storage.LocalStorageArea | undefined {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
}

export async function backupCard(card: ArchiveCard): Promise<void> {
  await area()?.set({ [CARD + card.cardId]: card });
}

export async function dropCardBackup(cardId: string): Promise<void> {
  await area()?.remove(CARD + cardId);
}

export async function backupNeverRemember(list: string[]): Promise<void> {
  await area()?.set({ neverRemember: list });
}

export async function backupSnapshots(list: OpenSnapshot[]): Promise<void> {
  await area()?.set({ openSnapshots: list });
}

/** null where there is no chrome.storage (plain Node). */
export async function readBackup(): Promise<Backup | null> {
  const a = area();
  if (!a) return null;
  const all = (await a.get(null)) as Record<string, unknown>;
  return {
    cards: Object.entries(all)
      .filter(([k]) => k.startsWith(CARD))
      .map(([, v]) => v as ArchiveCard),
    neverRemember: all.neverRemember as string[] | undefined,
    openSnapshots: all.openSnapshots as OpenSnapshot[] | undefined,
    createdAt: all.createdAt as number | undefined,
    resets: all.resets as Reset[] | undefined,
  };
}

export async function noteCreated(at: number): Promise<void> {
  await area()?.set({ createdAt: at });
}

export async function noteReset(reset: Reset): Promise<void> {
  const a = area();
  if (!a) return;
  const prev = ((await a.get('resets')) as { resets?: Reset[] }).resets ?? [];
  await a.set({ resets: [...prev, reset].slice(-MAX_RESETS) });
}
