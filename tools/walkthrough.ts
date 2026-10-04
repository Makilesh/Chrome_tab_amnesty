/**
 * Walkthrough: the whole product, start to finish, in a visible Chrome for Testing window, on
 * real websites. Two projects are browsed the way a person does — a typed visit, then links
 * opened in new tabs, then switching back and forth — interleaved so a topic-only clusterer
 * would be tempted to mix them (both use Wikipedia):
 *
 *   asyncio  docs.python.org -> task / queue docs, PEP 3156, Wikipedia "Async/await"
 *   lisbon   wikivoyage Lisbon -> Wikipedia Lisbon / Alfama / Belém Tower, wikivoyage Sintra
 *
 * Pacing is human: about a minute of reading between projects, because co-activation counts
 * tabs foregrounded within 60 s of each other and a 1-second robot would co-activate everything.
 *
 * Then: sweep page (names, §6 audit), Show on strip, Export traces, Archive & close one group,
 * restart Chrome, Bring back, Export study summary. The browser is left open for the person.
 *
 *   npm run build && npm run walkthrough
 *
 * Output lands in .walkthrough/ (git-ignored): profile, downloads, screenshots. This is a
 * SCRIPTED browser: its export is a mechanics check and never counts toward any gate.
 */
import { globSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import type { ArchiveCard } from '../src/archive/types';
import type { TabTrace } from '../src/cluster/types';

const DIST = resolve('dist');
const OUT = resolve('.walkthrough');
const PROFILE = join(OUT, 'profile');
const DOWNLOADS = join(OUT, 'downloads');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => console.log(`\n▶ ${s}`);
/** A person reads before moving on to something else; co-activation counts switches within 60 s. */
const READ_MS = 70_000;

const PROJECTS = {
  asyncio: {
    start: 'https://docs.python.org/3/library/asyncio.html',
    links: [
      ['https://docs.python.org/3/library/asyncio.html', 'https://docs.python.org/3/library/asyncio-task.html'],
      ['https://docs.python.org/3/library/asyncio-task.html', 'https://docs.python.org/3/library/asyncio-queue.html'],
      ['https://docs.python.org/3/library/asyncio.html', 'https://peps.python.org/pep-3156/'],
    ],
    later: [['https://docs.python.org/3/library/asyncio-task.html', 'https://en.wikipedia.org/wiki/Async/await']],
  },
  lisbon: {
    start: 'https://en.wikivoyage.org/wiki/Lisbon',
    links: [
      ['https://en.wikivoyage.org/wiki/Lisbon', 'https://en.wikipedia.org/wiki/Lisbon'],
      ['https://en.wikipedia.org/wiki/Lisbon', 'https://en.wikipedia.org/wiki/Alfama'],
      ['https://en.wikipedia.org/wiki/Lisbon', 'https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower'],
    ],
    later: [['https://en.wikivoyage.org/wiki/Lisbon', 'https://en.wikivoyage.org/wiki/Sintra']],
  },
} as const;

function findChrome(): string {
  const local = [...globSync('chrome/*/chrome-*/chrome.exe'), ...globSync('chrome/*/chrome-*/chrome')].sort().at(-1);
  if (local) return resolve(local);
  throw new Error('Chrome for Testing not found. Run: npm run check:setup');
}

async function launch(restore = false): Promise<Browser> {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: false,
    userDataDir: PROFILE,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,860',
      ...(restore ? ['--restore-last-session'] : []),
    ],
    defaultViewport: null,
  });
}

async function extensionId(browser: Browser): Promise<string> {
  const t = await browser.waitForTarget((x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'), { timeout: 15_000 });
  return new URL(t.url()).host;
}

async function pageAt(browser: Browser, url: string): Promise<Page | undefined> {
  return (await browser.pages()).find((p) => p.url() === url);
}

/** A real mouse click on a link with target=_blank: Chrome sets openerTabId and records 'link'. */
async function openFrom(browser: Browser, fromUrl: string, href: string): Promise<void> {
  const from = await pageAt(browser, fromUrl);
  if (!from) throw new Error(`no tab at ${fromUrl}`);
  await from.bringToFront();
  await from.evaluate((h) => {
    document.getElementById('__ta_link')?.remove();
    const a = document.createElement('a');
    a.href = h;
    a.target = '_blank';
    a.rel = 'opener';
    a.textContent = 'open';
    a.id = '__ta_link';
    a.style.cssText = 'position:fixed;top:8px;left:8px;font-size:32px;z-index:2147483647;background:#ff0;padding:4px';
    document.body.append(a);
  }, href);
  const created = new Promise<void>((r) => browser.once('targetcreated', () => r()));
  await from.click('#__ta_link');
  await created;
  await sleep(2500);
  await from.evaluate(() => document.getElementById('__ta_link')?.remove());
}

async function typed(browser: Browser, url: string): Promise<void> {
  const p = await browser.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await sleep(2000);
}

async function bounce(browser: Browser, urls: readonly string[], rounds: number): Promise<void> {
  for (let r = 0; r < rounds; r++) {
    for (const u of urls) {
      const p = await pageAt(browser, u);
      if (!p) continue;
      await p.bringToFront();
      await sleep(900);
    }
  }
}

async function devRead<T>(browser: Browser, id: string, fn: string): Promise<T> {
  const p = await browser.newPage();
  await p.goto(`chrome-extension://${id}/src/ui/dev/index.html`);
  await p.waitForFunction((f) => typeof (window as any)[f] === 'function', {}, fn);
  const v = (await p.evaluate((f) => (window as any)[f](), fn)) as T;
  await p.close();
  return v;
}

async function downloadsTo(p: Page): Promise<void> {
  const cdp = await p.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true });
}

