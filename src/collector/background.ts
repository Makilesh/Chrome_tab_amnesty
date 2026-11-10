/**
 * Collector service worker. Records, never touches UI, never closes or groups anything.
 * (Phase 1 adds one passive duty: driving the summarisation queue's alarm — see summarise.ts.
 * Phase 2 adds the ways in to the sweep page: the icon and its shortcut, "ta" in the address bar
 * (the end of this file), and a first install (openOnFirstInstall).)
 *
 * Every handler reads and writes IndexedDB directly: MV3 kills this worker after 30 s idle, so
 * nothing of consequence may live in a module-level variable (§5.5). Lineage (§5.1) and
 * activity (§5.2) are captured at event time because they cannot be read back later.
 */
import type { Digest, TabTrace } from '../cluster/types';
import {
  CO_ACTIVE_WINDOW_MS,
  deleteTrace,
  getAllTraces,
  getMeta,
  getOpenTraces,
  getOpenTracesByUrl,
  getTrace,
  getTraceByTabId,
  onDatabaseReset,
  putTrace,
  setMeta,
  updateTrace,
  updateTraceByTabId,
} from './db';
import { isNeverRemembered } from '../archive/forget';
import { searchArchive } from '../archive/search';
import type { ArchivedTab } from '../archive/types';
import { ambientPath, isAmbient } from '../cluster/affinity';
import { getCards, getNeverRemember, pruneClosedRecords, seedBackup } from '../archive/store';
import { hasStarted, start } from './consent';
import { asTransition } from './transition';
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
    url: storedUrl(url),
    ...urlFeatures(storedUrl(url)),
    title: tab.title ?? '',
    digest: null,
    digestAt: null,
    pinned: tab.pinned,
    discarded: tab.discarded ?? false,
    closedAt: null,
  };
}

/**
 * Records that keep no title and no page content, only what grouping needs (url, timing,
 * lineage): a never-remember site (§6.10), and a mail, chat, calendar or search-results tab (the
 * ambient list), which is never grouped, named, put away or searched — its title would serve
 * nothing, and a search page's title is the search itself.
 */
function textless(t: TabTrace, never: readonly string[]): boolean {
  return !/^https?:/.test(t.url) || isNeverRemembered(t, never) || isAmbient(t);
}

/**
 * What a record keeps of an address. A web page's is kept whole — grouping reads it — except on
 * the ambient list (mail, chat, calendar, search and message pages): the site and the listed path
 * only (affinity `ambientPath`), never a search's words, a message's id or anything after them. A
 * page that is not a web page is never grouped: a browser or extension page keeps where it is; a
 * local file, a blob, a data: page or about:blank only what kind of address it was — a file's
 * path, a blob's site and a data page's own content say too much. Applied wherever an address is
 * stored, and to every address compared with a stored one, so a restored tab still finds its record.
 */
function storedUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return /^(chrome|edge|brave|opera|vivaldi|chrome-extension|extension):$/.test(u.protocol) ? `${u.protocol}//${u.host}${u.pathname}` : u.protocol;
  }
  const kept = ambientPath(urlFeatures(url));
  return kept === null ? url : `${u.protocol}//${u.host}/${kept}`;
}

/** A digest held to the content script's own limits (content.ts), whatever a page managed to send. */
function cleanDigest(d: unknown): Digest {
  const o = d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const headings = Array.isArray(o.headings) ? o.headings.filter((h): h is string => typeof h === 'string').slice(0, 20).map((h) => h.slice(0, 120)) : [];
  return { description: str(o.description, 500), headings, leadText: str(o.leadText, 1000) };
}

