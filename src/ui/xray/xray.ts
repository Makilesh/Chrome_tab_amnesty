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
import { studySummary } from '../../archive/study';
import { getCards } from '../../archive/store';
import { getMeta, getOpenTraces } from '../../collector/db';
import { redactTraces } from '../../collector/redact';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tabLine(t: TabTrace): HTMLLIElement {
  const li = el('li');
  const label = t.title || t.url;
  li.append(el('span', undefined, label));
  if (t.host && t.host !== label) li.append(el('span', 'host', t.host));
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


function fixture(traces: TabTrace[], mode: Mode): TraceFixture {
  const out = mode === 'shareable' ? redactTraces(traces) : traces;
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
    'Shareable export includes: page titles and headings, sites and page paths (with ids, links and numbers in them replaced by stand-ins), ' +
    'query parameter names, timing and which tab opened which. It leaves out: full addresses, query values, page text, email addresses, ' +
    'anything from mail, chat, calendar and search tabs except the site, and local file names.',
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

/**
 * Groups that already existed when this page opened are not Chrome's organiser output — they are
 * the person's own, a saved group, or another tool's (Claude in Chrome names its groups "✅…"; the
 * owner's first "baseline" was one of those). They are never captured and never ungrouped.
 * Recorded once, at page load: open this page, THEN run Organize tabs, then capture.
 */
const groupsAtLoad: Promise<Set<number>> = chrome.tabGroups
  .query({})
  .then((gs) => new Set(gs.map((g) => g.id)))
  .catch(() => new Set<number>());

async function captureBaseline(traces: TabTrace[]): Promise<string> {
  const byTabId = new Map(traces.map((t) => [t.tabId, t.traceId]));
  const before = await groupsAtLoad;
  const tabs = await chrome.tabs.query({});
  const all = await chrome.tabGroups.query({});
  const groupsRaw = all.filter((g) => !before.has(g.id));
  const leftAlone = all.length - groupsRaw.length;
  const note = leftAlone ? ` ${leftAlone === 1 ? 'One group that was' : 'Groups that were'} already there when this page opened ${leftAlone === 1 ? 'was' : 'were'} left alone.` : '';
  if (groupsRaw.length === 0) {
    return `No new tab groups since this page opened. Run Chrome's Organize tabs now, accept its groups, then click again.${note}`;
  }
  const groups = groupsRaw.map((g) => ({
    name: g.title ?? '',
    color: g.color,
    traceIds: tabs.filter((t) => t.groupId === g.id && t.id !== undefined).map((t) => byTabId.get(t.id!)).filter((x): x is string => !!x),
  }));
  const grouped = new Set(groups.flatMap((g) => g.traceIds));
  const ungrouped = traces.map((t) => t.traceId).filter((id) => !grouped.has(id));
  download(`${nameOr('browser')}.chrome.json`, { method: 'captured', capturedAt: Date.now(), groups, ungrouped, preexistingGroupsIgnored: leftAlone });

  // Put the strip back — only the groups Organize tabs just made. Saved groups refuse (§5.6); say so.
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
    ? `Saved. Chrome would not let me undo ${locked.length === 1 ? 'one group' : 'some groups'} (${locked.join(', ')}) — those are saved groups; you can ungroup them by hand.${note}`
    : `Saved, and the groups Organize tabs made are undone.${note}`;
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

  $('study-export').addEventListener('click', async () => {
    const summary = studySummary((await getMeta('openSnapshots')) ?? [], await getCards());
    download(`${nameOr('browser')}.study.json`, summary);
    $('status').textContent = 'Exported the study summary.';
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
