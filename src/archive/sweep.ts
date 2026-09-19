/**
 * The sweep's actions. This is the only file in Phase 1 that closes or groups anything, and
 * every function here runs from an explicit click on the sweep page (§6.9). Order of operations
 * is the load-bearing part: the archive card is written to IndexedDB BEFORE any tab is closed,
 * so a crash between the two leaves the person with an extra card, never a lost tab.
 */
import type { Community, TabTrace } from '../cluster/types';
import { deleteTrace } from '../collector/db';
import { buildCard, inStripOrder, restoreOrder, undoable } from './card';
import { isNeverRemembered } from './forget';
import { enqueue, getCard, getNeverRemember, putCard, updateCard } from './store';
import type { ArchiveCard, GroupName, SummariseJob } from './types';

export interface GroupResult {
  groupId: number | null;
  /** §5.6: a saved/synced group refused the edit. The clustering stands; the strip was not changed. */
  locked: boolean;
}

/** Live tab ids for a set of traces, in strip order, skipping tabs that no longer exist. */
async function liveTabIds(members: TabTrace[]): Promise<number[]> {
  const live = new Set((await chrome.tabs.query({})).map((t) => t.id));
  return inStripOrder(members).map((t) => t.tabId).filter((id) => live.has(id));
}

function isSavedGroupError(e: unknown): boolean {
  return /saved group/i.test((e as Error)?.message ?? '');
}

/** Write one community to the tab strip as a named, coloured group. */
export async function groupOnStrip(members: TabTrace[], name: GroupName): Promise<GroupResult> {
  const tabIds = await liveTabIds(members);
  if (tabIds.length === 0) return { groupId: null, locked: false };
  try {
    // Tabs already in a saved group cannot be moved out of it (§5.6); chrome.tabs.group throws.
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: name.name, color: name.color });
    return { groupId, locked: false };
  } catch (e) {
    if (isSavedGroupError(e)) return { groupId: null, locked: true };
    throw e;
  }
}

/**
 * Archive & close, one group at a time. Tabs on never-remember sites are closed but not
 * archived, and their records go with them (§6.10). Returns the card, or null if nothing was
 * left to archive.
 */
export async function archiveAndClose(
  community: Community,
  members: TabTrace[],
  name: GroupName,
  when: string,
  hosts: string[],
): Promise<ArchiveCard | null> {
  const never = await getNeverRemember();
  const kept = members.filter((t) => !isNeverRemembered(t, never));
  const dropped = members.filter((t) => isNeverRemembered(t, never));

  const card = buildCard(community, kept, name, when, hosts);
  if (kept.length > 0) {
    await putCard(card); // BEFORE closing anything
    const jobs: SummariseJob[] = card.tabs
      .filter((t) => t.digest && (t.digest.description || t.digest.headings.length || t.digest.leadText))
      .map((t) => ({ jobId: crypto.randomUUID(), cardId: card.cardId, traceId: t.traceId, createdAt: Date.now(), attempts: 0, state: 'pending' }));
    if (jobs.length) await enqueue(jobs);
    await chrome.runtime.sendMessage({ type: 'summarise-kick' }).catch(() => {});
  }

  // Never-remember records go before the tabs close, so the collector's onRemoved finds nothing
  // to mark and cannot resurrect them; the archived ones it marks closedAt as usual.
  for (const t of dropped) await deleteTrace(t.traceId);
  const tabIds = await liveTabIds(members);
  if (tabIds.length) await chrome.tabs.remove(tabIds);
  return kept.length > 0 ? card : null;
}

/**
 * Bring a whole card back: every tab, original order, as a named group, in the current window.
 * Works after a restart because the card is in IndexedDB (§6.8). The card is kept and marked.
 * The collector mints fresh traces for the new tabs as it would for any tab; the archived
 * traces stay closed behind the card, so nothing is re-bound and nothing can race.
 */
export async function bringBack(cardId: string): Promise<{ ok: boolean; reason?: string }> {
  const card = await getCard(cardId);
  if (!card) return { ok: false, reason: 'That one is gone.' };
  if (!undoable(card)) return { ok: false, reason: card.restoredAt ? 'Already brought back.' : 'That one is older than a day; open its tabs from the card instead.' };

  const current = await chrome.windows.getCurrent();
  const created: number[] = [];
  for (const t of restoreOrder(card)) {
    const tab = await chrome.tabs.create({ url: t.url, windowId: current.id, active: false });
    if (tab.id !== undefined) created.push(tab.id);
  }
  if (created.length) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: created, createProperties: { windowId: current.id } });
      await chrome.tabGroups.update(groupId, { title: card.name, color: card.color });
    } catch {
      /* grouping is cosmetic here; the tabs are back either way */
    }
  }
  await updateCard(cardId, (c) => ({ ...c, restoredAt: Date.now() }));
  return { ok: true };
}

/** Open a single archived tab again (no undo semantics, just a return path). */
export async function openOne(url: string): Promise<void> {
  await chrome.tabs.create({ url, active: true });
}