function scrubbed(t: TabTrace, never: readonly string[]): TabTrace {
  return textless(t, never) && (t.title || t.digest) ? { ...t, title: '', digest: null, digestAt: null } : t;
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
  if (!url) return undefined;
  const candidates = (await getOpenTracesByUrl(storedUrl(url))).filter((t) => !live.has(t.tabId));
  if (candidates.length === 0) return undefined;
  const score = (t: TabTrace) => (t.windowId === tab.windowId ? 0 : 1_000_000) + Math.abs(t.index - tab.index);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

/**
 * A tab we have no live trace for. Either it is a restored tab whose trace is waiting to be
 * re-bound, or it is genuinely new to us (open before install, or before Start) and gets adopted
 * with its timing marked unknown: when and how it was opened cannot be known (DECISIONS
 * 2026-11-10). Lineage is never backfilled.
 *
 * This runs from whichever event sees the tab first — onUpdated during session restore, or
 * rebindAll from onStartup — so the outcome does not depend on event order.
 */
async function bindOrAdopt(tab: chrome.tabs.Tab, live?: Set<number>): Promise<TabTrace> {
  const url = tabUrl(tab);
  const orphan = await findOrphanFor(tab, url, live ?? (await liveTabIds()));
  const never = await getNeverRemember();
  if (orphan) {
    const bound = scrubbed(
      {
        ...orphan,
        tabId: tab.id ?? -1,
        windowId: tab.windowId,
        index: tab.index,
        pinned: tab.pinned,
        discarded: tab.discarded ?? false,
        // A tab created by Bring back has title "" until its page loads; the stored one is right.
        title: tab.title || orphan.title,
      },
      never,
    );
    await putTrace(bound);
    return bound;
  }
  const trace = scrubbed(
    {
      traceId: crypto.randomUUID(),
      openerTraceId: null,
      // Timing unknown: the clusterer keeps it out of time-based sessions (segment.ts, timingKnown).
      openedAt: Date.now(),
      transition: 'unknown',
      backfilled: true,
      ...baseTrace(tab, url),
    },
    never,
  );
  await putTrace(trace);
  return trace;
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
  if (!(await hasStarted())) return; // asked first (consent.ts)
  const url = tabUrl(tab);
  // Session restore (and Bring back) can surface a tab through onCreated; if an orphaned trace
  // already describes it, re-bind rather than minting a second identity for the same tab. A tab
  // opened FROM another tab is new whatever its url — a window closed a minute ago still has
  // orphans waiting for the reconcile alarm, and binding to one of them lost this tab's opener.
  if (tab.openerTabId === undefined && /^https?:/.test(url) && (await findOrphanFor(tab, url, await liveTabIds()))) {
    await bindOrAdopt(tab);
    return;
  }
  // §5.1: openerTabId exists only now. Resolve it to a traceId immediately or lose it.
  const opener =
    tab.openerTabId !== undefined ? await getTraceByTabId(tab.openerTabId) : undefined;
  const trace = scrubbed(
    {
      traceId: crypto.randomUUID(),
      openerTraceId: opener?.traceId ?? null,
      openedAt,
      transition: 'unknown',
      backfilled: false,
      ...baseTrace(tab, url),
    },
    await getNeverRemember(),
  );
  await putTrace(trace); // how it was reached arrives with its first page (webNavigation, below)
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
    if (await hasStarted()) await bindOrAdopt(tab); // asked first (consent.ts)
    return;
  }
  const newUrl = changeInfo.url === undefined ? undefined : storedUrl(changeInfo.url);
  const urlChanged = newUrl !== undefined && newUrl !== existing.url;
  const never = await getNeverRemember();
  const updated = await updateTrace(existing.traceId, (t) => {
    let next: TabTrace = {
      ...t,
      tabId,
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned,
      discarded: tab.discarded ?? false,
      // While a page loads Chrome shows its address as the title; that placeholder must not
      // replace a stored title (a brought-back group lost its name to it). Take a title when
      // Chrome reports one, when the tab has moved to another page, or when there is none yet.
      title: changeInfo.title ?? (urlChanged || !t.title ? (tab.title || t.title) : t.title),
    };
    if (urlChanged && newUrl) {
      // One trace per tab for its lifetime; a navigation refreshes what the tab is about but
      // keeps openedAt / transition / lineage as they were at creation.
      next = { ...next, url: newUrl, ...urlFeatures(newUrl), digest: null, digestAt: null, typing: false };
    }
    if (textless(next, never)) next = { ...next, title: '', digest: null, digestAt: null };
    return next;
  });
  if (!updated) return;

  if (urlChanged && !updated.discarded && /^https?:/.test(updated.url)) {
    // SPA navigations do not re-inject the content script; ask it for a fresh digest. On a full
    // navigation the message lands in a torn-down frame and simply fails.
    chrome.tabs.sendMessage(tabId, { type: 'capture' }).catch(() => {});
  }
}

