/**
 * The collector's event handling, run for real: this loads background.ts itself, with chrome.*
 * scripted and db.ts replaced by an in-memory store with db.ts's semantics (every call takes a
 * turn of the event loop, as an IndexedDB request does). Each case is a race the 17 Oct review
 * reproduced against the shipped worker; they pin the fixed behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveCard } from '../archive/types';
import type { TabTrace } from '../cluster/types';

const h = vi.hoisted(() => {
  const store = new Map<string, TabTrace>();
  const meta = new Map<string, unknown>();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const clone = <T>(x: T): T => (x === undefined ? x : structuredClone(x));
  const open = () => [...store.values()].filter((t) => t.closedAt === null);
  /** Runs before getOpenTraces answers its n-th call (to land an event at an exact moment). */
  const hooks: { onGetOpen: ((n: number) => void) | null; getOpenCalls: number } = { onGetOpen: null, getOpenCalls: 0 };
  async function getTraceByTabId(tabId: number) {
    await tick();
    return clone(open().filter((t) => t.tabId === tabId).sort((a, b) => b.openedAt - a.openedAt)[0]);
  }
  async function updateTrace(id: string, fn: (t: TabTrace) => TabTrace | null) {
    await tick();
    const cur = store.get(id);
    if (!cur) return undefined;
    const next = fn(clone(cur));
    if (next) store.set(id, clone(next));
    return clone(next ?? cur);
  }
  const never: string[] = [];
  /** What was put away, newest first, as store.getCards gives it. */
  const cards: ArchiveCard[] = [];
  return { store, meta, tick, clone, open, hooks, getTraceByTabId, updateTrace, never, cards };
});

vi.mock('./db', () => ({
  CO_ACTIVE_WINDOW_MS: 60_000,
  putTrace: async (t: TabTrace) => {
    await h.tick();
    h.store.set(t.traceId, h.clone(t));
  },
  getTrace: async (id: string) => {
    await h.tick();
    return h.clone(h.store.get(id));
  },
  getTraceByTabId: h.getTraceByTabId,
  getAllTraces: async () => {
    await h.tick();
    return [...h.store.values()].map(h.clone);
  },
  getOpenTraces: async () => {
    await h.tick();
    h.hooks.onGetOpen?.(++h.hooks.getOpenCalls);
    return h.open().map(h.clone);
  },
  getOpenTracesByUrl: async (url: string) => {
    await h.tick();
    return h.open().filter((t) => t.url === url).map(h.clone);
  },
  deleteTrace: async (id: string) => {
    await h.tick();
    h.store.delete(id);
  },
  updateTrace: h.updateTrace,
  updateTraceByTabId: async (tabId: number, fn: (t: TabTrace) => TabTrace | null) => {
    const t = await h.getTraceByTabId(tabId);
    return t ? h.updateTrace(t.traceId, fn) : undefined;
  },
  getMeta: async (k: string) => {
    await h.tick();
    return h.clone(h.meta.get(k));
  },
  setMeta: async (k: string, v: unknown) => {
    await h.tick();
    h.meta.set(k, h.clone(v));
  },
  onDatabaseReset: () => {},
}));
vi.mock('../archive/store', () => ({
  getNeverRemember: async () => [...h.never],
  getCards: async () => {
    await h.tick();
    return h.cards.map(h.clone);
  },
  seedBackup: async () => {},
  pruneClosedRecords: async () => 0,
}));
vi.mock('./study', () => ({ STUDY_ALARM: 'study-snapshot', takeSnapshot: async () => {}, ensureStudyAlarm: async () => {} }));
vi.mock('./summarise', () => ({ SUMMARISE_ALARM: 'summarise', runSummariser: async () => {}, kickSummariser: async () => {} }));

type Listener = (...a: unknown[]) => unknown;
function ev() {
  const ls: Listener[] = [];
  return { addListener: (l: Listener) => void ls.push(l), fire: (...a: unknown[]) => ls.map((l) => l(...a)) };
}

