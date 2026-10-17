/**
 * Integration check for the collector. Launches Chrome for Testing with the built extension,
 * opens tabs the way a person does (typed navigation, real link clicks), bounces between them,
 * then reads the traces back out of the extension's IndexedDB and prints them. Finally it
 * restarts Chrome with session restore to show the (url, windowId) re-bind across a restart.
 *
 * It SHOWS what was recorded rather than asserting it — the point is to see openerTraceId and
 * transition land for new tabs. Exit code is non-zero only if the run itself fails.
 *
 *   npm run check          (builds .check-build/ itself; never dist/, the owner's live install)
 *
 * Branded Google Chrome ignores --load-extension since 137, so this needs Chrome for Testing:
 *   npx @puppeteer/browsers install chrome@stable      (lands in ./chrome/, git-ignored)
 * CHROME_PATH is a fallback for any other Chromium build.
 */
import { existsSync, globSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { readCopy } from '../src/archive/copy';
import type { ArchiveCard } from '../src/archive/types';
import type { TabTrace } from '../src/cluster/types';

/** Never dist/: that is the folder the owner's own Chrome loads (DECISIONS 2026-10-05). */
const DIST = resolve('.check-build');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CHROME_PATH (any Chromium browser: Edge, Brave, ...) wins over the local Chrome for Testing. */
function findChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = [...globSync('chrome/*/chrome-*/chrome.exe'), ...globSync('chrome/*/chrome-*/chrome')]
    .sort()
    .at(-1);
  if (local) return resolve(local);
  throw new Error('Chrome for Testing not found. Run: npx @puppeteer/browsers install chrome@stable');
}

/** Tiny local site so the check is hermetic — no network, and history still records the visits. */
function page(title: string, links: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="description" content="Test page: ${title}"></head>
<body><nav><a href="/">home</a></nav><main><h1>${title}</h1><h2>Section one of ${title}</h2>
<p>This paragraph is long enough to count as lead text for the digest of the page titled ${title}.</p>
<p><label>Notes <input id="note" type="text"></label></p>
<p>${links.map((l) => `<a href="${l}">${l}</a>`).join(' ')}</p></main></body></html>`;
}

async function startSite(): Promise<{ origin: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    const title = path === '/' ? 'Deploy runbook' : path.slice(1).split('?')[0]!.replace(/[-/]/g, ' ');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page(title, ['/pricing/plans', '/pricing/faq', '/incidents/2026-09']));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

async function launch(exe: string, userDataDir: string, extraArgs: string[] = []): Promise<Browser> {
  return puppeteer.launch({
    executablePath: exe,
    headless: false,
    userDataDir,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1000,700',
      // Branded Chromium builds ignore --load-extension since 137 unless this is switched back off.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      ...extraArgs,
    ],
    defaultViewport: null,
  });
}

async function extensionId(browser: Browser): Promise<string> {
  const target = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: 15_000 },
  );
  return new URL(target.url()).host;
}

/** Click a real link with the mouse so Chrome sets openerTabId and records a 'link' visit. */
async function clickLinkToNewTab(page: Page, href: string): Promise<void> {
  await page.evaluate((h) => {
    const a = document.createElement('a');
    a.href = h;
    a.target = '_blank';
    a.rel = 'opener';
    a.textContent = 'open';
    a.style.cssText = 'position:fixed;top:0;left:0;font-size:40px;z-index:99999;background:#fff';
    a.id = '__ta_link';
    document.body.append(a);
  }, href);
  await page.click('#__ta_link');
}

async function readTraces(browser: Browser, extId: string): Promise<TabTrace[]> {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/ui/dev/index.html`);
  await page.waitForFunction(() => typeof (window as any).__tabAmnestyTraces === 'function');
  const traces = (await page.evaluate(() => (window as any).__tabAmnestyTraces())) as TabTrace[];
  await page.close();
  return traces;
}

function show(traces: TabTrace[]): void {
  const byId = new Map(traces.map((t) => [t.traceId, t]));
  const rows = traces
    .filter((t) => t.closedAt === null)
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((t) => ({
      url: t.url.slice(0, 40),
      transition: t.transition,
      opener: t.openerTraceId ? (byId.get(t.openerTraceId)?.url ?? '?').slice(0, 30) : '',
      source: t.backfilled ? 'backfill' : 'event',
      tabId: t.tabId,
      act: t.activationCount,
      dwellMs: t.dwellMs,
      coActive: Object.keys(t.coActive).length,
      digest: t.digest ? `${t.digest.headings.length}h/${t.digest.leadText.length}c` : '',
      idx: t.index,
      trace: t.traceId.slice(0, 8),
    }));
  console.table(rows);
}

