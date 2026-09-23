/**
 * Collector service worker. Records, never touches UI, never closes or groups anything.
 * (Phase 1 adds one passive duty: driving the summarisation queue's alarm — see summarise.ts.)
 *
 * Every handler reads and writes IndexedDB directly: MV3 kills this worker after 30 s idle, so
 * nothing of consequence may live in a module-level variable (§5.5). Lineage (§5.1) and
 * activity (§5.2) are captured at event time because they cannot be read back later.
 */
import type { Digest, TabTrace } from '../cluster/types';
import {
  CO_ACTIVE_WINDOW_MS,
  deleteTrace,
  getMeta,
  getOpenTraces,
  getTraceByTabId,
  putTrace,
  setMeta,
  updateTrace,
  updateTraceByTabId,
} from './db';
import { isNeverRemembered } from '../archive/forget';
import { getNeverRemember } from '../archive/store';
import { lastVisit, transitionNear } from './history';
import { ensureStudyAlarm, STUDY_ALARM, takeSnapshot } from './study';
import { kickSummariser, runSummariser, SUMMARISE_ALARM } from './summarise';
import { urlFeatures } from './url';

/** Never re-capture a digest for the same URL inside this window. */
const DIGEST_MIN_INTERVAL_MS = 10 * 60_000;
/** A single dwell increment is capped so a laptop asleep overnight does not read as 9 h of focus. */
const MAX_DWELL_INCREMENT_MS = 2 * 60 * 60_000;

// ---------------------------------------------------------------------------------------------
// Trace construction
// ---------------------------------------------------------------------------------------------

function baseTrace(tab: chrome.tabs.Tab, url: string): Omit<
  TabTrace,
  'traceId' | 'openerTraceId' | 'openedAt' | 'transition' | 'backfilled'
> {
  return {
    tabId: tab.id ?? -1,
    windowId: tab.windowId,
    index: tab.index,
    lastActiveAt: null,
    activationCount: 0,
    dwellMs: 0,
    coActive: {},
    url,
    ...urlFeatures(url),
    title: tab.title ?? '',
    digest: null,
    digestAt: null,
    pinned: tab.pinned,
    discarded: tab.discarded ?? false,
    closedAt: null,
  };
}

/** Best URL we can see for a tab right now. Pending URLs are visible with the "tabs" permission. */
function tabUrl(tab: chrome.tabs.Tab): string {
  return tab.url || tab.pendingUrl || '';
}

/** Ids of every tab that exists right now. */
async function liveTabIds(): Promise<Set<number>> {
  return new Set((await chrome.tabs.query({})).map((t) => t.id).filter((id): id is number => id !== undefined));
}

/**
 * Re-bind on restart (§5.3): tab ids are reassigned, so an open trace whose tabId no longer
 * exists is an orphan waiting for its tab to come back. Match by url, preferring the same
 * windowId and then the nearest strip index. Window ids are reassigned across restarts too, so
 * url-only is a valid match.
 */
