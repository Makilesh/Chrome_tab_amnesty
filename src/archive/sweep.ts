/**
 * The sweep's actions. This is the only file in Phase 1 that closes or groups anything, and
 * every function here runs from an explicit click on the sweep page (§6.9). Order of operations
 * is the load-bearing part: the archive card is written to IndexedDB BEFORE any tab is closed,
 * so a crash between the two leaves the person with an extra card, never a lost tab.
 */
import type { Community, TabTrace } from '../cluster/types';
import { deleteTrace, getTrace, updateTrace } from '../collector/db';
import { buildCard, dominantHost, inStripOrder, restoreOrder, undoable } from './card';
import { isNeverRemembered } from './forget';
import { enqueue, getNeverRemember, notePress, putCard, updateCard } from './store';
import type { ArchiveCard, GroupName, SummariseJob } from './types';

/** Where a tab was before "show on strip" pulled it into a group, so Undo can put it back. */
export interface StripPlace {
  tabId: number;
  windowId: number;
  index: number;
}

export interface GroupResult {
  /** Groups made, one per window the group's tabs are in. */
  groupIds: number[];
  /** §5.6: a saved/synced group refused the edit. The clustering stands; the strip was not changed. */
  locked: boolean;
  /** Tabs that were already in a group of the person's (or another tool's) and were left there. */
  leftInPlace: number;
  moved: StripPlace[];
  /** Chrome refused something else; what was done so far is still in groupIds / moved. */
  error?: string;
}

export interface ArchiveResult {
  card: ArchiveCard | null;
  /** Tabs left open because they hold text the person typed and has not sent (TabTrace.typing). */
  keptOpen: TabTrace[];
}

/** Live tab ids for a set of traces, in strip order, skipping tabs that no longer exist. */
async function liveTabIds(members: TabTrace[]): Promise<number[]> {
  const live = new Set((await chrome.tabs.query({})).map((t) => t.id));
  return inStripOrder(members).map((t) => t.tabId).filter((id) => live.has(id));
}

function isSavedGroupError(e: unknown): boolean {
  return /saved group/i.test((e as Error)?.message ?? '');
}

/**
 * Write one community to the tab strip as a named, coloured group — one group per window, made
 * in that window: without a window, chrome.tabs.group moves every tab to the window of the page
 * that asked, emptying (and closing) the person's other windows. Tabs that are already in a group
 * stay where they are: that group is the person's own, a saved one, or another tool's, and
 * pulling tabs out of it would undo their organising (and saved groups refuse anyway, §5.6).
 */
export async function groupOnStrip(members: TabTrace[], name: GroupName): Promise<GroupResult> {
  const live = new Map((await chrome.tabs.query({})).map((t) => [t.id, t]));
  const ids = inStripOrder(members).map((t) => t.tabId).filter((id) => live.has(id));
  const free = ids.filter((id) => (live.get(id)!.groupId ?? -1) === -1);
  const result: GroupResult = { groupIds: [], locked: false, leftInPlace: ids.length - free.length, moved: [] };
  const byWindow = new Map<number, number[]>();
  for (const id of free) {
    const w = live.get(id)!.windowId;
    byWindow.set(w, [...(byWindow.get(w) ?? []), id]);
  }
  for (const [windowId, tabIds] of byWindow) {
    const places = tabIds.map((tabId) => ({ tabId, windowId, index: live.get(tabId)!.index }));
    try {
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      result.groupIds.push(groupId);
      result.moved.push(...places); // grouping pulls the tabs together
      await chrome.tabGroups.update(groupId, { title: name.name, color: name.color });
    } catch (e) {
      if (isSavedGroupError(e)) result.locked = true;
      else result.error = (e as Error)?.message ?? String(e);
    }
  }
  return result;
}

/** Undo "show on strip": ungroup exactly the groups it made, then put their tabs back where they were. */
export async function ungroupOurs(groupIds: number[], moved: StripPlace[] = []): Promise<void> {
  for (const g of groupIds) {
    const ids = (await chrome.tabs.query({ groupId: g })).map((t) => t.id).filter((id): id is number => id !== undefined);
    if (ids.length) await chrome.tabs.ungroup(ids).catch(() => {});
  }
  // From the right: each move then lands among tabs that are already back in place.
  for (const p of [...moved].sort((a, b) => b.index - a.index)) {
    await chrome.tabs.move(p.tabId, { windowId: p.windowId, index: p.index }).catch(() => {});
  }
}

/**
 * Ask a tab, at the moment of the click, whether a field the person typed into still holds text
 * (content.ts answers for every frame). null when it cannot answer: discarded, frozen, or no live
 * content script.
 */
async function unsentIn(tabId: number): Promise<boolean | null> {
  try {
    const r = (await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'unsent?' }),
      new Promise((resolve) => setTimeout(() => resolve(undefined), 2000)),
    ])) as { unsent?: unknown } | undefined;
    return typeof r?.unsent === 'boolean' ? r.unsent : null;
  } catch {
    return null;
  }
}

/** A never-remembered site named anywhere in a group name (its domain, or that domain's first word). */
function namesNeverSite(name: string, never: readonly string[]): boolean {
  const n = name.toLowerCase();
  return never.some((d) => d && (n.includes(d) || ((d.split('.')[0] ?? '').length >= 4 && n.includes(d.split('.')[0]!))));
}