const isHttp = (t: TabTrace) => /^https?:/.test(t.url);

function summarise(traces: TabTrace[]): string {
  const evented = traces.filter((t) => !t.backfilled && t.closedAt === null && isHttp(t));
  const withOpener = evented.filter((t) => t.openerTraceId);
  const withTransition = evented.filter((t) => t.transition !== 'unknown');
  return (
    `event-time http(s) tabs: ${evented.length} · with openerTraceId: ${withOpener.length} · ` +
    `with transition: ${withTransition.length} (${withTransition.map((t) => t.transition).join(', ')})`
  );
}

const FORBIDDEN = /\b(delete|clean ?up|declutter|tidy|messy)\b/i;
const COUNT_AS_PROBLEM = /\b\d+\s+tabs?\b/i;

async function checkXray(browser: Browser, extId: string, userDataDir: string): Promise<void> {
  const page = await browser.newPage();
  const downloads = join(userDataDir, 'downloads');
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await page.goto(`chrome-extension://${extId}/src/ui/xray/index.html`);
  await page.waitForSelector('#groups');
  await sleep(1500);
  const shot = join(userDataDir, 'xray.png');
  await page.screenshot({ path: shot, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText);
  const headings = await page.$$eval('.group h2', (hs) => hs.map((h) => h.textContent));
  console.log(`\nx-ray page: ${headings.length} group heading(s): ${JSON.stringify(headings)}  screenshot: ${shot}`);
  console.log(`  forbidden words on page: ${FORBIDDEN.test(text) ? 'YES — ' + text.match(FORBIDDEN)![0] : 'none'}`);
  console.log(`  tab count shown as a number: ${COUNT_AS_PROBLEM.test(text) ? 'YES — ' + text.match(COUNT_AS_PROBLEM)![0] : 'none'}`);

  await page.click('#study summary');
  await page.type('#name', 'check');
  await page.click('#export');
  await sleep(1500);
  const files = existsSync(downloads) ? readdirSync(downloads).filter((f) => f.endsWith('.json')) : [];
  if (files.length) {
    const fx = JSON.parse(readFileSync(join(downloads, files[0]!), 'utf8'));
    const t = fx.traces.find((x: TabTrace) => x.url.includes('faq'));
    console.log(`  export: ${files[0]} schemaVersion=${fx.schemaVersion} mode=${fx.mode} traces=${fx.traceCount}`);
    console.log(`  shareable redaction on the ?plan=team tab: url=${t?.url} queryKeys=${JSON.stringify(t?.queryKeys)} leadText=${JSON.stringify(t?.digest?.leadText)}`);
  } else {
    console.log('  export: no file downloaded');
  }
  await page.close();
}


async function readCards(browser: Browser, extId: string): Promise<ArchiveCard[]> {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/ui/dev/index.html`);
  await page.waitForFunction(() => typeof (window as any).__tabAmnestyCards === 'function');
  const cards = (await page.evaluate(() => (window as any).__tabAmnestyCards())) as ArchiveCard[];
  await page.close();
  return cards;
}

const httpTabs = async (browser: Browser) => (await browser.pages()).map((p) => p.url()).filter((u) => /^https?:/.test(u));

/** Phase 1: the sweep page obeys §6, and Archive & close writes the card BEFORE the tabs go. */
async function checkSweepArchive(browser: Browser, extId: string, userDataDir: string): Promise<ArchiveCard | undefined> {
  const openBefore = await httpTabs(browser);
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/ui/sweep/index.html`);
  await page.waitForSelector('#groups');
  await sleep(2000); // naming (heuristic here; Nano is not on Chrome for Testing)
  const shot = join(userDataDir, 'sweep.png');
  await page.screenshot({ path: shot, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText);
  const names = await page.$$eval('#groups .group h2', (hs) => hs.map((h) => h.textContent));
  const buttons = await page.$$eval('#groups button.primary', (bs) => bs.length);
  console.log(`\nsweep page: ${names.length} group(s) ${JSON.stringify(names)}, ${buttons} primary action(s) visible (must be <= 5)  screenshot: ${shot}`);
  console.log(`  forbidden words on page: ${FORBIDDEN.test(text) ? 'YES — ' + text.match(FORBIDDEN)![0] : 'none'}`);
  console.log(`  tab count shown as a number: ${COUNT_AS_PROBLEM.test(text) ? 'YES — ' + text.match(COUNT_AS_PROBLEM)![0] : 'none'}`);
  console.log(`  input fields for naming: ${await page.$$eval('#groups input', (i) => i.length)} (must be 0)`);
  if (names.length === 0) {
    console.log('  no group to archive; skipping the archive/undo check');
    await page.close();
    return undefined;
  }
  console.log(`  "recorder not keeping up" note shown: ${await page.$eval('#health', (e) => !(e as HTMLElement).hidden)} (must be false)`);
  console.log(`  "still running the older version" note shown: ${await page.$eval('#stale', (e) => !(e as HTMLElement).hidden)} (must be false: one build)`);

  // The person's own group must survive "show on strip", and Undo must remove only ours.
  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/src/ui/dev/index.html`);
  const httpIds = (await ctl.evaluate(() =>
    chrome.tabs.query({}).then((ts) => ts.filter((t) => /^https?:/.test(t.url ?? '')).map((t) => t.id!)),
  )) as number[];
  const mine = (await ctl.evaluate(async (id) => {
    const g = await chrome.tabs.group({ tabIds: [id] });
    await chrome.tabGroups.update(g, { title: 'mine' });
    return g;
  }, httpIds[0]!)) as number;
  await page.bringToFront();
  await page.click('#strip');
  await sleep(1500);
  console.log(`  show on strip: ${await page.$eval('#strip-status', (e) => e.textContent)}`);
  const mineAfterStrip = (await ctl.evaluate((g) => chrome.tabs.query({ groupId: g }).then((ts) => ts.length), mine)) as number;
  await page.click('#strip-status button');
  await sleep(1000);
  const titlesAfterUndo = (await ctl.evaluate(() => chrome.tabGroups.query({}).then((gs) => gs.map((g) => g.title ?? '')))) as string[];
  console.log(`  own group kept its tab through "show on strip": ${mineAfterStrip === 1} | groups after Undo: ${JSON.stringify(titlesAfterUndo)} (must be ["mine"])`);
  await ctl.evaluate(async (g) => {
    const ids = (await chrome.tabs.query({ groupId: g })).map((t) => t.id!);
    if (ids.length) await chrome.tabs.ungroup(ids);
  }, mine);
  await ctl.close();

  // A tab holding unsent typing stays open through Archive & close.
  const typed = (await browser.pages()).find((p) => p.url().includes('/pricing/plans'));
  if (typed) {
    await typed.bringToFront();
    await typed.type('#note', 'half-written thought');
    await sleep(1200);
  }
  await page.bringToFront();
  await page.click('#groups button.primary');
  await sleep(2500);
  console.log(`  message after Archive & close: ${await page.$eval('.toast', (e) => e.textContent).catch(() => '(none)')}`);
  const cards = await readCards(browser, extId);
  const card = cards[0];
  const openAfter = await httpTabs(browser);
  console.log(
    `  Archive & close: card "${card?.name}" with ${card?.tabs.length} tab line(s) ` +
      `[${card?.tabs.map((t) => t.url.replace(/^https?:\/\/[^/]+/, '')).join(', ')}]; ` +
      `open http tabs ${openBefore.length} -> ${openAfter.length}; undo until ${card ? new Date(card.undoUntil).toISOString() : '-'}`,
  );
  await page.close();
  return card;
}

/** Phase 1: after a restart, Bring back recreates every tab of the card in order (§6.8). */
async function checkBringBack(browser: Browser, extId: string, card: ArchiveCard): Promise<void> {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/ui/sweep/index.html`);
  await page.waitForSelector('#cards .group', { timeout: 10_000 });
  const before = await httpTabs(browser);
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#cards .group button')].find((x) => x.textContent === 'Bring back') as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  });
  await sleep(3000);
  const after = await httpTabs(browser);
  const restored = after.filter((u) => !before.includes(u));
  const expected = [...card.tabs].sort((a, b) => a.order - b.order).map((t) => t.url);
  const inOrder = JSON.stringify(restored) === JSON.stringify(expected);
  const cards = await readCards(browser, extId);
  const live = (await readTraces(browser, extId)).filter((t) => t.closedAt === null);
  const sameIdentity = card.tabs.filter((t) => live.some((l) => l.traceId === t.traceId && l.url === t.url)).length;
  console.log(
    `\nbring back after restart: button ${clicked ? 'found' : 'MISSING'}; ${restored.length} of ${expected.length} tabs came back ` +
      `(${sameIdentity} on their original trace), ` +
      `order ${inOrder ? 'matches' : 'DIFFERS: ' + JSON.stringify(restored)}; card kept: ${cards.some((c) => c.cardId === card.cardId)}, ` +
      `restoredAt set: ${!!cards.find((c) => c.cardId === card.cardId)?.restoredAt}`,
  );
  await page.close();
}