async function findOrphanFor(tab: chrome.tabs.Tab, url: string, live: Set<number>): Promise<TabTrace | undefined> {
  const candidates = (await getOpenTraces()).filter((t) => t.url === url && !live.has(t.tabId));
  if (candidates.length === 0) return undefined;
  const score = (t: TabTrace) => (t.windowId === tab.windowId ? 0 : 1_000_000) + Math.abs(t.index - tab.index);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

/**
 * A tab we have no live trace for. Either it is a restored tab whose trace is waiting to be
 * re-bound, or it is genuinely new to us (existed before install) and gets adopted with
 * history-backfilled timing. Lineage is never backfilled.
 *
 * This runs from whichever event sees the tab first — onUpdated during session restore, or
 * rebindAll from onStartup — so the outcome does not depend on event order.
 */
async function bindOrAdopt(tab: chrome.tabs.Tab, live?: Set<number>): Promise<TabTrace> {
  const url = tabUrl(tab);
  const orphan = await findOrphanFor(tab, url, live ?? (await liveTabIds()));
  if (orphan) {
    const bound: TabTrace = {
      ...orphan,
      tabId: tab.id ?? -1,
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned,
      discarded: tab.discarded ?? false,
      title: tab.title ?? orphan.title,
    };
    await putTrace(bound);
    return bound;
  }
  const visit = await lastVisit(url);
  const trace: TabTrace = {
    traceId: crypto.randomUUID(),
    openerTraceId: null,
    openedAt: visit?.visitTime ?? Date.now(),
    transition: visit?.transition ?? 'unknown',
    backfilled: true,
    ...baseTrace(tab, url),
  };
  await putTrace(trace);
  return trace;
}

/**
 * Resolve the transition for a trace from the visit nearest `at`. History is written slightly
 * after navigation commits, so callers retry at status=complete if the first attempt misses.
 */
async function resolveTransition(traceId: string, url: string, at: number): Promise<void> {
  if (!/^https?:/.test(url)) return;
  const transition = await transitionNear(url, at);
  if (transition === 'unknown') return;
  await updateTrace(traceId, (t) => (t.transition === 'unknown' ? { ...t, transition } : null));
}

// ---------------------------------------------------------------------------------------------
// Per-tab serialisation. onUpdated fires within milliseconds of onCreated, so without this the
// update handler can look for a trace that onCreated has not finished writing and adopt the tab
// as a backfilled duplicate. This map holds in-flight promise chains only — nothing persistent,
// so it is fine for it to vanish when the worker dies.
// ---------------------------------------------------------------------------------------------

const chains = new Map<number, Promise<unknown>>();
/** Activity handlers touch the shared activeNow / recentActivations meta, so they share a lane. */
const ACTIVITY_LANE = -1;

/**
 * LANE ORDERING INVARIANT: a tab lane may await the activity lane (onRemoved does); the activity
 * lane must never await a tab lane. Lanes are FIFO promise chains, so a cycle
 * (tab -> activity -> tab) would deadlock the worker silently — no error, just handlers that never
 * run again until Chrome kills the worker. There is no runtime check: a flag set across an await
 * would misfire on unrelated concurrent events, and workers have no AsyncLocalStorage. The
 * structural rule instead: nothing that runs inside `serial(ACTIVITY_LANE, ...)` — `foreground`,
 * `accrueDwell`, the onFocusChanged body, the reset in rebindAll — may call `serial` at all.
 */
function serial<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(tabId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(tabId, next.catch(() => {}));
  void next.finally(() => {
    if (chains.get(tabId) === next) chains.delete(tabId);
  });
  return next;
}

// ---------------------------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------------------------

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  const openedAt = Date.now();
  void serial(tab.id, () => onCreated(tab, openedAt));
});

async function onCreated(tab: chrome.tabs.Tab, openedAt: number): Promise<void> {
  const url = tabUrl(tab);
  // Session restore can surface a tab through onCreated; if an orphaned trace already describes
  // it, re-bind rather than minting a second identity for the same tab.
  if (/^https?:/.test(url) && (await findOrphanFor(tab, url, await liveTabIds()))) {
    await bindOrAdopt(tab);
    return;
  }
  // §5.1: openerTabId exists only now. Resolve it to a traceId immediately or lose it.
  const opener =
    tab.openerTabId !== undefined ? await getTraceByTabId(tab.openerTabId) : undefined;
  const trace: TabTrace = {
    traceId: crypto.randomUUID(),
    openerTraceId: opener?.traceId ?? null,
    openedAt,
    transition: 'unknown',
    backfilled: false,
    ...baseTrace(tab, url),
  };
  await putTrace(trace);
  if (url) await resolveTransition(trace.traceId, url, openedAt);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void serial(tabId, () => onUpdated(tabId, changeInfo, tab));
});

async function onUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
): Promise<void> {
  const existing = await getTraceByTabId(tabId);
  if (!existing) {
    await bindOrAdopt(tab);
    return;
  }
  const urlChanged = changeInfo.url !== undefined && changeInfo.url !== existing.url;
  const now = Date.now();
  const never = await getNeverRemember();
  const updated = await updateTrace(existing.traceId, (t) => {
    let next: TabTrace = {
      ...t,
      tabId,
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned,
      discarded: tab.discarded ?? false,
      title: tab.title ?? t.title,
    };
    if (urlChanged && changeInfo.url) {
      // One trace per tab for its lifetime; a navigation refreshes what the tab is about but
      // keeps openedAt / transition / lineage as they were at creation.
      next = { ...next, url: changeInfo.url, ...urlFeatures(changeInfo.url), digest: null, digestAt: null };
    }
    if (isNeverRemembered(next, never)) next = { ...next, title: '', digest: null, digestAt: null };
    return next;
  });
  if (!updated) return;

  if (updated.transition === 'unknown' && !updated.backfilled && /^https?:/.test(updated.url)) {
    // First real URL for a fresh tab: the visit that opened it was written just now, so search
    // around `now` rather than openedAt (the user may have sat on the new-tab page for a while).
    if (urlChanged || changeInfo.status === 'complete') {
      await resolveTransition(updated.traceId, updated.url, urlChanged ? now : updated.openedAt);
    }
  }

  if (urlChanged && !updated.discarded && /^https?:/.test(updated.url)) {
    // SPA navigations do not re-inject the content script; ask it for a fresh digest. On a full
    // navigation the message lands in a torn-down frame and simply fails.
    chrome.tabs.sendMessage(tabId, { type: 'capture' }).catch(() => {});
  }
}