const FORBIDDEN = /\b(delete|clean ?up|declutter|tidy|messy)\b/i;
const COUNT = /\b\d+\s+tabs?\b/i;

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });

  say('Installing Tab Amnesty into a fresh Chrome for Testing profile');
  let browser = await launch();
  let id = await extensionId(browser);
  await sleep(1500);
  console.log(`  extension ${id}`);

  say('Browsing project 1 — asyncio (typed visit, then links in new tabs)');
  const A = PROJECTS.asyncio;
  const B = PROJECTS.lisbon;
  await typed(browser, A.start);
  for (const [from, to] of A.links) await openFrom(browser, from, to);

  say('Reading for a minute before switching to something else');
  await sleep(READ_MS);

  say('Browsing project 2 — a trip to Lisbon');
  await typed(browser, B.start);
  for (const [from, to] of B.links) await openFrom(browser, from, to);

  await sleep(READ_MS);
  say('Back to asyncio: one more link, switching between its tabs');
  for (const [from, to] of A.later) await openFrom(browser, from, to);
  await bounce(browser, [A.start, A.links[0][1], A.links[1][1], A.links[2][1], A.later[0][1]], 2);
  await sleep(READ_MS);
  say('Back to Lisbon: one more link, switching between its tabs');
  for (const [from, to] of B.later) await openFrom(browser, from, to);
  await bounce(browser, [B.start, B.links[0][1], B.links[1][1], B.links[2][1], B.later[0][1]], 2);
  for (const p of await browser.pages()) if (p.url() === 'about:blank') await p.close();

  const traces = await devRead<TabTrace[]>(browser, id, '__tabAmnestyTraces');
  const open = traces.filter((t) => t.closedAt === null && /^https?:/.test(t.url));
  const byId = new Map(traces.map((t) => [t.traceId, t]));
  console.log('  what the collector recorded:');
  for (const t of open.sort((a, b) => a.openedAt - b.openedAt)) {
    const op = t.openerTraceId ? byId.get(t.openerTraceId)?.url.replace(/^https:\/\//, '').slice(0, 34) : '';
    console.log(`   ${t.transition.padEnd(8)} ${t.url.replace(/^https:\/\//, '').slice(0, 48).padEnd(48)} opener=${op || '-'}  switches=${t.activationCount} digest=${t.digest ? 'yes' : 'no'}`);
  }

  say('Opening the sweep page (what the icon opens)');
  const sweep = await browser.newPage();
  await sweep.goto(`chrome-extension://${id}/src/ui/sweep/index.html`);
  await sweep.waitForSelector('#groups .group, #groups .empty');
  await sleep(1500);
  await sweep.screenshot({ path: join(OUT, '1-sweep.png'), fullPage: true });
  const groups = await sweep.$$eval('#groups .group', (gs) =>
    gs.map((g) => ({ name: g.querySelector('h2')?.textContent ?? '', tabs: [...g.querySelectorAll('li .t')].map((x) => x.textContent ?? '') })),
  );
  for (const g of groups) console.log(`  "${g.name}": ${g.tabs.join(' / ')}`);
  const text = await sweep.evaluate(() => document.body.innerText);
  console.log(`  §6 audit: forbidden words ${FORBIDDEN.test(text) ? 'FOUND' : 'none'}; tab counts ${COUNT.test(text) ? 'FOUND' : 'none'}; naming fields ${await sweep.$$eval('input', (i) => i.filter((x) => x.closest('#groups')).length)}`);

  say('Show these groups on my tab strip');
  await sweep.click('#strip');
  await sleep(1500);
  console.log(`  ${await sweep.$eval('#strip-status', (e) => e.textContent)}`);
  await sweep.bringToFront();

  say('Exporting traces from the study page (shareable)');
  const xray = await browser.newPage();
  await downloadsTo(xray);
  await xray.goto(`chrome-extension://${id}/src/ui/xray/index.html`);
  await xray.waitForSelector('#study');
  await xray.click('#study summary');
  await xray.type('#name', 'walkthrough');
  await xray.click('#export');
  await sleep(1500);
  await xray.close();

  say('Archive & close — the first group');
  await sweep.bringToFront();
  const before = (await browser.pages()).filter((p) => /^https?:/.test(p.url())).length;
  await sweep.click('#groups .group button.primary');
  await sleep(3000);
  await sweep.screenshot({ path: join(OUT, '2-after-archive.png'), fullPage: true });
  const cards = await devRead<ArchiveCard[]>(browser, id, '__tabAmnestyCards');
  const card = cards[0];
  const after = (await browser.pages()).filter((p) => /^https?:/.test(p.url())).length;
  console.log(`  put away "${card?.name}" — its tabs closed (${before} -> ${after} open pages), card kept with ${card?.tabs.length} lines`);

  say('Quitting Chrome and starting it again (undo must survive a restart)');
  await browser.close();
  await sleep(1500);
  browser = await launch(true);
  id = await extensionId(browser);
  await sleep(3000);

  say('Bring back');
  const sweep2 = await browser.newPage();
  await sweep2.goto(`chrome-extension://${id}/src/ui/sweep/index.html`);
  await sweep2.waitForSelector('#cards .group', { timeout: 10_000 });
  const preUrls = (await browser.pages()).map((p) => p.url());
  await sweep2.evaluate(() => ([...document.querySelectorAll('#cards button')].find((b) => b.textContent === 'Bring back') as HTMLButtonElement)?.click());
  await sleep(4000);
  const back = (await browser.pages()).map((p) => p.url()).filter((u) => /^https?:/.test(u) && !preUrls.includes(u));
  console.log(`  ${back.length} tabs came back: ${back.map((u) => u.replace(/^https:\/\//, '')).join(', ')}`);
  await sweep2.reload();
  await sleep(1500);
  await sweep2.screenshot({ path: join(OUT, '3-after-bring-back.png'), fullPage: true });
  const regrouped = await sweep2.$$eval('#groups .group', (gs) =>
    gs.map((g) => `"${g.querySelector('h2')?.textContent ?? ''}": ${[...g.querySelectorAll('li .t')].map((x) => x.textContent ?? '').join(' / ')}`),
  );
  console.log('  groups after bring back:');
  for (const g of regrouped) console.log(`   ${g}`);

  say('Export study summary (Phase 1 gate data: times and counts only)');
  const xray2 = await browser.newPage();
  await downloadsTo(xray2);
  await xray2.goto(`chrome-extension://${id}/src/ui/xray/index.html`);
  await xray2.waitForSelector('#study');
  await xray2.click('#study summary');
  await xray2.type('#name', 'walkthrough');
  await xray2.click('#study-export');
  await sleep(1500);
  await xray2.close();
  await sweep2.bringToFront();

  // Ground truth is known by construction here, because the browsing was scripted.
  const exportFile = readdirSync(DOWNLOADS).find((f) => f === 'walkthrough.json');
  if (exportFile) {
    const fx = JSON.parse(readFileSync(join(DOWNLOADS, exportFile), 'utf8'));
    fx._scripted = 'tools/walkthrough.ts — mechanics only, never a gate browser';
    writeFileSync('fixtures/walkthrough.json', JSON.stringify(fx, null, 1));
    const urls = (p: object) => Object.values(p).flat(2) as string[];
    const label = (u: string) => (urls(A).includes(u) ? 'asyncio' : urls(B).includes(u) ? 'lisbon' : null);
    const labels: Record<string, string | null> = { _scripted: 'ground truth by construction (tools/walkthrough.ts)' };
    for (const t of fx.traces as TabTrace[]) {
      const full = traces.find((x) => x.traceId === t.traceId)?.url ?? t.url;
      labels[t.traceId] = label(full);
    }
    writeFileSync('fixtures/walkthrough.labels.json', JSON.stringify(labels, null, 1));
  }
  const study = readdirSync(DOWNLOADS).find((f) => f.endsWith('.study.json'));
  if (study) writeFileSync('fixtures/walkthrough.study.json', readFileSync(join(DOWNLOADS, study)));
  console.log(`\n  files: ${readdirSync(DOWNLOADS).join(', ')} -> fixtures/walkthrough.{json,labels.json,study.json}`);
  console.log(`  screenshots: ${OUT}\\1-sweep.png, 2-after-archive.png, 3-after-bring-back.png`);

  say('Leaving the browser open — it is yours to try. Close it when done.');
  browser.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