/**
 * How a tab's first page was reached (a link, a typed address, a bookmark, a search), as Chrome
 * reports it when that page commits: the best task-boundary signal there is. Only the visit that
 * opened the tab counts (one trace per tab for its lifetime), so this fills in a fresh trace's
 * 'unknown' and nothing else: not a frame, not a page prerendering for the tab, not a tab adopted
 * with unknown timing.
 */
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || d.tabId < 0 || !/^https?:/.test(d.url)) return;
  if ((d as { documentLifecycle?: string }).documentLifecycle === 'prerender') return;
  const transition = asTransition(d.transitionType);
  if (transition === 'unknown') return;
  void serial(d.tabId, () =>
    updateTraceByTabId(d.tabId, (t) => (t.transition === 'unknown' && !t.backfilled ? { ...t, transition } : null)),
  );
});

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
  if (alarm.name === RECONCILE_ALARM) void rebindAll(true); // the browser is still running
  if (alarm.name === SUMMARISE_ALARM) void runSummariser();
  if (alarm.name === STUDY_ALARM) void snapshotIfStarted();
  if (alarm.name === PRUNE_ALARM) void pruneClosedRecords();
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

/**
 * The trace of a tab that may have been created a moment ago. onCreated runs in the tab's lane,
 * onActivated in the activity lane, so a tab opened in the foreground (a link with target=_blank,
 * Ctrl+T) is activated before its trace exists. The activity lane must not wait on a tab lane
 * (see serial), so it looks again for a moment instead. Without this every such tab lost its
 * first activation and the opener↔child switch never reached coActive (S8).
 */
async function traceSoon(tabId: number): Promise<TabTrace | undefined> {
  for (let i = 0; ; i++) {
    const t = await getTraceByTabId(tabId);
    if (t || i >= 10) return t;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function foreground(tabId: number, now: number): Promise<void> {
  if (!(await hasStarted())) return; // nothing is counted before Start (consent.ts)
  const trace = await traceSoon(tabId);
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
    const msgUrl = storedUrl(msg.url);
    const sameUrl = t.url === msgUrl;
    // The content script's location is authoritative for what was digested; this also stops a
    // racing onUpdated from wiping a digest that belongs to the new URL.
    const urlPatch = sameUrl ? {} : { url: msgUrl, ...urlFeatures(msgUrl) };
    // A never-remember site or an ambient tab keeps no title or page content (textless) — judged
    // by the page this digest is of, not the one the record held a moment ago.
    if (textless({ ...t, ...urlPatch }, never)) return t.title || t.digest ? { ...t, title: '', digest: null, digestAt: null } : null;
    // 10-minute rule — except that a first-visible capture may replace a thin one, because pages
    // that render lazily while hidden produce an empty digest at readyState=complete.
    const digest = cleanDigest(msg.digest);
    if (sameUrl && t.digestAt !== null && now - t.digestAt < DIGEST_MIN_INTERVAL_MS) {
      if (!(msg.reason === 'visible' && isThin(t.digest) && !isThin(digest))) return null;
    }
    const title = typeof msg.title === 'string' ? msg.title.slice(0, 500) : '';
    return { ...t, ...urlPatch, title: title || t.title, digest, digestAt: now };
  });
}