interface FakeTab {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  pinned: boolean;
  discarded: boolean;
  active: boolean;
  openerTabId?: number;
}
let liveTabs: FakeTab[] = [];
const chromeMock = {
  tabs: {
    onCreated: ev(), onUpdated: ev(), onRemoved: ev(), onReplaced: ev(), onMoved: ev(),
    onAttached: ev(), onDetached: ev(), onActivated: ev(),
    query: vi.fn(async (q: { active?: boolean; windowId?: number } = {}) =>
      liveTabs.filter((t) => (q.active === undefined || t.active === q.active) && (q.windowId === undefined || t.windowId === q.windowId)).map((t) => ({ ...t })),
    ),
    get: vi.fn(async (id: number) => {
      const t = liveTabs.find((x) => x.id === id);
      if (!t) throw new Error('No tab with id');
      return { ...t };
    }),
    sendMessage: vi.fn(async () => {}),
    create: vi.fn(async (_p: { url: string; windowId?: number; active?: boolean }): Promise<object> => ({})),
    update: vi.fn(async (_p: { url: string }): Promise<object> => ({})),
    group: vi.fn(async () => 1),
  },
  windows: { onFocusChanged: ev(), WINDOW_ID_NONE: -1, getCurrent: vi.fn(async () => ({ id: 1 })) },
  tabGroups: { update: vi.fn(async () => ({})) },
  alarms: { onAlarm: ev(), create: vi.fn(async () => {}), clear: vi.fn(async () => true), get: vi.fn(async () => undefined) },
  runtime: {
    onMessage: ev(), onInstalled: ev(), onStartup: ev(),
    getURL: (p: string) => `chrome-extension://abc/${p}`,
    sendMessage: vi.fn(async () => {}),
    getManifest: () => ({ content_scripts: [] }),
  },
  action: { onClicked: ev() },
  omnibox: { onInputChanged: ev(), onInputEntered: ev(), setDefaultSuggestion: vi.fn() },
  webNavigation: { onCommitted: ev() },
  scripting: { executeScript: vi.fn(async () => []) },
};
(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.now();
const DAY = 86_400_000;

function trace(o: Partial<TabTrace> & { traceId: string }): TabTrace {
  return {
    openerTraceId: null, openedAt: NOW - DAY, transition: 'link', backfilled: false,
    tabId: -1, windowId: 1, index: 0, lastActiveAt: null, activationCount: 0, dwellMs: 0, coActive: {},
    url: '', host: '', eTLD1: '', pathTokens: [], queryKeys: {}, title: '', digest: null, digestAt: null,
    pinned: false, discarded: false, closedAt: null, ...o,
  } as TabTrace;
}
const tab = (id: number, index: number, url: string, o: Partial<FakeTab> = {}): FakeTab => ({
  id, windowId: 1, index, url, title: url, pinned: false, discarded: false, active: false, ...o,
});
const openOn = (tabId: number) => h.open().filter((t) => t.tabId === tabId);
const reconcile = () => chromeMock.alarms.onAlarm.fire({ name: 'reconcile-window-close' });

const A = 'https://mail.example.com/inbox';
const B = 'https://mail.example.com/thread/42';
/** A put-away card with one line, the record 'away' at `url`. */
const mailCard = (url: string): ArchiveCard => ({
  cardId: 'c', name: 'Mail', color: 'blue', tier: 'heuristic', when: '', whenAt: null, hosts: ['mail.example.com'], archivedAt: NOW - DAY, undoUntil: NOW, restoredAt: null, sourceCommunity: 0,
  tabs: [{ traceId: 'away', url, title: 'Thread 42 - Mail', host: 'mail.example.com', order: 0, digest: null, summary: null, openedAt: NOW - 2 * DAY }],
});
/** A put-away card holding these pages, in this order. */
const awayCard = (cardId: string, name: string, pages: { url: string; title: string; host: string }[], o: Partial<ArchiveCard> = {}): ArchiveCard => ({
  cardId, name, color: 'green', tier: 'heuristic', when: '', whenAt: null, hosts: [...new Set(pages.map((p) => p.host))], archivedAt: NOW - DAY, undoUntil: NOW, restoredAt: null, sourceCommunity: 0,
  tabs: pages.map((p, order) => ({ traceId: `${cardId}-${order}`, ...p, order, digest: null, summary: null, openedAt: NOW - 2 * DAY })),
  ...o,
});
const SWEEP = 'chrome-extension://abc/src/ui/sweep/index.html';

/** chrome.tabs.create as Chrome does it: the tab exists, then onCreated fires. */
function tabsCreateFrom(firstId: number): void {
  let next = firstId;
  chromeMock.tabs.create.mockImplementation(async (p: { url: string; windowId?: number }) => {
    const t = tab(next++, liveTabs.length, p.url, { title: '' });
    liveTabs.push(t);
    chromeMock.tabs.onCreated.fire({ ...t });
    return { ...t };
  });
}

beforeEach(() => {
  chromeMock.tabs.create.mockClear();
  chromeMock.tabs.update.mockClear();
  chromeMock.tabs.create.mockImplementation(async () => ({}));
  h.store.clear();
  h.meta.clear();
  h.meta.set('startedAt', NOW); // the person has pressed Start; the tests below that ask first take it away
  h.never.length = 0;
  h.cards.length = 0;
  h.hooks.onGetOpen = null;
  h.hooks.getOpenCalls = 0;
  liveTabs = [];
});

describe('collector', () => {
  it('loads', async () => {
    await import('./background');
    await settle();
  });

  it('a tab that navigates while the reconcile runs keeps its one record', async () => {
    h.store.set('real', trace({ traceId: 'real', tabId: 7, index: 1, url: A, openedAt: NOW - 3 * DAY }));
    liveTabs = [tab(3, 0, 'https://x.example/'), tab(7, 1, A)];
    h.store.set('x', trace({ traceId: 'x', tabId: 3, url: 'https://x.example/' }));
    // Tab 7 moves on to B just after the reconcile has listed the tabs.
    h.hooks.onGetOpen = null;
    const listed = chromeMock.tabs.query.getMockImplementation()!;
    chromeMock.tabs.query.mockImplementationOnce(async (q) => {
      const snap = await listed(q);
      setTimeout(() => {
        liveTabs[1] = { ...liveTabs[1]!, url: B };
        chromeMock.tabs.onUpdated.fire(7, { status: 'loading', url: B }, { ...liveTabs[1] });
      }, 0);
      return snap;
    });
    reconcile();
    await settle();
    expect(openOn(7).map((t) => t.traceId)).toEqual(['real']);
    expect(h.store.get('real')!.url).toBe(B);
  });

  it("a window closed a minute ago does not hand its record to a live tab at the same url", async () => {
    h.store.set('real', trace({ traceId: 'real', tabId: 7, index: 1, url: A, openedAt: NOW - 3 * DAY }));
    // Its window closed under a minute ago: the record is still open, waiting for this reconcile.
    h.store.set('closedwin', trace({ traceId: 'closedwin', tabId: 99, windowId: 2, url: A, openedAt: NOW - 2 * DAY }));
    liveTabs = [tab(7, 1, A)];
    reconcile();
    await settle();
    expect(openOn(7).map((t) => t.traceId)).toEqual(['real']);
    expect(h.store.get('closedwin')!.closedAt).not.toBeNull();
  });

  it('a tab opened while the reconcile runs keeps its record and its lineage', async () => {
    h.store.set('p1', trace({ traceId: 'p1', tabId: 5, url: 'https://a.example/1' }));
    liveTabs = [tab(5, 0, 'https://a.example/1')];
    // A link opened from tab 5 lands just before the reconcile's final pass.
    h.hooks.onGetOpen = (n) => {
      if (n !== 1) return;
      h.hooks.onGetOpen = null;
      liveTabs.push(tab(6, 1, 'https://a.example/2', { openerTabId: 5 }));
      chromeMock.tabs.onCreated.fire({ ...liveTabs[1]! });
    };
    reconcile();
    await settle(400);
    const child = h.open().find((t) => t.tabId === 6);
    expect(child?.openerTraceId).toBe('p1');
  });

  it('a re-bind landing between the reconcile reading a record and closing it is not undone', async () => {
    h.store.set('p2', trace({ traceId: 'p2', tabId: 6, index: 1, url: 'https://a.example/2' }));
    liveTabs = [];
    // While the final pass works, the restored tab for p2 appears and is bound to it.
    h.hooks.onGetOpen = (n) => {
      if (n !== 1) return;
      h.hooks.onGetOpen = null;
      liveTabs.push(tab(12, 1, 'https://a.example/2'));
      chromeMock.tabs.onCreated.fire({ ...liveTabs[0]! });
    };
    chromeMock.runtime.onStartup.fire();
    await settle(400);
    expect(h.store.get('p2')).toMatchObject({ tabId: 12, closedAt: null });
  });

  it("the reconcile after a window closes keeps counting the front tab's time", async () => {
    h.store.set('t1', trace({ traceId: 't1', tabId: 1, url: 'https://a.example/1' }));
    h.store.set('t2', trace({ traceId: 't2', tabId: 2, index: 1, url: 'https://a.example/2' }));
    liveTabs = [tab(1, 0, 'https://a.example/1', { active: true }), tab(2, 1, 'https://a.example/2')];
    h.meta.set('activeNow', { traceId: 't1', since: Date.now() - 10 * 60_000 });
    reconcile();
    await settle();
    chromeMock.tabs.onActivated.fire({ tabId: 2, windowId: 1 });
    await settle();
    expect(h.store.get('t1')!.dwellMs).toBeGreaterThan(9 * 60_000);
  });

  it('a tab opened in the foreground gets its first activation and its switch with the opener', async () => {
    h.store.set('op', trace({ traceId: 'op', tabId: 1, url: 'https://a.example/1' }));
    liveTabs = [tab(1, 0, 'https://a.example/1', { active: true })];
    chromeMock.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
    await settle();
    // target=_blank: onCreated and onActivated back to back, before the new trace is written.
    liveTabs.push(tab(2, 1, 'https://a.example/2', { openerTabId: 1, active: true }));
    chromeMock.tabs.onCreated.fire({ ...liveTabs[1]! });
    chromeMock.tabs.onActivated.fire({ tabId: 2, windowId: 1 });
    await settle(800);
    const child = h.open().find((t) => t.tabId === 2)!;
    expect(child.activationCount).toBe(1);
    expect(child.coActive.op).toBe(1);
  });

  it('takes a page digest only from the top frame of the page the tab shows', async () => {
    h.store.set('a', trace({ traceId: 'a', tabId: 4, url: 'https://a.example/a', title: 'A' }));
    liveTabs = [tab(4, 0, 'https://a.example/a')];
    const digest = { description: '', headings: ['B'], leadText: '' };
    const msg = { type: 'digest', url: 'https://a.example/b', title: 'B', digest, reason: 'complete' };
    const respond = vi.fn();
    chromeMock.runtime.onMessage.fire(msg, { tab: { id: 4 }, frameId: 6, documentLifecycle: 'prerender' }, respond);
    await settle();
    expect(h.store.get('a')).toMatchObject({ url: 'https://a.example/a', title: 'A' });
    chromeMock.runtime.onMessage.fire({ ...msg, url: 'https://a.example/a', title: 'A, read' }, { tab: { id: 4 }, frameId: 0, documentLifecycle: 'active' }, respond);
    await settle();
    expect(h.store.get('a')).toMatchObject({ url: 'https://a.example/a', title: 'A, read' });
  });

  it('never-remember: a window-closed record of the site goes, and new records keep no title', async () => {
    h.never.push('bank.example');
    h.store.set('bank', trace({ traceId: 'bank', tabId: 9, url: 'https://bank.example/accounts?acct=1', host: 'bank.example', eTLD1: 'bank.example' }));
    liveTabs = [];
    reconcile();
    await settle();
    expect(h.store.has('bank')).toBe(false);

    liveTabs = [tab(10, 0, 'https://bank.example/', { title: 'Your accounts' })];
    chromeMock.tabs.onCreated.fire({ ...liveTabs[0]! });
    await settle();
    expect(h.open().find((t) => t.tabId === 10)?.title).toBe('');
  });

  it('mail, chat and search tabs keep no title or page text, nor do records written before that rule', async () => {
    const search = 'https://www.google.com/search?q=symptoms+of+something';
    liveTabs = [tab(20, 0, search, { title: 'symptoms of something - Google Search' }), tab(21, 1, 'https://mail.google.com/mail/u/0/#inbox', { title: 'Inbox (3) - me@example.com - Gmail' })];
    chromeMock.tabs.onCreated.fire({ ...liveTabs[0]! });
    chromeMock.tabs.onCreated.fire({ ...liveTabs[1]! });
    await settle();
    expect(openOn(20).map((t) => t.title)).toEqual(['']);
    expect(openOn(21).map((t) => t.title)).toEqual(['']);
    // The address keeps its site and path: not the search's words, not the message's id.
    expect(openOn(20)[0]).toMatchObject({ url: 'https://www.google.com/search', queryKeys: {} });
    expect(openOn(21)[0]!.url).toBe('https://mail.google.com/'); // a listed site keeps nothing past the site
    chromeMock.tabs.onUpdated.fire(21, { title: 'Re: the lease - me@example.com - Gmail' }, { ...liveTabs[1]!, title: 'Re: the lease - me@example.com - Gmail' });
    const respond = vi.fn();
    const digest = { description: '', headings: ['Re: the lease'], leadText: 'Dear landlord' };
    chromeMock.runtime.onMessage.fire({ type: 'digest', url: liveTabs[1]!.url, title: 'Re: the lease', digest, reason: 'complete' }, { tab: { id: 21 }, frameId: 0, documentLifecycle: 'active' }, respond);
    await settle();
    expect(openOn(21)[0]).toMatchObject({ title: '', digest: null });
    // A tab that moves onto a search page: the digest of that page is not kept, though the record still held the old page.
    h.store.set('docs', trace({ traceId: 'docs', tabId: 22, url: 'https://docs.example/a', title: 'Docs' }));
    liveTabs.push(tab(22, 2, 'https://docs.example/a'));
    chromeMock.runtime.onMessage.fire({ type: 'digest', url: 'https://www.bing.com/search?q=private', title: 'private - Search', digest, reason: 'complete' }, { tab: { id: 22 }, frameId: 0, documentLifecycle: 'active' }, respond);
    await settle();
    expect(h.store.get('docs')).toMatchObject({ title: '', digest: null });
    // Written before the rules: cleared on install or update — text, query and fragment.
    h.store.set('old', trace({ traceId: 'old', tabId: 30, url: 'https://web.whatsapp.com/', host: 'web.whatsapp.com', eTLD1: 'whatsapp.com', title: 'WhatsApp - (2) Mum', closedAt: NOW - DAY }));
    h.store.set('oldsearch', trace({
      traceId: 'oldsearch', tabId: 31, url: 'https://duckduckgo.com/?q=private+words&ia=web', host: 'duckduckgo.com', eTLD1: 'duckduckgo.com',
      queryKeys: { q: 'private words', ia: 'web' }, title: 'private words at DuckDuckGo', closedAt: NOW - DAY,
    }));
    chromeMock.runtime.onInstalled.fire({ reason: 'update' });
    await settle(400);
    expect(h.store.get('old')).toMatchObject({ title: '', digest: null });
    expect(h.store.get('oldsearch')).toMatchObject({ url: 'https://duckduckgo.com/', queryKeys: {}, title: '' });
  });

  it('message and regional search pages keep only the site and the listed path; pages that are not web pages keep no text', async () => {
    liveTabs = [
      tab(70, 0, 'https://www.linkedin.com/messaging/thread/2-ABCdef123/', { title: 'Messaging | LinkedIn' }),
      tab(71, 1, 'https://uk.search.yahoo.com/search?p=private+question', { title: 'private question - Yahoo Search' }),
      tab(72, 2, 'https://outlook.office.com/mail/id/AAQkAGI2', { title: 'Re: the lease - Outlook' }),
      tab(73, 3, 'file:///C:/Users/someone/Documents/payslip.pdf', { title: 'payslip.pdf' }),
      tab(74, 4, 'data:text/html,<h1>a private note</h1>', { title: 'a private note' }),
      tab(75, 5, 'about:blank', { title: 'Statement - Bank' }),
    ];
    for (const t of liveTabs) chromeMock.tabs.onCreated.fire({ ...t });
    await settle();
    const rec = (id: number) => openOn(id)[0]!;
    expect(rec(70)).toMatchObject({ url: 'https://www.linkedin.com/messaging', title: '' });
    expect(rec(71)).toMatchObject({ url: 'https://uk.search.yahoo.com/', title: '' });
    expect(rec(72)).toMatchObject({ url: 'https://outlook.office.com/', title: '' });
    expect([rec(73), rec(74), rec(75)].map((t) => [t.url, t.title])).toEqual([['file:', ''], ['data:', ''], ['about:', '']]);
  });

  it('keeps no more of a page than the content script would send, whatever the page manages to send', async () => {
    h.store.set('big', trace({ traceId: 'big', tabId: 80, url: 'https://docs.example/a', title: 'Docs' }));
    liveTabs = [tab(80, 0, 'https://docs.example/a')];
    const digest = { description: 'd'.repeat(5_000), headings: Array.from({ length: 50 }, () => 'h'.repeat(500)), leadText: 'l'.repeat(50_000) };
    chromeMock.runtime.onMessage.fire({ type: 'digest', url: 'https://docs.example/a', title: 't'.repeat(1_000_000), digest, reason: 'complete' }, { tab: { id: 80 }, frameId: 0, documentLifecycle: 'active' }, vi.fn());
    await settle();
    const t = h.store.get('big')!;
    expect([t.title.length, t.digest!.description.length, t.digest!.headings.length, t.digest!.headings[0]!.length, t.digest!.leadText.length]).toEqual([500, 500, 20, 120, 1000]);
  });

  it('a search tab restored after a restart finds its record, though the record keeps no search words', async () => {
    h.store.set('s', trace({ traceId: 's', tabId: 99, url: 'https://www.google.com/search', host: 'google.com', eTLD1: 'google.com', pathTokens: ['search'] }));
    liveTabs = [tab(40, 0, 'https://www.google.com/search?q=lisbon+trams')];
    chromeMock.tabs.onCreated.fire({ ...liveTabs[0]! });
    await settle();
    expect(openOn(40).map((t) => t.traceId)).toEqual(['s']);
    expect(h.store.get('s')!.url).toBe('https://www.google.com/search');
  });

  it('a tab opened from another tab is new, even at the url of a record waiting to be closed', async () => {
    h.store.set('op', trace({ traceId: 'op', tabId: 1, url: 'https://a.example/1' }));
    h.store.set('waiting', trace({ traceId: 'waiting', tabId: 77, windowId: 2, url: 'https://a.example/2' }));
    liveTabs = [tab(1, 0, 'https://a.example/1'), tab(2, 1, 'https://a.example/2', { openerTabId: 1 })];
    chromeMock.tabs.onCreated.fire({ ...liveTabs[1]! });
    await settle();
    const t = h.open().find((x) => x.tabId === 2)!;
    expect(t.traceId).not.toBe('waiting');
    expect(t.openerTraceId).toBe('op');
  });

  it("keeps a stored title through Chrome's empty and placeholder titles while a page loads", async () => {
    // Bring back: the record is reopened, then Chrome creates the tab with title "".
    h.store.set('back', trace({ traceId: 'back', tabId: 50, url: B, title: 'Thread 42 - Mail' }));
    liveTabs = [tab(51, 0, B, { title: '' })];
    chromeMock.tabs.onCreated.fire({ ...liveTabs[0]! });
    await settle();
    expect(h.store.get('back')).toMatchObject({ tabId: 51, title: 'Thread 42 - Mail' });
    chromeMock.tabs.onUpdated.fire(51, { status: 'loading' }, { ...liveTabs[0]!, title: 'mail.example.com/thread/42' });
    await settle();
    expect(h.store.get('back')!.title).toBe('Thread 42 - Mail');
    chromeMock.tabs.onUpdated.fire(51, { title: 'Thread 42 (2) - Mail' }, { ...liveTabs[0]!, title: 'Thread 42 (2) - Mail' });
    await settle();
    expect(h.store.get('back')!.title).toBe('Thread 42 (2) - Mail');
  });

  it("a card opened again after a restart gets its own records back, even where an old tab id is now another tab's", async () => {
    // Tab 7 was the put-away page before the restart; after it, 7 is a different, live page.
    h.store.set('away', trace({ traceId: 'away', tabId: 7, url: B, title: 'Thread 42 - Mail', closedAt: NOW - DAY }));
    h.store.set('mine', trace({ traceId: 'mine', tabId: 7, url: A, openedAt: NOW - 60_000 }));
    liveTabs = [tab(7, 0, A)];
    tabsCreateFrom(50);
    const { openCard } = await import('../archive/sweep');
    await openCard(mailCard(B));
    await settle();
    expect(h.store.get('away')).toMatchObject({ tabId: 50, closedAt: null, title: 'Thread 42 - Mail' });
    expect(openOn(7).map((t) => t.traceId)).toEqual(['mine']); // was ['mine', 'away']: Archive & close on 'away' closed tab 7
    expect(h.open().filter((t) => t.url === B).map((t) => t.traceId)).toEqual(['away']);
  });

  it('a record whose tab went on to another page before it closed stays closed; its tab gets a record of its own', async () => {
    // Brought back once, the tab followed a redirect to thread 43, then was closed there.
    h.store.set('away', trace({ traceId: 'away', tabId: 9, url: 'https://mail.example.com/thread/43', closedAt: NOW - DAY }));
    liveTabs = [];
    tabsCreateFrom(60);
    const { openCard } = await import('../archive/sweep');
    await openCard(mailCard(B));
    await settle();
    expect(h.store.get('away')!.closedAt).not.toBeNull();
    expect(h.open().filter((t) => t.tabId === -1)).toEqual([]); // was ['away']: listed in a group, on no tab
    expect(openOn(60).map((t) => t.url)).toEqual([B]);
  });

  it('"ta" offers the put-away pages a search finds, best first, five at most, every title as text', async () => {
    expect(chromeMock.omnibox.setDefaultSuggestion).toHaveBeenCalledWith({ description: 'Find something you put away: %s' });
    h.cards.push(
      awayCard('lisbon', 'Lisbon', [
        { url: 'https://visitlisboa.example/trams', title: 'Trams & funiculars <28E>', host: 'visitlisboa.example' },
        { url: 'https://visitlisboa.example/fado', title: 'Fado houses', host: 'visitlisboa.example' },
        { url: 'https://visitlisboa.example/tram-28', title: '', host: 'visitlisboa.example' },
      ]),
      awayCard('ci', 'Deploy fix', [{ url: 'https://ci.example/job/42', title: 'Build 42\u0007"tram" test\'s log', host: 'ci.example' }], { archivedAt: NOW - 2 * DAY }),
    );
    const suggest = vi.fn();
    chromeMock.omnibox.onInputChanged.fire('tram', suggest);
    await settle();
    expect(suggest).toHaveBeenCalledWith([
      { content: 'https://visitlisboa.example/trams', description: 'Trams &amp; funiculars &lt;28E&gt; <dim>· Lisbon</dim>' },
      { content: 'https://visitlisboa.example/tram-28', description: '<url>https://visitlisboa.example/tram-28</url> <dim>· Lisbon</dim>' },
      { content: 'https://ci.example/job/42', description: 'Build 42 &quot;tram&quot; test&apos;s log <dim>· Deploy fix</dim>' },
    ]);
    // A word of a card's own name finds the whole card: its pages in order, five of them.
    h.cards.push(awayCard('bread', 'Sourdough', [0, 1, 2, 3, 4, 5, 6].map((i) => ({ url: `https://bread.example/${i}`, title: `Step ${i}`, host: 'bread.example' }))));
    const more = vi.fn();
    chromeMock.omnibox.onInputChanged.fire('sourdough', more);
    await settle();
    expect(more.mock.calls[0]![0].map((s: { content: string }) => s.content)).toEqual([0, 1, 2, 3, 4].map((i) => `https://bread.example/${i}`));
  });

  it('"ta" never offers or opens a page on a site never remembered, even one a card still holds', async () => {
    h.never.push('bank.example');
    h.cards.push(
      awayCard('money', 'Money', [
        { url: 'https://www.bank.example/statements', title: 'Statements', host: 'www.bank.example' },
        { url: 'https://budget.example/statements', title: 'Statements to check', host: 'budget.example' },
      ]),
    );
    const suggest = vi.fn();
    chromeMock.omnibox.onInputChanged.fire('statements', suggest);
    await settle();
    expect(suggest.mock.calls[0]![0].map((s: { content: string }) => s.content)).toEqual(['https://budget.example/statements']);
    chromeMock.omnibox.onInputEntered.fire('https://www.bank.example/statements', 'currentTab');
    await settle();
    expect(chromeMock.tabs.update).toHaveBeenCalledWith({ url: `${SWEEP}?find=${encodeURIComponent('https://www.bank.example/statements')}` });
  });

  it('Enter on a put-away page opens it where Chrome asks: in this tab, or a new one in front or behind', async () => {
    const url = 'https://visitlisboa.example/trams';
    h.cards.push(awayCard('lisbon', 'Lisbon', [{ url, title: 'Trams', host: 'visitlisboa.example' }]));
    chromeMock.omnibox.onInputEntered.fire(url, 'currentTab');
    await settle();
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith({ url });
    chromeMock.omnibox.onInputEntered.fire(url, 'newForegroundTab');
    await settle();
    expect(chromeMock.tabs.create).toHaveBeenLastCalledWith({ url, active: true });
    chromeMock.omnibox.onInputEntered.fire(url, 'newBackgroundTab');
    await settle();
    expect(chromeMock.tabs.create).toHaveBeenLastCalledWith({ url, active: false });
    expect(chromeMock.tabs.update).toHaveBeenCalledTimes(1);
  });

  it('Enter on words, or on any address that is not a put-away web page, opens the sweep page searching for it', async () => {
    h.cards.push(
      awayCard('lisbon', 'Lisbon', [
        { url: 'https://visitlisboa.example/trams', title: 'Trams', host: 'visitlisboa.example' },
        { url: 'javascript:alert(1)', title: 'Trams', host: '' }, // no card holds one; the guard is still there
      ]),
    );
    chromeMock.omnibox.onInputEntered.fire(' lisbon trams ', 'currentTab');
    await settle();
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith({ url: `${SWEEP}?find=lisbon%20trams` });
    for (const typed of ['https://elsewhere.example/', 'javascript:alert(1)', 'file:///C:/notes.txt']) {
      chromeMock.omnibox.onInputEntered.fire(typed, 'newForegroundTab');
      await settle();
      expect(chromeMock.tabs.create).toHaveBeenLastCalledWith({ url: `${SWEEP}?find=${encodeURIComponent(typed)}`, active: true });
    }
    chromeMock.omnibox.onInputEntered.fire('', 'currentTab'); // nothing typed: the page as the icon opens it
    await settle();
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith({ url: SWEEP });
  });

  it('a first install opens the sweep page once, in front; nothing is recorded until Start, then the open tabs are adopted', async () => {
    h.meta.delete('startedAt');
    liveTabs = [tab(5, 0, 'https://a.example/1', { title: 'One' })];
    chromeMock.tabs.sendMessage.mockClear();
    const sweepOpened = () => chromeMock.tabs.create.mock.calls.filter(([p]) => p.url === SWEEP);
    chromeMock.runtime.onInstalled.fire({ reason: 'install' });
    chromeMock.tabs.onActivated.fire({ tabId: 5, windowId: 1 });
    await settle(400);
    expect(sweepOpened()).toEqual([[{ url: SWEEP, active: true }]]);
    expect(h.store.size).toBe(0); // asked first: the page shows the Start notice, nothing is kept yet
    const answer = vi.fn();
    chromeMock.runtime.onMessage.fire({ type: 'start' }, { url: SWEEP }, answer);
    await settle(400);
    expect(answer).toHaveBeenCalledWith({ ok: true });
    expect(h.meta.get('startedAt')).toEqual(expect.any(Number));
    expect(openOn(5)).toHaveLength(1); // the tabs already open, adopted at once
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(5, { type: 'capture' }); // and asked for their page text again
    chromeMock.runtime.onInstalled.fire({ reason: 'update' }); // an update, or a Reload
    chromeMock.runtime.onInstalled.fire({ reason: 'chrome_update' });
    chromeMock.runtime.onInstalled.fire({ reason: 'install' }); // what Chrome says at every start of a --load-extension build
    await settle(400);
    expect(sweepOpened()).toHaveLength(1);
  });

  it('someone already using Tab Amnesty is never asked: records in the database count as a yes', async () => {
    h.meta.delete('startedAt');
    h.store.set('old', trace({ traceId: 'old', tabId: 40, url: A }));
    liveTabs = [tab(40, 0, A), tab(41, 1, B)];
    chromeMock.runtime.onInstalled.fire({ reason: 'update' });
    await settle(400);
    expect(h.meta.get('startedAt')).toEqual(expect.any(Number));
    expect(openOn(41)).toHaveLength(1);
  });

  it("how a new tab was reached comes with its first page; later pages, frames, prerenders and adopted tabs don't change it", async () => {
    const commit = (tabId: number, url: string, transitionType: string, o: object = {}) =>
      chromeMock.webNavigation.onCommitted.fire({ tabId, frameId: 0, url, transitionType, transitionQualifiers: [], timeStamp: NOW, ...o });
    liveTabs = [tab(50, 0, A), tab(51, 1, B)];
    chromeMock.tabs.onCreated.fire({ ...liveTabs[0] });
    chromeMock.tabs.onCreated.fire({ ...liveTabs[1] });
    await settle();
    expect(openOn(50)[0]!.transition).toBe('unknown');
    commit(50, A, 'typed');
    commit(51, B, 'link', { frameId: 3 }); // a frame inside the page
    commit(51, B, 'link', { documentLifecycle: 'prerender' }); // a page prerendering for the tab
    await settle();
    commit(50, B, 'link'); // the tab went on to another page
    await settle();
    expect(openOn(50)[0]!.transition).toBe('typed');
    expect(openOn(51)[0]!.transition).toBe('unknown');
    h.store.set('adopted', trace({ traceId: 'adopted', tabId: 52, url: A, backfilled: true, transition: 'unknown' }));
    commit(52, A, 'start_page');
    commit(51, B, 'start_page');
    await settle();
    expect(h.store.get('adopted')!.transition).toBe('unknown'); // when and how it opened is not known
    expect(openOn(51)[0]!.transition).toBe('auto_toplevel'); // webNavigation's name for history's
  });
});
