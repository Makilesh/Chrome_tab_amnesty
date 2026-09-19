/**
 * Integration check for the collector. Launches Chrome for Testing with the built extension,
 * opens tabs the way a person does (typed navigation, real link clicks), bounces between them,
 * then reads the traces back out of the extension's IndexedDB and prints them. Finally it
 * restarts Chrome with session restore to show the (url, windowId) re-bind across a restart.
 *
 * It SHOWS what was recorded rather than asserting it — the point is to see openerTraceId and
 * transition land for new tabs. Exit code is non-zero only if the run itself fails.
 *
 *   npm run build && npm run check
 *
 * Branded Google Chrome ignores --load-extension since 137, so this needs Chrome for Testing:
 *   npx @puppeteer/browsers install chrome@stable      (lands in ./chrome/, git-ignored)
 * CHROME_PATH is a fallback for any other Chromium build.
 */
import { existsSync, globSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import type { ArchiveCard } from '../src/archive/types';
import type { TabTrace } from '../src/cluster/types';

const DIST = resolve('dist');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findChrome(): string {
  const local = [...globSync('chrome/*/chrome-*/chrome.exe'), ...globSync('chrome/*/chrome-*/chrome')]
    .sort()
    .at(-1);
  if (local) return resolve(local);
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  throw new Error('Chrome for Testing not found. Run: npx @puppeteer/browsers install chrome@stable');
}

/** Tiny local site so the check is hermetic — no network, and history still records the visits. */
function page(title: string, links: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="description" content="Test page: ${title}"></head>
<body><nav><a href="/">home</a></nav><main><h1>${title}</h1><h2>Section one of ${title}</h2>
<p>This paragraph is long enough to count as lead text for the digest of the page titled ${title}.</p>
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
  // Real grouping on the strip first (chrome.tabGroups write), then Archive & close.
  await page.click('#strip');
  await sleep(1500);
  console.log(`  show on strip: ${await page.$eval('#strip-status', (e) => e.textContent)}`);
  await page.click('#groups button.primary');
  await sleep(2500);
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
  console.log(
    `\nbring back after restart: button ${clicked ? 'found' : 'MISSING'}; ${restored.length} of ${expected.length} tabs came back, ` +
      `order ${inOrder ? 'matches' : 'DIFFERS: ' + JSON.stringify(restored)}; card kept: ${cards.some((c) => c.cardId === card.cardId)}, ` +
      `restoredAt set: ${!!cards.find((c) => c.cardId === card.cardId)?.restoredAt}`,
  );
  await page.close();
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
    } finally {
      await browser.close();
    }
  }
  site.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