/**
 * Archive & close, one group at a time. Tabs on never-remember sites are closed but not
 * archived, and their records go with them (§6.10). Tabs holding unsent typing are neither
 * archived nor closed — they stay open, and the caller says so. Returns the card (null if nothing
 * was left to archive) and the tabs kept open.
 */
export async function archiveAndClose(
  community: Community,
  members: TabTrace[],
  name: GroupName,
  when: string,
  hosts: string[],
  whenAt: number | null = null,
): Promise<ArchiveResult> {
  // Re-read each record now: the person may have started typing after the page was drawn. Then
  // ask each tab itself. Either one saying there is a draft keeps the tab open: the stored flag
  // misses drafts (it never saw shadow roots or iframes), and a script injected after a Reload
  // never saw the typing done before it — but the flag the old script stored did.
  const fresh = await Promise.all(members.map(async (t) => (await getTrace(t.traceId)) ?? t));
  const tabs = new Map((await chrome.tabs.query({})).map((t) => [t.id, t]));
  const holdsTyping = await Promise.all(
    fresh.map(async (t) => {
      const tab = tabs.get(t.tabId);
      if (!tab) return false; // already gone
      if (t.typing === true) return true;
      return tab.discarded ? false : (await unsentIn(t.tabId)) === true;
    }),
  );
  const keptOpen = fresh.filter((_, i) => holdsTyping[i]);
  const closable = fresh.filter((_, i) => !holdsTyping[i]);
  const never = await getNeverRemember();
  const kept = closable.filter((t) => !isNeverRemembered(t, never));
  const dropped = closable.filter((t) => isNeverRemembered(t, never));

  // Nothing about a never-remember site goes on the card: not its host, not a name taken from it.
  const keptHosts = hosts.filter((h) => !isNeverRemembered({ host: h, eTLD1: h }, never));
  const keptName = namesNeverSite(name.name, never) ? { ...name, name: dominantHost(kept) || 'Put away' } : name;
  const card = buildCard(community, kept, keptName, when, keptHosts, Date.now(), crypto.randomUUID(), whenAt);
  if (kept.length > 0) {
    await putCard(card); // BEFORE closing anything
    await notePress(card.archivedAt).catch(() => {}); // the study's count; never blocks putting things away
    const jobs: SummariseJob[] = card.tabs
      .filter((t) => t.digest && (t.digest.description || t.digest.headings.length || t.digest.leadText))
      .map((t) => ({ jobId: crypto.randomUUID(), cardId: card.cardId, traceId: t.traceId, createdAt: Date.now(), attempts: 0, state: 'pending' }));
    if (jobs.length) await enqueue(jobs);
    await chrome.runtime.sendMessage({ type: 'summarise-kick' }).catch(() => {});
  }

  // Never-remember records go before the tabs close, so the collector's onRemoved finds nothing
  // to mark and cannot resurrect them; the archived ones it marks closedAt as usual.
  for (const t of dropped) await deleteTrace(t.traceId);
  const tabIds = await liveTabIds(closable);
  if (tabIds.length) await chrome.tabs.remove(tabIds);
  return { card: kept.length > 0 ? card : null, keptOpen };
}

/**
 * Undo an Archive & close within its day: every tab, original order, as a named group, in the
 * current window (reopenTabs). Works after a restart because the card is in IndexedDB (§6.8).
 * The card is kept and marked brought back.
 */
export async function bringBack(cardId: string): Promise<{ ok: boolean; reason?: string }> {
  // Claim the card first, in one transaction: a second click — the toast's Bring back and the
  // card's, or a double click — then finds it already brought back instead of recreating every
  // tab a second time.
  const now = Date.now();
  let claimed = false;
  const card = await updateCard(cardId, (c) => {
    if (!undoable(c, now)) return null;
    claimed = true;
    return { ...c, restoredAt: now };
  });
  if (!card) return { ok: false, reason: 'That one is gone.' };
  if (!claimed) return { ok: false, reason: card.restoredAt ? 'Already brought back.' : 'That one is older than a day; Open all on its card brings it back.' };
  await reopenTabs(card);
  return { ok: true };
}

/**
 * Open every tab of a card again, in order, as a named group — at any time, as often as wanted
 * (Phase 2: "restore a whole session in one click"). Unlike Bring back it is not an undo: the
 * card stays where it is and says nothing new. Tabs of the card that are open already get a
 * second copy with a record of its own; nothing is moved.
 */
export async function openCard(card: ArchiveCard): Promise<void> {
  await reopenTabs(card);
}

/**
 * The archived traces are reopened BEFORE the tabs are created, so the collector re-binds each new
 * tab to its own trace by url (§5.3) and the tabs come back with their lineage, timing and
 * co-activation instead of fusing with whatever is open now. A forgotten trace is simply absent.
 *
 * Reopened on no tab (-1), not the one it had: after a restart that id may belong to a live tab
 * (§5.3), and an open record on a live tab's id is not an orphan to re-bind — it stayed open and
 * unbound, a second record for that tab that Archive & close would have closed with it.
 */
async function reopenTabs(card: ArchiveCard): Promise<void> {
  for (const t of card.tabs) await updateTrace(t.traceId, (tr) => (tr.closedAt === null ? null : { ...tr, closedAt: null, tabId: -1 }));
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
}

/** Open a single archived tab again (no undo semantics, just a return path). */
export async function openOne(url: string): Promise<void> {
  await chrome.tabs.create({ url, active: true });
}