/** A word of one put-away tab's title that is not in the card's name, so a search finds that tab, not the card. */
function wordOfOneTab(card: ArchiveCard): string {
  const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
  const inName = new Set(words(card.name));
  for (const t of [...card.tabs].reverse()) {
    const w = words(t.title).find((x) => !inName.has(x) && card.tabs.filter((u) => words(u.title).includes(x)).length === 1);
    if (w) return w;
  }
  return words(card.tabs[0]?.title ?? '')[0] ?? 'deploy';
}

/**
 * Phase 2: a search finds a put-away tab by a word of its title, and Open all brings the whole
 * card back, in order, on its own records — here after its old tab ids were handed to a live
 * tab, as a restart can do (§5.3).
 */
async function checkFindAndOpenAll(browser: Browser, extId: string, card: ArchiveCard): Promise<void> {
  const ids = card.tabs.map((t) => t.traceId);
  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/src/ui/dev/index.html`);
  await ctl.waitForFunction(() => typeof (window as any).__tabAmnestyTraces === 'function');
  // Put the card away again: close what Bring back reopened.
  await ctl.evaluate(async (ids: string[]) => {
    const traces = await (window as any).__tabAmnestyTraces();
    const tabIds = traces.filter((t: TabTrace) => t.closedAt === null && ids.includes(t.traceId)).map((t: TabTrace) => t.tabId);
    if (tabIds.length) await chrome.tabs.remove(tabIds);
  }, ids);
  await sleep(1500);

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/ui/sweep/index.html`);
  await page.waitForSelector('#cards .group', { timeout: 10_000 });
  // A restart hands tab ids out again: give the card's records this page's own id.
  await page.evaluate(
    (ids: string[]) =>
      new Promise<void>(async (resolve, reject) => {
        const me = (await chrome.tabs.getCurrent())!.id!;
        const r = indexedDB.open('tab-amnesty');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction('traces', 'readwrite');
          const store = tx.objectStore('traces');
          for (const id of ids) {
            const g = store.get(id);
            g.onsuccess = () => void (g.result && store.put({ ...g.result, tabId: me }));
          }
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    ids,
  );

  const word = wordOfOneTab(card);
  await page.type('#find', word);
  await sleep(600);
  const found = await page.$$eval('#cards .group', (gs) =>
    gs.map((g) => ({
      name: g.querySelector('h2')?.textContent,
      list: `${g.querySelector('details summary')?.textContent}${(g.querySelector('details') as HTMLDetailsElement | null)?.open ? ' (open)' : ''}`,
      lines: [...g.querySelectorAll('li .t')].map((x) => x.textContent),
      action: g.querySelector('header button')?.textContent,
    })),
  );
  const text = await page.evaluate(() => document.body.innerText);

  const liveTabs = () =>
    ctl.evaluate(() => chrome.tabs.query({}).then((ts) => ts.map((t) => ({ id: t.id!, url: t.url || t.pendingUrl || '', index: t.index })))) as Promise<
      { id: number; url: string; index: number }[]
    >;
  const clicked = await page.evaluate((name) => {
    const g = [...document.querySelectorAll('#cards .group')].find((x) => x.querySelector('h2')?.textContent === name);
    const b = [...(g?.querySelectorAll('header button') ?? [])].find((x) => x.textContent === 'Open all') as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  }, card.name);
  await sleep(3000);
  const message = await page.$eval('.toast', (e) => e.textContent).catch(() => '(none)');
  const live = await liveTabs();
  const open = (await readTraces(browser, extId)).filter((t) => t.closedAt === null);
  const back = ids.map((id) => open.find((t) => t.traceId === id)).filter((t): t is TabTrace => !!t);
  const onOwnTab = back.filter((t) => live.some((l) => l.id === t.tabId && l.url === t.url));
  const order = [...onOwnTab].sort((a, b) => live.find((l) => l.id === a.tabId)!.index - live.find((l) => l.id === b.tabId)!.index).map((t) => t.url);
  const expected = [...card.tabs].sort((a, b) => a.order - b.order).map((t) => t.url);
  const strays = open.filter((t) => live.some((l) => l.id === t.tabId && l.url !== t.url));

  await page.click('#find', { clickCount: 3 });
  await page.type('#find', 'zqxjv');
  await sleep(600);
  const none = await page.$eval('#cards', (e) => e.textContent);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('/');
  const slash = await page.evaluate(() => document.activeElement?.id);

  console.log(`
find and open all: "${word}" found ${JSON.stringify(found)}`);
  console.log(`  forbidden words on page: ${FORBIDDEN.test(text) ? 'YES — ' + text.match(FORBIDDEN)![0] : 'none'} | tab count shown as a number: ${COUNT_AS_PROBLEM.test(text) ? 'YES — ' + text.match(COUNT_AS_PROBLEM)![0] : 'none'}`);
  console.log(
    `  Open all: button ${clicked ? 'found' : 'MISSING'}; ${onOwnTab.length} of ${expected.length} tabs back on their own records, ` +
      `order ${JSON.stringify(order) === JSON.stringify(expected) ? 'matches' : 'DIFFERS: ' + JSON.stringify(order)}; ` +
      `records on a live tab that is not theirs: ${strays.length} (must be 0)${strays.length ? ' ' + JSON.stringify(strays.map((t) => t.url)) : ''}`,
  );
  console.log(`  message: ${message}`);
  console.log(`  a search that finds nothing says: ${JSON.stringify(none)} | "/" moves to the search box: ${slash === 'find'}`);
  await page.close();
  await ctl.close();
}

/**
 * Phase 2: Keep a copy saves a page anyone can read with the records inside; after Forget, Bring in
 * a copy puts the card back (as Open all, not an undo); the same file again adds nothing, and a
 * file that is not a copy is refused.
 */
async function checkKeepACopy(browser: Browser, extId: string, card: ArchiveCard, userDataDir: string): Promise<void> {
  const page = await browser.newPage();
  const downloads = join(userDataDir, 'copy-downloads');
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await page.goto(`chrome-extension://${extId}/src/ui/sweep/index.html`);
  await page.waitForSelector('#cards .group', { timeout: 10_000 });
  await page.click('#keep summary');
  await page.click('#copy-save');
  let file = '';
  for (let i = 0; i < 20 && !file; i++) {
    await sleep(500);
    const done = existsSync(downloads) ? readdirSync(downloads).filter((f) => f.endsWith('.html')) : [];
    file = done[0] ? join(downloads, done[0]) : '';
  }
  if (!file) {
    console.log('\nkeep a copy: no file downloaded');
    await page.close();
    return;
  }
  const html = readFileSync(file, 'utf8');
  const copy = readCopy(html);
  const saved = copy && copy !== 'newer' ? copy.cards.find((c) => c.cardId === card.cardId) : undefined;
  const scripts = (html.match(/<script\b/g) ?? []).length;
  const csp = html.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`);

  // Forget the card, then bring the copy in.
  await page.evaluate((id) => {
    const g = document.querySelector(`#cards [data-card="${id}"]`);
    ([...(g?.querySelectorAll('header button') ?? [])].find((b) => b.textContent === 'Forget this') as HTMLButtonElement | undefined)?.click();
  }, card.cardId);
  await sleep(1500);
  const afterForget = (await readCards(browser, extId)).some((c) => c.cardId === card.cardId);
  const input = await page.$('input#copy-file');
  const bringIn = async (path: string) => {
    await input!.uploadFile(path);
    await sleep(1500);
    return page.$eval('#copy-status', (e) => e.textContent);
  };
  const first = await bringIn(file);
  const back = (await readCards(browser, extId)).find((c) => c.cardId === card.cardId);
  const shown = await page.$$eval('#cards .group', (gs) => gs.map((g) => [g.querySelector('h2')?.textContent, g.querySelector('header button')?.textContent]));
  const again = await bringIn(file);
  const notACopy = join(userDataDir, 'not-a-copy.html');
  writeFileSync(notACopy, '<!doctype html><title>Something else</title><p>hello</p>');
  const refused = await bringIn(notACopy);

  console.log(
    `\nkeep a copy: saved ${file.split(/[\\/]/).pop()} (${Math.round(html.length / 1024)} KB): card "${saved?.name}" with ${saved?.tabs.length} tab line(s) inside; ` +
      `scripts in the file: ${scripts} (must be 1, the records); no-script policy: ${csp}`,
  );
  console.log(
    `  forget, then bring in: card gone after Forget: ${!afterForget}; back after Bring in: ${!!back} ` +
      `(${back?.tabs.length} tab line(s), same as saved: ${JSON.stringify(back?.tabs.map((t) => t.url)) === JSON.stringify(saved?.tabs.map((t) => t.url))}); ` +
      `undo offered: ${!!back && back.undoUntil > Date.now()} (must be false); list shows ${JSON.stringify(shown)}`,
  );
  console.log(`  messages: ${JSON.stringify(first)} | same file again: ${JSON.stringify(again)} | not a copy: ${JSON.stringify(refused)}`);
  await page.close();
}

