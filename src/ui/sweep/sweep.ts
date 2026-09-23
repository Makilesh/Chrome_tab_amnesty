/**
 * The sweep page (Phase 1). Reads stored records — never live tabs — clusters them, names each
 * group, and offers exactly one action per group: Archive & close. Everything archived is listed
 * below with Bring back (24 h) and Forget on every record.
 *
 * §6 on this page: the first thing on screen is a group the person recognises (§6.3); at most
 * five group actions are visible at once (§6.4); no counts of tabs anywhere (§6.1); nothing to
 * name (§6.7); nothing closes without a click on its own group (§6.9); Bring back survives a
 * restart because the card is in IndexedDB (§6.8); Forget is on every card and every tab (§6.10).
 */
import { undoable } from '../../archive/card';
import { betterName, type NamedGroup, quickName } from '../../archive/naming';
import { addNeverRemember, forgetCard, forgetTab, getCards, getNeverRemember, removeNeverRemember } from '../../archive/store';
import { archiveAndClose, bringBack, groupOnStrip, openOne } from '../../archive/sweep';
import type { ArchiveCard } from '../../archive/types';
import { cluster } from '../../cluster/cluster';
import type { Community, TabTrace } from '../../cluster/types';
import { getOpenTraces } from '../../collector/db';

const VISIBLE = 5;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function line(title: string, host: string, url: string, summary?: string | null): HTMLLIElement {
  const li = el('li');
  const t = el('span', 't', title || url);
  t.title = url;
  li.append(t, el('span', 'host', host));
  if (summary) li.append(el('span', 'sum', summary));
  return li;
}

interface Group {
  community: Community;
  members: TabTrace[];
  name: NamedGroup;
  /** The card element currently showing this group, so a better name can land in place. */
  el?: HTMLElement;
}

let groups: Group[] = [];
let shown = VISIBLE;
let busy = false;

// ---------------------------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------------------------

async function load(): Promise<void> {
  const traces = await getOpenTraces();
  const byId = new Map(traces.map((t) => [t.traceId, t]));
  const result = cluster(traces);
  // Heuristic names first so something recognisable is on screen at once (§6.3); on-device
  // names replace them one by one as the model answers.
  groups = result.communities.map((c) => ({
    community: c,
    members: c.traceIds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t),
    name: quickName(c, byId, traces),
  }));
  renderGroups();
  void upgradeNames(byId);

  const looseTraces = result.looseEnds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
  const loose = $('loose');
  const list = $('loose-list');
  list.replaceChildren();
  loose.hidden = looseTraces.length === 0;
  for (const t of looseTraces) list.append(line(t.title, t.host, t.url));
}

async function upgradeNames(byId: Map<string, TabTrace>): Promise<void> {
  for (const g of [...groups]) {
    const better = await betterName(g.community, byId, g.name);
    if (!better || !groups.includes(g)) continue;
    g.name = better;
    const h = g.el?.querySelector('h2');
    if (h) {
      h.textContent = better.name;
      h.title = 'Named on this device';
    }
  }
}

function groupCard(g: Group): HTMLElement {
  const card = el('section', `group c-${g.name.color}`);
  g.el = card;
  const header = el('header');
  const h = el('h2', undefined, g.name.name);
  h.title = g.name.tier === 'nano' ? 'Named on this device' : 'Named from what the tabs share';
  const btn = el('button', 'primary', 'Archive & close');
  btn.addEventListener('click', () => void onArchive(g, card, btn));
  header.append(h, btn);
  card.append(header);
  const d = g.name.description;
  card.append(el('p', 'when', [d.when, d.hosts.slice(0, 3).join(', ')].filter(Boolean).join(' · ')));
  const ul = el('ul');
  for (const t of g.members) ul.append(line(t.title, t.host, t.url));
  card.append(ul);
  return card;
}

function renderGroups(): void {
  const root = $('groups');
  root.replaceChildren();
  if (groups.length === 0) root.append(el('p', 'empty', 'Nothing to put away yet — this page fills in as you browse.'));
  for (const g of groups.slice(0, shown)) root.append(groupCard(g));
  $('more').hidden = groups.length <= shown;
}

