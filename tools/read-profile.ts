/**
 * Read Tab Amnesty's own records out of a real Chrome profile without touching that profile or the
 * browser using it. Copies ONLY the extension's IndexedDB folder into a throwaway Chrome for Testing
 * profile, loads the same unpacked build from the same path (so the same extension id, so the same
 * storage origin), and reads every store from an extension page with Chrome's own IndexedDB code.
 *
 *   npm run build && npx tsx tools/read-profile.ts [--profile "<Chrome User Data>/Default"] [--name makilesh]
 *
 * Writes:
 *   .real/<name>.raw.json      every store as read, plus the read time (git-ignored: full URLs, page text)
 *   fixtures/<name>.json       open tabs in the same shareable form the x-ray export writes
 *                              (src/collector/redact.ts: host + path, no query values, no page text,
 *                              no email addresses)
 *
 * The throwaway profile's collector starts up and does what it does on any startup: it re-binds
 * stored traces to live tabs and closes the ones it cannot find. It finds none, so every trace that
 * was open in the real browser gets closedAt >= the moment the copy was opened; those are put back
 * to open here, and any trace the throwaway browser minted for its own tabs is dropped. Nothing is
 * ever written back to the real profile.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { SCHEMA_VERSION, type TabTrace, type TraceFixture } from '../src/cluster/types';
import { redactTrace } from '../src/collector/redact';

const DIST = resolve('dist');
const OUT = resolve('.real');
const PROFILE = join(OUT, 'profile');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function findChrome(): string {
  const local = [...globSync('chrome/*/chrome-*/chrome.exe'), ...globSync('chrome/*/chrome-*/chrome')].sort().at(-1);
  if (local) return resolve(local);
  throw new Error('Chrome for Testing not found. Run: npm run check:setup');
}

async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    userDataDir: PROFILE,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-first-run', '--no-default-browser-check'],
  });
}

async function extensionId(browser: Browser): Promise<string> {
  const t = await browser.waitForTarget((x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'), { timeout: 20_000 });
  return new URL(t.url()).host;
}

interface Dump {
  version: number;
  stores: Record<string, { keys: unknown[]; values: unknown[] }>;
}

async function dump(browser: Browser, id: string): Promise<Dump> {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/src/ui/dev/index.html`);
  const d = (await page.evaluate(
    () =>
      new Promise((resolveDump, reject) => {
        const req = indexedDB.open('tab-amnesty');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          const out: { version: number; stores: Record<string, { keys: unknown[]; values: unknown[] }> } = { version: db.version, stores: {} };
          const tx = db.transaction(names, 'readonly');
          for (const n of names) {
            const s = tx.objectStore(n);
            const k = s.getAllKeys();
            const v = s.getAll();
            tx.addEventListener('complete', () => (out.stores[n] = { keys: k.result as unknown[], values: v.result as unknown[] }));
          }
          tx.oncomplete = () => setTimeout(() => resolveDump(out), 0);
          tx.onerror = () => reject(tx.error);
        };
      }),
  )) as Dump;
  await page.close();
  return d;
}


async function main(): Promise<void> {
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local');
  const source = arg('--profile', join(local, 'Google', 'Chrome', 'User Data', 'Default'));
  const name = arg('--name', 'makilesh');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });

  // 1. Learn the extension id this build gets from this path (and let its first install run on an empty profile).
  let browser = await launch();
  const id = await extensionId(browser);
  await sleep(1500);
  await browser.close();

  // 2. Swap in a copy of the real profile's records for that origin. Only this one folder.
  const folder = `chrome-extension_${id}_0.indexeddb.leveldb`;
  const from = join(source, 'IndexedDB', folder);
  if (!existsSync(from)) throw new Error(`no Tab Amnesty records at ${from}`);
  const to = join(PROFILE, 'Default', 'IndexedDB', folder);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) if (f !== 'LOCK') cpSync(join(from, f), join(to, f));

  // 3. Read it back through Chrome.
  const openedAt = Date.now();
  browser = await launch();
  await extensionId(browser);
  await sleep(2500);
  const d = await dump(browser, id);
  await browser.close();
  writeFileSync(join(OUT, `${name}.raw.json`), JSON.stringify({ readAt: openedAt, source, ...d }, null, 1));

  const all = (d.stores.traces?.values ?? []) as TabTrace[];
  const open = all
    .filter((t) => t.openedAt < openedAt) // minted by the throwaway browser for its own tabs
    .filter((t) => t.closedAt === null || t.closedAt >= openedAt)
    .map((t) => ({ ...t, closedAt: null }));
  const times = open.map((t) => t.openedAt);
  const fixture: TraceFixture = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: openedAt,
    mode: 'shareable',
    traceCount: open.length,
    openedAtMin: Math.min(...times),
    openedAtMax: Math.max(...times),
    traces: open.map(redactTrace),
  };
  writeFileSync(`fixtures/${name}.json`, JSON.stringify(fixture, null, 1) + '\n');

  const meta = d.stores.meta;
  const metaKeys = (meta?.keys ?? []) as string[];
  const cards = (d.stores.archive?.values ?? []) as { archivedAt: number; restoredAt: number | null; tabs: unknown[] }[];
  const snaps = ((meta?.values[metaKeys.indexOf('openSnapshots')] ?? []) as { at: number; open: number }[]).filter((x) => x.at < openedAt);
  console.log(`read ${source}`);
  // The copy is opened by THIS build, which upgrades it — so the version read back says nothing about
  // which build last ran in the real browser. Only data the real browser wrote does.
  console.log(`  stores (after this build opened the copy): ${Object.keys(d.stores).join(', ')}`);
  console.log(`  traces stored ${all.length}; open in the real browser ${open.length}; closed (kept) ${all.length - open.length - all.filter((t) => t.openedAt >= openedAt).length}`);
  const last = Math.max(...all.filter((t) => t.openedAt < openedAt).flatMap((t) => [t.openedAt, t.lastActiveAt ?? 0, t.digestAt ?? 0, t.closedAt && t.closedAt < openedAt ? t.closedAt : 0]));
  console.log(`  archive cards ${cards.length}${cards.length ? ` (brought back ${cards.filter((c) => c.restoredAt).length})` : ''}; open-tab snapshots ${snaps.length}`);
  console.log(`  last thing the real browser recorded: ${new Date(last).toISOString()}${openedAt - last > 86_400_000 ? '  <- over a day ago: is the extension still running? (reload it in chrome://extensions)' : ''}`);
  console.log(`  -> fixtures/${name}.json (shareable), .real/${name}.raw.json (full, git-ignored)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