/** Phase 1 study: the summary export carries times and counts only, and sees the archive. */
async function checkStudyExport(browser: Browser, extId: string, userDataDir: string): Promise<void> {
  const page = await browser.newPage();
  const downloads = join(userDataDir, 'study-downloads');
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await page.goto(`chrome-extension://${extId}/src/ui/xray/index.html`);
  await page.waitForSelector('#study');
  await page.click('#study summary');
  await page.click('#study-export');
  await sleep(1500);
  const file = existsSync(downloads) ? readdirSync(downloads).find((f) => f.endsWith('.study.json')) : undefined;
  if (!file) {
    console.log('\nstudy summary: no file downloaded');
  } else {
    const raw = readFileSync(join(downloads, file), 'utf8');
    const s = JSON.parse(raw);
    console.log(
      `\nstudy summary: ${file} kind=${s.kind} snapshots=${s.snapshots.length} (open counts ${JSON.stringify(s.snapshots.map((x: { open: number }) => x.open))}) ` +
        `archives=${s.archives.length} restored=${s.archives.filter((a: { restoredAt: number | null }) => a.restoredAt).length}; ` +
        `contains a URL or title: ${/https?:|Pricing|Deploy/.test(raw) ? 'YES' : 'no'}`,
    );
  }
  await page.close();
}