/**
 * A window closing and the browser shutting down are indistinguishable here, and on shutdown
 * these tabs come back through session restore. So window-close removals do not set closedAt
 * now: an alarm reconciles a minute later (if the browser is still running), and on startup
 * rebindAll re-binds whatever session restore brought back before closing the rest.
 */
const RECONCILE_ALARM = 'reconcile-window-close';

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const now = Date.now();
  void serial(tabId, async () => {
    const trace = await getTraceByTabId(tabId);
    if (!trace) return;
    if (removeInfo.isWindowClosing) {
      await chrome.alarms.create(RECONCILE_ALARM, { delayInMinutes: 1 });
    } else if (isNeverRemembered(trace, await getNeverRemember())) {
      await deleteTrace(trace.traceId); // §6.10: nothing kept once the tab is gone
    } else {
      await putTrace({ ...trace, closedAt: now });
    }
    await serial(ACTIVITY_LANE, async () => {
      const active = await getMeta('activeNow');
      if (active?.traceId === trace.traceId) {
        await accrueDwell(active, now);
        await setMeta('activeNow', null);
      }
    });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONCILE_ALARM) void rebindAll();
  if (alarm.name === SUMMARISE_ALARM) void runSummariser();
  if (alarm.name === STUDY_ALARM) void takeSnapshot();
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  await updateTraceByTabId(removedTabId, (t) => ({ ...t, tabId: addedTabId }));
});

chrome.tabs.onMoved.addListener((_tabId, { windowId }) => void resyncWindow(windowId));
chrome.tabs.onAttached.addListener((_tabId, { newWindowId }) => void resyncWindow(newWindowId));
chrome.tabs.onDetached.addListener((_tabId, { oldWindowId }) => void resyncWindow(oldWindowId));

/** Strip positions shift for every tab in a window when one moves; re-read them all. */
async function resyncWindow(windowId: number): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    await updateTraceByTabId(tab.id, (t) =>
      t.index === tab.index && t.windowId === tab.windowId ? null : { ...t, index: tab.index, windowId: tab.windowId },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Activity: lastActiveAt / activationCount / dwellMs / coActive (§5.2 — never tab.lastAccessed)
// ---------------------------------------------------------------------------------------------

async function accrueDwell(active: { traceId: string; since: number }, now: number): Promise<void> {
  const inc = Math.min(Math.max(0, now - active.since), MAX_DWELL_INCREMENT_MS);
  if (inc === 0) return;
  await updateTrace(active.traceId, (t) => ({ ...t, dwellMs: t.dwellMs + inc }));
}

async function foreground(tabId: number, now: number): Promise<void> {
  const trace = await getTraceByTabId(tabId);
  const active = await getMeta('activeNow');
  if (active && active.traceId !== trace?.traceId) await accrueDwell(active, now);
  if (!trace) {
    await setMeta('activeNow', null);
    return;
  }
  if (active?.traceId === trace.traceId) return; // already foregrounded; nothing new to count

  const recent = ((await getMeta('recentActivations')) ?? []).filter(
    (a) => now - a.at <= CO_ACTIVE_WINDOW_MS,
  );
  const partners = new Set(recent.map((a) => a.traceId).filter((id) => id !== trace.traceId));

  await updateTrace(trace.traceId, (t) => {
    const coActive = { ...t.coActive };
    for (const p of partners) coActive[p] = (coActive[p] ?? 0) + 1;
    return { ...t, lastActiveAt: now, activationCount: t.activationCount + 1, coActive };
  });
  for (const p of partners) {
    await updateTrace(p, (t) => ({
      ...t,
      coActive: { ...t.coActive, [trace.traceId]: (t.coActive[trace.traceId] ?? 0) + 1 },
    }));
  }

  recent.push({ traceId: trace.traceId, at: now });
  await setMeta('recentActivations', recent);
  await setMeta('activeNow', { traceId: trace.traceId, since: now });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const now = Date.now();
  void serial(ACTIVITY_LANE, () => foreground(tabId, now));
});