/** A document the tab is actually showing — not one prerendering for it or parked in the back/forward cache. */
function showing(sender: chrome.runtime.MessageSender): boolean {
  return sender.documentLifecycle === undefined || sender.documentLifecycle === 'active';
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  const m = msg as Partial<DigestMessage> | undefined;
  // An extension page was the first to open a database Chrome had replaced (db.ts afterCreate).
  if ((m as { type?: string } | undefined)?.type === 'database-reset' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    void rebindAll();
    return false;
  }
  if ((m as { type?: string } | undefined)?.type === 'summarise-kick') {
    void kickSummariser();
    return false;
  }
  // The sweep page asks which build this worker is: an older one than the page means Chrome is
  // still running the worker it registered before the folder was updated (DECISIONS 2026-10-17).
  if ((m as { type?: string } | undefined)?.type === 'build' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    sendResponse({ build: __BUILD_ID__ });
    return false;
  }
  // The person pressed Start on the sweep page (consent.ts): from now on Tab Amnesty records.
  if ((m as { type?: string } | undefined)?.type === 'start' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    startRecording().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  const typed = msg as { type?: string; typing?: boolean } | undefined;
  if (typed?.type === 'typing' && sender.tab?.id !== undefined && showing(sender)) {
    const tabId = sender.tab.id;
    const value = typed.typing === true;
    // Any frame can say a draft is there (editors live in iframes); only the top frame can say it
    // is gone. This flag is the fallback — Archive & close asks every frame at the click.
    if (!value && sender.frameId !== 0) return false;
    void serial(tabId, () => updateTraceByTabId(tabId, (t) => (!!t.typing === value ? null : { ...t, typing: value })));
    return false;
  }
  // The top frame of the page the tab is showing only: a prerendered page (speculation rules)
  // reports with the tab's id from another frame, and would rewrite the trace to a page the
  // person never opened.
  if (m?.type === 'digest' && sender.tab?.id !== undefined && sender.frameId === 0 && showing(sender) && m.digest && m.url) {
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

/**
 * `keepActivity`: the browser kept running (the reconcile after a window closed), so the tab in
 * front is still in front — its dwell is banked and counting goes on. At startup, install and a
 * database reset the stored activity describes a past that is gone, and is cleared.
 */
async function rebindAll(keepActivity = false): Promise<void> {
  if (!(await hasStarted())) return; // asked first (consent.ts)
  const now = Date.now();
  const tabs = (await chrome.tabs.query({})).filter((t) => t.id !== undefined);

  for (const tab of tabs) {
    // Through the per-tab lane so this cannot interleave with an onUpdated for the same tab.
    await serial(tab.id!, async () => {
      // A trace bound to this live tab is its record, whatever url it holds this instant: a
      // navigation in flight reaches it through onUpdated, queued behind us in this lane.
      // (Comparing with the url from the snapshot above minted a second record for the tab.)
      if (await getTraceByTabId(tab.id!)) return;
      const fresh = await chrome.tabs.get(tab.id!).catch(() => undefined);
      // Live tabs asked again too: a trace of a tab opened during this loop is not an orphan.
      if (fresh) await bindOrAdopt(fresh);
    });
  }

  // Whatever is still open in the store but bound to no live tab was closed while we were away.
  // Asked again now: a tab opened while the loop ran is live, not closed (and keeps its lineage).
  // A live tab at a record's url with no record of its own yet is about to be bound to it (a
  // restored tab that appeared after the list above was taken): closing the record now would hand
  // that tab a fresh one without its lineage. Counted per url, so two dead records and one
  // restored tab still close one of them.
  const claims = new Map<string, number>();
  const awaitingBind = async (url: string, tabsNow: chrome.tabs.Tab[]): Promise<boolean> => {
    let unbound = 0;
    for (const x of tabsNow) if (storedUrl(tabUrl(x)) === url && !(await getTraceByTabId(x.id!))) unbound++;
    const used = claims.get(url) ?? 0;
    if (used >= unbound) return false;
    claims.set(url, used + 1);
    return true;
  };
  const never = await getNeverRemember();
  for (const t of await getOpenTraces()) {
    const tabsNow = (await chrome.tabs.query({})).filter((x) => x.id !== undefined);
    if (tabsNow.some((x) => x.id === t.tabId)) continue;
    if (await awaitingBind(t.url, tabsNow)) continue;
    // Checked again inside the write: a restored tab re-bound to this record since it was read
    // (onCreated) must not be put back on the dead tab id and closed.
    const stillDead = (cur: TabTrace) => cur.closedAt === null && cur.tabId === t.tabId;
    if (isNeverRemembered(t, never)) {
      const cur = await getTrace(t.traceId);
      if (cur && stillDead(cur)) await deleteTrace(t.traceId); // §6.10, as a single-tab close does
    } else {
      await updateTrace(t.traceId, (cur) => (stillDead(cur) ? { ...cur, closedAt: now } : null));
    }
  }

  await serial(ACTIVITY_LANE, async () => {
    if (keepActivity) {
      const active = await getMeta('activeNow');
      if (active) {
        const at = Date.now();
        await accrueDwell(active, at);
        await setMeta('activeNow', { ...active, since: at });
      }
      return;
    }
    await setMeta('activeNow', null);
    await setMeta('recentActivations', []);
  });
}

/**
 * Start pressed: the tabs already open are adopted at once and asked for their page text again
 * (what their pages sent before the answer was not kept), so the sweep page has groups to show.
 */
async function startRecording(): Promise<void> {
  await start();
  await rebindAll();
  for (const t of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (t.id !== undefined && !t.discarded) chrome.tabs.sendMessage(t.id, { type: 'capture' }).catch(() => {});
  }
  await snapshotIfStarted();
}

/** The research study's open-tab count (study builds only), once recording is allowed. */
async function snapshotIfStarted(): Promise<void> {
  if (__STUDY__ && (await hasStarted())) await takeSnapshot();
}

// Install and update: adopt the open tabs (rebindAll asks hasStarted first, which also counts
// someone already using Tab Amnesty as started), tidy old records, and on a first install open the
// sweep page, which asks the person first.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  const adopted = rebindAll();
  void adopted.then(snapshotIfStarted);
  void scrubAmbient().then(() => pruneClosedRecords());
  if (reason === 'install') void adopted.then(openOnFirstInstall, openOnFirstInstall);
});

/**
 * A first install opens the sweep page, in front: it asks the person first (the Start notice,
 * consent.ts) and, once they say yes, shows their own tabs grouped (§6.3), without their having to
 * find and pin the icon first. Never on an update, a Reload ('update') or a Chrome update; and once per
 * database, not per 'install', because Chrome reports every start of an extension loaded with
 * --load-extension (npm run check, the walkthrough) as an install. Uninstalling takes the database
 * along, so installing again is a first install again.
 */
async function openOnFirstInstall(): Promise<void> {
  if (await getMeta('firstRunShown')) return;
  await setMeta('firstRunShown', true);
  await chrome.tabs.create({ url: sweepUrl(), active: true });
}

/**
 * Records written before the rules above — of ambient tabs and of pages that are not web pages —
 * lose their title, page text and what `storedUrl` no longer keeps of their address: once, on
 * install or update.
 */
async function scrubAmbient(): Promise<void> {
  const quiet = (x: TabTrace) => !/^https?:/.test(x.url) || isAmbient(x);
  const clean = (x: TabTrace): TabTrace => ({ ...x, url: storedUrl(x.url), ...urlFeatures(storedUrl(x.url)), title: '', digest: null, digestAt: null });
  const dirty = (x: TabTrace) => quiet(x) && (!!x.title || !!x.digest || storedUrl(x.url) !== x.url);
  for (const t of await getAllTraces()) {
    if (dirty(t)) await updateTrace(t.traceId, (x) => (dirty(x) ? clean(x) : null));
  }
}

/** Once a day: records of tabs closed long ago that no card holds go (store.pruneClosedRecords). */
const PRUNE_ALARM = 'prune-closed-records';
async function ensurePruneAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(PRUNE_ALARM))) await chrome.alarms.create(PRUNE_ALARM, { delayInMinutes: 10, periodInMinutes: 24 * 60 });
}
chrome.runtime.onStartup.addListener(() => void rebindAll());