/**
 * Baseline capture takes only groups made after the study page opened (Organize tabs) and never
 * touches groups that were already there — the person's own, saved ones, or another tool's.
 */
async function checkBaselineCapture(browser: Browser, extId: string, userDataDir: string): Promise<void> {
  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/src/ui/dev/index.html`);
  const httpTabIds = async () =>
    (await ctl.evaluate(() => chrome.tabs.query({}).then((ts) => ts.filter((t) => /^https?:/.test(t.url ?? '')).map((t) => t.id!)))) as number[];
  const [mineTab, orgTab] = await httpTabIds();
  if (mineTab === undefined || orgTab === undefined) {
    console.log('\nbaseline capture: needs two http tabs; skipped');
    await ctl.close();
    return;
  }
  const mine = (await ctl.evaluate(async (id) => {
    const g = await chrome.tabs.group({ tabIds: [id] });
    await chrome.tabGroups.update(g, { title: 'mine' });
    return g;
  }, mineTab)) as number;

  const page = await browser.newPage();
  const downloads = join(userDataDir, 'baseline-downloads');
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await page.goto(`chrome-extension://${extId}/src/ui/xray/index.html`);
  await page.waitForSelector('#study');
  await sleep(800);
  await ctl.evaluate(async (id) => {
    const g = await chrome.tabs.group({ tabIds: [id] });
    await chrome.tabGroups.update(g, { title: 'organizer' });
  }, orgTab); // stands in for Chrome's Organize tabs, which Chrome for Testing does not have
  await page.click('#study summary');
  await page.type('#name', 'base');
  await page.click('#baseline');
  await sleep(1500);
  const status = await page.$eval('#status', (e) => e.textContent ?? '');
  const file = existsSync(downloads) ? readdirSync(downloads).find((f) => f.endsWith('.chrome.json')) : undefined;
  const base = file ? (JSON.parse(readFileSync(join(downloads, file), 'utf8')) as { groups: { name: string }[]; ungrouped: string[]; preexisting?: string[] }) : null;
  const captured = base ? base.groups.map((g) => g.name) : [];
  const after = (await ctl.evaluate(() => chrome.tabGroups.query({}).then((gs) => gs.map((g) => g.title ?? '')))) as string[];
  const mineTrace = (await readTraces(browser, extId)).find((t) => t.tabId === mineTab && t.closedAt === null)?.traceId;
  console.log(
    `\nbaseline capture: captured ${JSON.stringify(captured)} (must be ["organizer"]); groups left on the strip ${JSON.stringify(after)} ` +
      `(must still include "mine"); the tab in "mine" listed as the person's own: ${!!mineTrace && !!base?.preexisting?.includes(mineTrace)}, ` +
      `not as ungrouped: ${!!mineTrace && !base?.ungrouped.includes(mineTrace)} (both must be true); status: ${status}`,
  );
  await ctl.evaluate(async (g) => {
    const ids = (await chrome.tabs.query({ groupId: g })).map((t) => t.id!);
    if (ids.length) await chrome.tabs.ungroup(ids);
  }, mine);
  await page.close();
  await ctl.close();
}