/** Dwell stops when Chrome itself is in the background. */
chrome.windows.onFocusChanged.addListener((windowId) => {
  const now = Date.now();
  void serial(ACTIVITY_LANE, async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      const active = await getMeta('activeNow');
      if (active) await accrueDwell(active, now);
      await setMeta('activeNow', null);
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id !== undefined) await foreground(tab.id, now);
  });
});

// ---------------------------------------------------------------------------------------------
// Digest from the content script
// ---------------------------------------------------------------------------------------------

interface DigestMessage {
  type: 'digest';
  url: string;
  title: string;
  digest: Digest;
  reason: 'complete' | 'visible' | 'requested';
}

function isThin(d: Digest | null): boolean {
  return !d || (d.headings.length === 0 && d.leadText.length < 100);
}

async function handleDigest(tabId: number, msg: DigestMessage): Promise<void> {
  const now = Date.now();
  const never = await getNeverRemember();
  await updateTraceByTabId(tabId, (t) => {
    // §6.10: a never-remember site keeps only what grouping needs (url, timing, lineage) —
    // no title, no page content — and its record goes when the tab does.
    if (isNeverRemembered(t, never)) return t.title || t.digest ? { ...t, title: '', digest: null, digestAt: null } : null;
    const sameUrl = t.url === msg.url;
    // 10-minute rule — except that a first-visible capture may replace a thin one, because pages
    // that render lazily while hidden produce an empty digest at readyState=complete.
    if (sameUrl && t.digestAt !== null && now - t.digestAt < DIGEST_MIN_INTERVAL_MS) {
      if (!(msg.reason === 'visible' && isThin(t.digest) && !isThin(msg.digest))) return null;
    }
    // The content script's location is authoritative for what was digested; this also stops a
    // racing onUpdated from wiping a digest that belongs to the new URL.
    const urlPatch = sameUrl ? {} : { url: msg.url, ...urlFeatures(msg.url) };
    return { ...t, ...urlPatch, title: msg.title || t.title, digest: msg.digest, digestAt: now };
  });
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  const m = msg as Partial<DigestMessage> | undefined;
  if ((m as { type?: string } | undefined)?.type === 'summarise-kick') {
    void kickSummariser();
    return false;
  }
  if (m?.type === 'digest' && sender.tab?.id !== undefined && m.digest && m.url) {
    const tabId = sender.tab.id;
    serial(tabId, () => handleDigest(tabId, m as DigestMessage)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  return false;
});

// ---------------------------------------------------------------------------------------------
// Startup re-bind (§5.3): tab ids are reassigned across restarts, traces are not
// ---------------------------------------------------------------------------------------------

async function rebindAll(): Promise<void> {
  const now = Date.now();
  const tabs = (await chrome.tabs.query({})).filter((t) => t.id !== undefined);
  const live = new Set(tabs.map((t) => t.id!));

  for (const tab of tabs) {
    // Through the per-tab lane so this cannot interleave with an onUpdated for the same tab.
    await serial(tab.id!, async () => {
      const bound = await getTraceByTabId(tab.id!);
      if (bound && bound.url === tabUrl(tab)) return;
      await bindOrAdopt(tab, live);
    });
  }

  // Whatever is still open in the store but bound to no live tab was closed while we were away.
  for (const t of await getOpenTraces()) {
    if (!live.has(t.tabId)) await putTrace({ ...t, closedAt: now });
  }

  await serial(ACTIVITY_LANE, async () => {
    await setMeta('activeNow', null);
    await setMeta('recentActivations', []);
  });
}

/**
 * On install/update, re-derive timing for traces that were backfilled under an older rule —
 * the first rule took the latest visit, which after a session restore is always 'reload' at
 * restart time. Event-time traces are never touched.
 */
async function refreshBackfilled(): Promise<void> {
  for (const t of await getOpenTraces()) {
    if (!t.backfilled || !/^https?:/.test(t.url)) continue;
    const visit = await lastVisit(t.url);
    if (!visit || (visit.visitTime === t.openedAt && visit.transition === t.transition)) continue;
    await updateTrace(t.traceId, (cur) => ({ ...cur, openedAt: visit.visitTime, transition: visit.transition }));
  }
}

chrome.runtime.onInstalled.addListener(() => void rebindAll().then(refreshBackfilled).then(takeSnapshot));
// Also on every worker start: idempotent, cheap, and independent of whether onInstalled fired.
void refreshBackfilled();
chrome.runtime.onStartup.addListener(() => void rebindAll());

// Phase 1: the icon opens the sweep page. The x-ray page stays reachable by URL for the study.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/sweep/index.html') });
});
// Anything left in the queue from before the worker died gets picked up on start.
void runSummariser();
void ensureStudyAlarm();
