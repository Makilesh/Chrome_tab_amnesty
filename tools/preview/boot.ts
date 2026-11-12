/**
 * Design preview boot (vite.config.ts): stands in for the extension APIs the sweep page uses,
 * fills a fresh database with the made-up tabs in data.ts, then runs the page's own script.
 *
 *   ?empty   a first visit: the Start notice, nothing recorded yet, nothing put away
 *   ?find=w  arrive searching, as from "ta w" in the address bar
 *   ?fresh   just after Start: every open tab adopted, timing unknown
 *   ?slow    Archive & close's movement at a tenth of its speed, to look at it frame by frame
 */
import { saveRememberedNames, putCard } from '../../src/archive/store';
import { start } from '../../src/collector/consent';
import { DB_NAME, putTrace, setMeta } from '../../src/collector/db';
import { previewData } from './data';

const ok = <T>(v: T) => () => Promise.resolve(v);

const stub = {
  runtime: {
    getURL: (p: string) => new URL(p, location.origin).href,
    sendMessage: (m: { type?: string }) =>
      m?.type === 'start' ? start().then(() => ({ ok: true })) : Promise.resolve(m?.type === 'build' ? { build: __BUILD_ID__ } : undefined),
    getManifest: () => ({ version: 'preview' }),
    onMessage: { addListener() {} },
  },
  tabs: {
    getCurrent: ok(undefined),
    query: ok([]),
    remove: ok(undefined),
    create: (o: { url?: string }) => Promise.resolve({ id: Math.floor(Math.random() * 1e6), url: o.url }),
    group: ok(1),
    ungroup: ok(undefined),
    move: ok(undefined),
    sendMessage: ok(undefined),
  },
  tabGroups: { update: ok({}) },
  windows: { getCurrent: ok({ id: 1 }) },
};
(globalThis as unknown as { chrome: unknown }).chrome = stub;

async function fresh(): Promise<void> {
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  for (const k of await caches.keys()) await caches.delete(k);
}

const asked = new URLSearchParams(location.search);
if (asked.has('slow')) document.documentElement.style.setProperty('--dur-move', '4800ms');
await fresh();
if (!asked.has('empty')) {
  const data = previewData();
  if (asked.has('fresh')) for (const t of data.traces) Object.assign(t, { backfilled: true, transition: 'unknown' });
  for (const t of data.traces) await putTrace(t);
  for (const c of data.cards) await putCard(c);
  await saveRememberedNames(data.names);
  await setMeta('neverRemember', data.never);
}
await import('../../src/ui/sweep/sweep');