/**
 * Chrome replaces a database it cannot open with an empty one — the owner's, 7 Oct 00:09
 * (DECISIONS 2026-10-07). Archived projects and the never-remember list must come back from the
 * second copy, and the open tabs must be adopted again at once, not at the next restart.
 */
async function checkDatabaseReplaced(browser: Browser, extId: string, origin: string): Promise<void> {
  const tab = await browser.newPage();
  await tab.goto(`${origin}/still-open`, { waitUntil: 'load' });
  const sweep = await browser.newPage();
  await sweep.goto(`chrome-extension://${extId}/src/ui/sweep/index.html`);
  await sweep.waitForSelector('#never-input');
  await sweep.click('#never summary');
  await sweep.type('#never-input', 'example.org');
  await sweep.click('#never-add');
  await sleep(500);
  await sweep.close();
  await sleep(1000);
  const cardsBefore = (await readCards(browser, extId)).length;
  const httpOpen = (await httpTabs(browser)).length;

  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/src/ui/dev/index.html`);
  const replaced = (await ctl.evaluate(
    () =>
      new Promise<string>((done) => {
        const req = indexedDB.deleteDatabase('tab-amnesty');
        const timer = setTimeout(() => done('BLOCKED for 5 s by an open connection'), 5000);
        req.onsuccess = () => {
          clearTimeout(timer);
          done('thrown away');
        };
        req.onerror = () => {
          clearTimeout(timer);
          done(`failed: ${req.error?.name}`);
        };
      }),
  )) as string;
  await ctl.close();
  await sleep(1500); // whichever context opens first restores; give it time before reading

  const cardsAfter = (await readCards(browser, extId)).length;
  await sleep(2000);
  const traces = await readTraces(browser, extId);
  const adopted = traces.filter((t) => t.closedAt === null && isHttp(t)).length;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/ui/sweep/index.html`);
  await page.waitForSelector('#never-list');
  await sleep(500);
  const never = await page.$$eval('#never-list li', (lis) => lis.map((li) => li.firstChild?.textContent ?? ''));
  const resets = (await page.evaluate(() =>
    caches
      .open('tab-amnesty-backup')
      .then((c) => c.match('https://tab-amnesty.invalid/resets'))
      .then((r) => (r ? r.json() : []))
      .then((x: unknown[]) => x.length),
  )) as number;
  const exposed = (await page.evaluate(() =>
    chrome.storage ? chrome.storage.local.get(null).then((all) => Object.keys(all).length) : 0,
  )) as number;
  await page.close();
  console.log(
    `
database replaced (${replaced}): archived cards back ${cardsAfter} of ${cardsBefore}; never-remember list back: ` +
      `${never.includes('example.org')}; open tabs adopted again at once: ${adopted} of ${httpOpen}; resets noted: ${resets} (must be 1); ` +
      `entries in chrome.storage.local, which content scripts can read: ${exposed} (must be 0)`,
  );
  await tab.close();
}

