/**
 * Developer diagnostics: raw TabTrace rows straight from IndexedDB. Read-only.
 * Exposes `window.__tabAmnestyTraces()` so the integration check can pull the same data.
 */
import type { TabTrace } from '../../cluster/types';
import { getAllTraces } from '../../collector/db';

declare global {
  interface Window {
    __tabAmnestyTraces: () => Promise<TabTrace[]>;
  }
}
window.__tabAmnestyTraces = getAllTraces;

function cell(content: string | number, cls?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = String(content);
  if (cls) td.className = cls;
  return td;
}

function ago(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

async function render(): Promise<void> {
  const all = await getAllTraces();
  const byId = new Map(all.map((t) => [t.traceId, t]));
  const open = all.filter((t) => t.closedAt === null).sort((a, b) => b.openedAt - a.openedAt);

  const summary = document.getElementById('summary')!;
  const eventTime = open.filter((t) => !t.backfilled).length;
  const withOpener = open.filter((t) => t.openerTraceId).length;
  const withTransition = open.filter((t) => t.transition !== 'unknown').length;
  const withDigest = open.filter((t) => t.digest).length;
  summary.textContent =
    `open traces: ${open.length} · event-time: ${eventTime} · backfilled: ${open.length - eventTime} · ` +
    `with opener: ${withOpener} · with transition: ${withTransition} · with digest: ${withDigest} · ` +
    `closed (kept): ${all.length - open.length}`;

  const table = document.getElementById('traces') as HTMLTableElement;
  table.replaceChildren();
  const head = table.createTHead().insertRow();
  for (const h of ['opened', 'title', 'host', 'transition', 'opener', 'src', 'act', 'dwell', 'co', 'digest', 'idx', 'win', 'traceId']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  const body = table.createTBody();
  for (const t of open) {
    const tr = body.insertRow();
    const opener = t.openerTraceId ? byId.get(t.openerTraceId) : undefined;
    tr.append(
      cell(ago(t.openedAt)),
      cell(t.title || t.url, 'title'),
      cell(t.host),
      cell(t.transition, t.transition === 'unknown' ? 'none' : 'ok'),
      cell(opener ? `↳ ${(opener.title || opener.host).slice(0, 28)}` : t.openerTraceId ? '(closed opener)' : '—', opener ? 'ok' : 'none'),
      cell(t.backfilled ? 'backfill' : 'event', t.backfilled ? 'bf' : 'ok'),
      cell(t.activationCount),
      cell(`${Math.round(t.dwellMs / 1000)}s`),
      cell(Object.keys(t.coActive).length),
      cell(t.digest ? `${t.digest.headings.length}h/${t.digest.leadText.length}c` : '—', t.digest ? 'ok' : 'none'),
      cell(t.index),
      cell(t.windowId),
      cell(t.traceId.slice(0, 8)),
    );
  }
}

void render();
setInterval(() => void render(), 2000);