/**
 * Tabs that were already open when this version started — a first install, a Reload, switching
 * it back on — never get the manifest's content script (MV3 injects only as pages load), so
 * nothing could see typing or take a digest in them until they navigated: Archive & close closed
 * drafts typed into them. The worker's own `install` event fires exactly then (a new
 * registration), never on the every-few-minutes restarts. Discarded tabs have no page and are
 * left alone (§5.4: never reload a tab to read it).
 */
async function injectIntoOpenTabs(): Promise<void> {
  const files = chrome.runtime.getManifest().content_scripts?.flatMap((c) => c.js ?? []) ?? [];
  if (files.length === 0) return;
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (tab.id === undefined || tab.discarded) continue;
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files }).catch(() => {});
  }
}
// (Optional call: only a worker's global is an event target, not the test runner's.)
(globalThis as unknown as Partial<EventTarget>).addEventListener?.('install', () => void injectIntoOpenTabs());
// Chrome replaced the database with an empty one (db.ts): adopt every open tab again now, rather
// than recording nothing about them until the next restart (7 Oct: 13 hours).
onDatabaseReset(() => void rebindAll());

// ---------------------------------------------------------------------------------------------
// Ways in to the sweep page: the icon and its shortcut, the address bar (a first install: above)
// ---------------------------------------------------------------------------------------------