/**
 * A page from a newer build moves the database past this build's version while the worker is
 * running — what Chrome does when `dist/` is rebuilt without a Reload, and what stopped the owner's
 * recording from 20 Sep to 5 Oct (DECISIONS 2026-10-06). The worker must let the upgrade through
 * and keep recording into the newer database.
 */
async function checkNewerDatabase(browser: Browser, extId: string, origin: string): Promise<void> {
  const tab = await browser.newPage();
  await tab.goto(`${origin}/before-upgrade`, { waitUntil: 'load' });
  await sleep(500); // the worker has just written, so its connection is open
  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/src/ui/dev/index.html`);
  const upgrade = (await ctl.evaluate(
    () =>
      new Promise<string>((done) => {
        const req = indexedDB.open('tab-amnesty', 99);
        const timer = setTimeout(() => done('BLOCKED for 5 s by an open connection'), 5000);
        req.onsuccess = () => {
          clearTimeout(timer);
          const v = req.result.version;
          req.result.close();
          done(`went through (now v${v})`);
        };
        req.onerror = () => {
          clearTimeout(timer);
          done(`failed: ${req.error?.name}`);
        };
      }),
  )) as string;
  await ctl.close();
  const after = await browser.newPage();
  await after.goto(`${origin}/after-upgrade`, { waitUntil: 'load' });
  await sleep(1500);
  const traces = await readTraces(browser, extId).catch((e: Error) => {
    console.log(`  reading traces failed: ${e.message}`);
    return [] as TabTrace[];
  });
  const recorded = traces.some((t) => t.url.endsWith('/after-upgrade'));
  console.log(`
newer database: a newer page's upgrade ${upgrade}; a tab opened afterwards was recorded: ${recorded} (must be true)`);
  await after.close();
  await tab.close();
}

