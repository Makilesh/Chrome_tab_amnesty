/**
 * The x-ray page (Phase 0d). Read-only: reads stored traces, clusters them, shows the result.
 * Nothing on it changes the browser — with one deliberate exception behind "For the study":
 * capturing Chrome's own grouping reads Chrome's tab groups and then ungroups them to put the
 * strip back (docs/DECISIONS.md, "Chrome baseline is captured").
 *
 * §6 applies: no counts of tabs anywhere, no forbidden words, nothing to name, nothing to choose.
 */
import { cluster } from '../../cluster/cluster';
import { describe } from '../../cluster/describe';
import { SCHEMA_VERSION, type TabTrace, type TraceFixture } from '../../cluster/types';
import { getOpenTraces } from '../../collector/db';
import { reduceUrl } from '../../collector/url';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tabLine(t: TabTrace): HTMLLIElement {
  const li = el('li');
  li.append(el('span', undefined, t.title || t.url), el('span', 'host', t.host));
  li.title = t.url;
  return li;
}

async function render(): Promise<TabTrace[]> {
  const traces = await getOpenTraces();
  const byId = new Map(traces.map((t) => [t.traceId, t]));
  const result = cluster(traces);

  const groups = $('groups');
  groups.replaceChildren();
  if (result.communities.length === 0) {
    groups.append(el('p', 'empty', 'Nothing to show yet — this page fills in as you browse.'));
  }
  for (const c of result.communities) {
    const d = describe(c, byId, traces);
    const card = el('section', 'group');
    card.append(el('h2', undefined, d.heading));
    card.append(el('p', 'when', [d.when, d.hosts.slice(0, 3).join(', ')].filter(Boolean).join(' · ')));
    const ul = el('ul');
    for (const id of c.traceIds) {
      const t = byId.get(id);
      if (t) ul.append(tabLine(t));
    }
    card.append(ul);
    groups.append(card);
  }

  const loose = $('loose');
  const looseList = $('loose-list');
  looseList.replaceChildren();
  const looseTraces = result.looseEnds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
  loose.hidden = looseTraces.length === 0;
  for (const t of looseTraces) looseList.append(tabLine(t));
  return traces;
}

// ---------------------------------------------------------------------------------------------
// For the study: export
// ---------------------------------------------------------------------------------------------

type Mode = 'full' | 'shareable';

function redact(t: TabTrace): TabTrace {
  return {
    ...t,
    url: reduceUrl(t.url),
    queryKeys: Object.fromEntries(Object.keys(t.queryKeys).map((k) => [k, ''])),
    digest: t.digest ? { ...t.digest, leadText: '' } : null,
  };
}

function fixture(traces: TabTrace[], mode: Mode): TraceFixture {
  const out = mode === 'shareable' ? traces.map(redact) : traces;
  const times = traces.map((t) => t.openedAt);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    mode,
    traceCount: out.length,
    openedAtMin: Math.min(...times),
    openedAtMax: Math.max(...times),
    traces: out,
  };
}

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const CONSENT: Record<Mode, string> = {
  shareable:
    'Shareable export includes: page titles, hosts and paths, page descriptions and headings, query parameter names, ' +
    'timing and which tab opened which. It leaves out: full URLs, query parameter values, and page text.',
  full: 'Full export includes everything recorded: full URLs, query values, and page text. Keep this on your own machine.',
};

function mode(): Mode {
  return (document.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value as Mode) ?? 'shareable';
}

function nameOr(fallback: string): string {
  return ($<HTMLInputElement>('name').value.trim() || fallback).replace(/[^\w.-]+/g, '_');
}

// ---------------------------------------------------------------------------------------------
// For the study: Chrome's own grouping as the baseline
// ---------------------------------------------------------------------------------------------

async function captureBaseline(traces: TabTrace[]): Promise<string> {
  const byTabId = new Map(traces.map((t) => [t.tabId, t.traceId]));
  const tabs = await chrome.tabs.query({});
  const groupsRaw = await chrome.tabGroups.query({});
  if (groupsRaw.length === 0) {
    return 'No tab groups found. Run Chrome’s Organize tabs and accept its groups first.';
  }
  const groups = groupsRaw.map((g) => ({
    name: g.title ?? '',
    color: g.color,
    traceIds: tabs.filter((t) => t.groupId === g.id && t.id !== undefined).map((t) => byTabId.get(t.id!)).filter((x): x is string => !!x),
  }));
  const grouped = new Set(groups.flatMap((g) => g.traceIds));
  const ungrouped = traces.map((t) => t.traceId).filter((id) => !grouped.has(id));
  download(`${nameOr('browser')}.chrome.json`, { method: 'captured', capturedAt: Date.now(), groups, ungrouped });

  // Put the strip back. Saved/synced groups refuse this (§5.6); say so rather than leave it silent.
  const locked: string[] = [];
  for (const g of groupsRaw) {
    const ids = tabs.filter((t) => t.groupId === g.id && t.id !== undefined).map((t) => t.id!);
    try {
      if (ids.length) await chrome.tabs.ungroup(ids);
    } catch {
      locked.push(g.title || g.color);
    }
  }
  return locked.length
    ? `Saved. Chrome would not let me undo ${locked.length === 1 ? 'one group' : 'some groups'} (${locked.join(', ')}) — those are saved groups; you can ungroup them by hand.`
    : 'Saved, and your tab strip is back to how it was.';
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  let traces = await render();
  setInterval(() => void render().then((t) => (traces = t)), 5000);

  const consent = $('consent');
  const updateConsent = () => (consent.textContent = CONSENT[mode()]);
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', updateConsent));
  updateConsent();

  $('export').addEventListener('click', () => {
    const m = mode();
    download(`${nameOr('browser')}${m === 'full' ? '.full' : ''}.json`, fixture(traces, m));
    $('status').textContent = `Exported (${m}).`;
  });

  $('baseline').addEventListener('click', async () => {
    const status = $('status');
    status.textContent = 'Reading Chrome’s groups…';
    try {
      status.textContent = await captureBaseline(traces);
    } catch (e) {
      status.textContent = `Could not capture: ${(e as Error).message}`;
    }
  });
}

void main();