/** The sweep page; with `find`, it opens searching what was put away for that (sweep.ts). */
function sweepUrl(find = ''): string {
  const page = chrome.runtime.getURL('src/ui/sweep/index.html');
  return find ? `${page}?find=${encodeURIComponent(find)}` : page;
}

// Phase 1: the icon opens the sweep page — and so does its shortcut, Alt+Shift+K (manifest
// `commands`): `_execute_action` fires onClicked just as a click does. The x-ray page stays
// reachable by URL for the study (not in the store build, which has no study).
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: sweepUrl() });
});

/** The most put-away pages the address bar lists at once: five, as the page shows five cards (§6.4). */
const ADDRESS_BAR_PAGES = 5;

/**
 * Text for an address-bar line, which Chrome reads as XML: the five characters XML reserves are
 * escaped, and control characters (with U+FFFE and U+FFFF) become spaces — XML cannot hold most of
 * them, and Chrome drops every line offered with one it cannot read.
 */
function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f\ufffe\uffff]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A put-away page the address bar may offer and open: a web page, never one on a site never
 * remembered (§6.10). Cards do not hold those — never remembering a site takes its lines out of
 * every card (store.addNeverRemember) — so this is a second guard, not the rule.
 */
function offerable(t: ArchivedTab, never: readonly string[]): boolean {
  return /^https?:\/\//i.test(t.url) && !isNeverRemembered(t, never);
}

/**
 * "ta" and some words: the sweep page's own search (search.ts), best first as the page lists it,
 * each page once — its title (its address when it has none) and, dimmed, the name of the card it
 * was put away in. Nothing counted (§6.1).
 */
async function putAwayPages(text: string): Promise<chrome.omnibox.SuggestResult[]> {
  const never = await getNeverRemember();
  const lines: chrome.omnibox.SuggestResult[] = [];
  for (const hit of searchArchive(await getCards(), text)) {
    for (const t of hit.tabs) {
      if (!offerable(t, never) || lines.some((l) => l.content === t.url)) continue;
      const page = t.title.trim() ? xmlText(t.title) : `<url>${xmlText(t.url)}</url>`;
      const card = hit.card.name.trim();
      lines.push({ content: t.url, description: card ? `${page} <dim>· ${xmlText(card)}</dim>` : page });
      if (lines.length === ADDRESS_BAR_PAGES) return lines;
    }
  }
  return lines;
}

/** Is this the address of a page that was put away (and may be offered)? */
async function isPutAway(url: string): Promise<boolean> {
  const never = await getNeverRemember();
  return (await getCards()).some((c) => c.tabs.some((t) => t.url === url && offerable(t, never)));
}

/**
 * Enter in the address bar. A put-away page's address — a line picked, or one typed out in full —
 * opens that page; anything else opens the sweep page searching for it. The address is checked
 * against the cards again, not remembered from the lines offered (the worker may have stopped in
 * between, §5.5), so nothing typed is ever opened unless it is a web page that was put away.
 */
async function enterInAddressBar(text: string, disposition: chrome.omnibox.OnInputEnteredDisposition): Promise<void> {
  const typed = text.trim();
  const url = typed && (await isPutAway(typed).catch(() => false)) ? typed : sweepUrl(typed);
  // Where Chrome asks for it: in this tab, or in a new one in front or behind.
  if (disposition === 'currentTab') await chrome.tabs.update({ url }).catch(() => chrome.tabs.create({ url }));
  else await chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
}

// Chrome keeps this and puts what is typed in place of %s; set on every start, as that costs nothing.
chrome.omnibox.setDefaultSuggestion({ description: 'Find something you put away: %s' });
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void putAwayPages(text).then(suggest, () => suggest([]));
});
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  void enterInAddressBar(text, disposition);
});

// Anything left in the queue from before the worker died gets picked up on start.
void runSummariser();
if (__STUDY__) void ensureStudyAlarm();
void ensurePruneAlarm();
void seedBackup();