async function main(): Promise<void> {
  const site = await startSite();
  const userDataDir = mkdtempSync(join(tmpdir(), 'tab-amnesty-check-'));
  const exe = findChrome();
  console.log('chrome:', exe);

  let browser = await launch(exe, userDataDir);
  let firstRun: TabTrace[] = [];
  let card: ArchiveCard | undefined;
  try {
    const extId = await extensionId(browser);
    console.log(`extension loaded: ${extId}`);
    await sleep(1000); // let the worker finish evaluating and registering listeners

    // 1. A typed navigation (CDP Page.navigate records a 'typed' visit) — a deliberate new start.
    const a = await browser.newPage();
    await a.goto(`${site.origin}/`, { waitUntil: 'load' });
    await sleep(1500);

    // 2. Two real link clicks from that page — continuation, with lineage to `a`.
    const before = browser.targets().length;
    await clickLinkToNewTab(a, `${site.origin}/pricing/plans`);
    await browser.waitForTarget(() => browser.targets().length > before);
    await sleep(1000);
    await a.bringToFront();
    await clickLinkToNewTab(a, `${site.origin}/pricing/faq?plan=team&ref=email`);
    await sleep(2500);

    // 3. Bounce between the tabs so activation / dwell / co-activation accrue.
    const pages = (await browser.pages()).filter((p) => /^https?:/.test(p.url()));
    for (const p of pages) {
      await p.bringToFront();
      await sleep(600);
    }
    await a.bringToFront();
    await sleep(1500);

    // 4. Show what the collector recorded.
    firstRun = await readTraces(browser, extId);
    console.log('\nTraces recorded by the collector (open tabs only):');
    show(firstRun);
    console.log(summarise(firstRun));

    // 5. The x-ray page: renders, breaks no §6 rule, and exports a loadable fixture.
    await checkXray(browser, extId, userDataDir);
    await checkBaselineCapture(browser, extId, userDataDir);
  } finally {
    await browser.close();
  }

  // 6. Restart with session restore: tab ids are reassigned, traces must re-bind, not duplicate.
  console.log('\nRestarting Chrome with session restore to check the re-bind (§5.3)...');
  browser = await launch(exe, userDataDir, ['--restore-last-session']);
  try {
    const extId = await extensionId(browser);
    await sleep(3000);
    const second = await readTraces(browser, extId);
    console.log('\nTraces after restart (open tabs only):');
    show(second);

    const openHttp = (ts: TabTrace[]) => ts.filter((t) => t.closedAt === null && isHttp(t));
    const before = new Map(openHttp(firstRun).map((t) => [t.traceId, t]));
    const after = openHttp(second);
    const kept = after.filter((t) => before.has(t.traceId));
    const fresh = after.filter((t) => !before.has(t.traceId));
    const tabIdsChanged = kept.filter((t) => t.tabId !== before.get(t.traceId)!.tabId).length;
    console.log(
      `\nre-bind: ${kept.length} of ${before.size} open http(s) traces kept their traceId across the restart ` +
        `(${tabIdsChanged} of them on a new tabId), ${fresh.length} adopted fresh, ` +
        `${second.length} records total vs ${firstRun.length} before (nothing deleted)`,
    );

    // 7. Phase 1: sweep page, Archive & close on the first group.
    card = await checkSweepArchive(browser, extId, userDataDir);
  } finally {
    await browser.close();
  }

  // 8. Phase 1: restart again; Bring back must work from the stored card alone (§6.8).
  if (card) {
    console.log('\nRestarting Chrome again to check Bring back survives a restart (§6.8)...');
    browser = await launch(exe, userDataDir, ['--restore-last-session']);
    try {
      const extId = await extensionId(browser);
      await sleep(2500);
      await checkBringBack(browser, extId, card);
      await checkStudyExport(browser, extId, userDataDir);
      await checkFindAndOpenAll(browser, extId, card);
      await checkKeepACopy(browser, extId, card, userDataDir);
    } finally {
      await browser.close();
    }
  }

  // 9. Chrome replacing the database; then, last because it leaves the database at a version no
  //    build has, a newer build's upgrade.
  browser = await launch(exe, userDataDir);
  try {
    const extId = await extensionId(browser);
    await sleep(1500);
    await checkDatabaseReplaced(browser, extId, site.origin);
    await checkNewerDatabase(browser, extId, site.origin);
  } finally {
    await browser.close();
  }
  site.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