async function onArchive(g: Group, card: HTMLElement, btn: HTMLButtonElement): Promise<void> {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  btn.textContent = 'Putting away…';
  try {
    const d = g.name.description;
    const saved = await archiveAndClose(g.community, g.members, g.name, d.when, d.hosts);
    groups = groups.filter((x) => x !== g);
    card.remove();
    renderGroups();
    if (saved) toast(`Put away “${saved.name}”.`, saved.cardId);
    await renderArchive();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Archive & close';
    card.append(el('p', 'note', `That did not work: ${(e as Error).message}`));
  } finally {
    busy = false;
  }
}

async function onStrip(): Promise<void> {
  const status = $('strip-status');
  status.textContent = 'Grouping…';
  let locked = 0;
  for (const g of groups) {
    const r = await groupOnStrip(g.members, g.name);
    if (r.locked) locked++;
  }
  status.textContent = locked
    ? `Done. Chrome keeps ${locked === 1 ? 'one of these' : 'some of these'} locked as a saved group, so it stays as it is on the strip.`
    : 'Done — the groups are on your tab strip. Nothing was closed.';
}

// ---------------------------------------------------------------------------------------------
// Archive: bring back, open, forget
// ---------------------------------------------------------------------------------------------

function archiveCard(c: ArchiveCard): HTMLElement {
  const card = el('section', `group c-${c.color}`);
  const header = el('header');
  header.append(el('h2', undefined, c.name));
  const actions = el('div');
  if (undoable(c)) {
    const back = el('button', undefined, 'Bring back');
    back.addEventListener('click', async () => {
      back.disabled = true;
      const r = await bringBack(c.cardId);
      if (!r.ok) card.append(el('p', 'note', r.reason ?? ''));
      await renderArchive();
    });
    actions.append(back);
  }
  const forget = el('button', 'quiet', 'Forget this');
  forget.addEventListener('click', async () => {
    await forgetCard(c.cardId);
    await renderArchive();
  });
  actions.append(forget);
  header.append(actions);
  card.append(header);
  const when = [c.when, c.hosts.slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  card.append(el('p', `when${c.restoredAt ? ' done' : ''}`, c.restoredAt ? `${when} · brought back` : when));
  const details = el('details');
  details.append(el('summary', undefined, 'What was in it'));
  const ul = el('ul');
  for (const t of c.tabs) {
    const li = line(t.title, t.host, t.url, t.summary);
    const open = el('button', 'quiet', 'Open');
    open.addEventListener('click', () => void openOne(t.url));
    const fg = el('button', 'quiet', 'Forget this');
    fg.addEventListener('click', async () => {
      await forgetTab(c.cardId, t.traceId);
      await renderArchive();
    });
    li.append(open, fg);
    ul.append(li);
  }
  details.append(ul);
  card.append(details);
  return card;
}

async function renderArchive(): Promise<void> {
  const cards = await getCards();
  const section = $('archive');
  const root = $('cards');
  root.replaceChildren();
  section.hidden = cards.length === 0;
  for (const c of cards) root.append(archiveCard(c));
}

function toast(text: string, cardId: string): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', 'toast', text);
  const back = el('button', undefined, 'Bring back');
  back.addEventListener('click', async () => {
    await bringBack(cardId);
    t.remove();
    await renderArchive();
  });
  t.append(back);
  document.body.append(t);
  setTimeout(() => t.remove(), 12_000);
}

// ---------------------------------------------------------------------------------------------
// Never remember
// ---------------------------------------------------------------------------------------------

function renderNever(list: string[]): void {
  const ul = $('never-list');
  ul.replaceChildren();
  for (const d of list) {
    const li = el('li', undefined, d);
    const rm = el('button', 'quiet', 'remember again');
    rm.addEventListener('click', async () => renderNever(await removeNeverRemember(d)));
    li.append(rm);
    ul.append(li);
  }
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  await load();
  await renderArchive();
  renderNever(await getNeverRemember());

  $('strip').addEventListener('click', () => void onStrip());
  $('more-btn').addEventListener('click', () => {
    shown += VISIBLE;
    renderGroups();
  });
  $('never-add').addEventListener('click', async () => {
    const input = $<HTMLInputElement>('never-input');
    if (!input.value.trim()) return;
    renderNever(await addNeverRemember(input.value));
    input.value = '';
  });
  // Summaries arrive in the background; refresh the archive now and then to show them.
  setInterval(() => void renderArchive(), 20_000);
}

void main();
