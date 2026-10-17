/**
 * The sweep page (Phase 1). Reads stored records — never live tabs — clusters them, names each
 * group, and offers exactly one action per group: Archive & close. Everything archived is listed
 * below, searchable (Phase 2's return path), with Bring back for a day, then Open all, and Forget
 * on every record.
 *
 * §6 on this page: the first thing on screen is a group the person recognises (§6.3); at most
 * five group actions are visible at once (§6.4); no counts of tabs anywhere (§6.1); nothing to
 * name (§6.7); nothing closes without a click on its own group (§6.9); Bring back survives a
 * restart because the card is in IndexedDB (§6.8); Forget is on every card and every tab (§6.10).
 */
import { cardWhen, undoable } from '../../archive/card';
import { betterName, type NamedGroup, quickName, type RememberedName, rememberedName, rememberName } from '../../archive/naming';
import { addNeverRemember, forgetCard, forgetTab, getCards, getNeverRemember, getRememberedNames, removeNeverRemember, saveRememberedNames } from '../../archive/store';
import { queryTerms, searchArchive } from '../../archive/search';
import { archiveAndClose, bringBack, groupOnStrip, openCard, openOne, type StripPlace, ungroupOurs } from '../../archive/sweep';
import type { ArchiveCard, ArchivedTab } from '../../archive/types';
import { cluster } from '../../cluster/cluster';
import type { Community, TabTrace } from '../../cluster/types';
import { getOpenTraces, getTraceByTabId } from '../../collector/db';

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
  const label = title || url;
  const t = el('span', 't', label);
  t.title = url;
  li.append(t);
  if (host && host !== label) li.append(el('span', 'host', host)); // a page titled by its own address shows it once
  if (summary) li.append(el('span', 'sum', summary));
  return li;
}

interface Group {
  community: Community;
  members: TabTrace[];
  name: NamedGroup;
  /** The card element currently showing this group, so a better name can land in place. */
  el?: HTMLElement;
  /** Named from memory: the model is not asked again. */
  remembered?: boolean;
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
  // A group seen before keeps the name it had, from the first frame — no flicker, no renaming.
  const memory = await getRememberedNames().catch(() => []);
  const taken: string[] = [];
  for (const g of groups) {
    const known = rememberedName(g.community.traceIds, memory, taken);
    if (known) {
      g.name = { ...g.name, name: known, tier: 'nano' };
      g.remembered = true;
      taken.push(known);
    }
  }
  renderGroups();
  void upgradeNames(byId, taken);

  const looseTraces = result.looseEnds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
  const loose = $('loose');
  const list = $('loose-list');
  list.replaceChildren();
  loose.hidden = looseTraces.length === 0;
  for (const t of looseTraces) list.append(line(t.title, t.host, t.url));
}

/**
 * Change the remembered names from what is stored NOW: the model takes seconds per group, and
 * writing back a copy read before it answered brought back names the person had just forgotten
 * (§6.10).
 */
async function updateNames(fn: (memory: RememberedName[]) => RememberedName[]): Promise<void> {
  const fresh = await getRememberedNames().catch(() => null);
  if (fresh) await saveRememberedNames(fn(fresh)).catch(() => {});
}

async function upgradeNames(byId: Map<string, TabTrace>, taken: string[]): Promise<void> {
  // `taken`: names already on screen from memory, plus each new one the model gives in this sweep.
  // Groups named from memory are saved with their tabs as they are now, at once — a project's
  // memory follows its tabs even on a sweep where no group gets a new name (it used to drift
  // until the project was renamed).
  const known = groups.filter((g) => g.remembered);
  if (known.length) await updateNames((m) => known.reduce((acc, g) => rememberName(acc, g.community.traceIds, g.name.name), m));
  for (const g of [...groups]) {
    if (g.remembered) continue;
    const better = await betterName(g.community, byId, g.name, taken);
    if (!better || !groups.includes(g)) continue;
    taken.push(better.name);
    await updateNames((m) => rememberName(m, g.community.traceIds, better.name));
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

function quoted(t: TabTrace): string {
  const s = (t.title || t.host).trim();
  return `“${s.length > 48 ? `${s.slice(0, 47)}…` : s}”`;
}

async function onArchive(g: Group, card: HTMLElement, btn: HTMLButtonElement): Promise<void> {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  btn.textContent = 'Putting away…';
  try {
    const d = g.name.description;
    const { card: saved, keptOpen } = await archiveAndClose(g.community, g.members, g.name, d.when, d.hosts, d.whenAt);
    groups = groups.filter((x) => x !== g);
    card.remove();
    renderGroups();
    const kept = keptOpen.length
      ? ` Left open, because you typed something in ${keptOpen.length === 1 ? 'it' : 'them'}: ${keptOpen.map(quoted).join(', ')}.`
      : '';
    if (saved) toast(`Put away “${saved.name}”.${kept}`, saved.cardId);
    else if (keptOpen.length) toast(`Nothing put away.${kept}`);
    // Keyboard users keep their place: focus moves to the next thing they can act on.
    ($('groups').querySelector<HTMLButtonElement>('button.primary') ?? $<HTMLButtonElement>('strip')).focus({ preventScroll: true });
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
  status.replaceChildren('Grouping…');
  let locked = 0;
  let leftInPlace = 0;
  let error = '';
  const made: number[] = [];
  const moved: StripPlace[] = [];
  for (const g of groups) {
    // groupOnStrip reports instead of throwing, so Undo still covers what was done before a refusal.
    const r = await groupOnStrip(g.members, g.name).catch((e: Error) => ({ groupIds: [], locked: false, leftInPlace: 0, moved: [], error: e.message }));
    if (r.locked) locked++;
    leftInPlace += r.leftInPlace;
    made.push(...r.groupIds);
    moved.push(...r.moved);
    error ||= r.error ?? '';
  }
  const parts = [error ? 'Chrome did not let every group onto your tab strip. Nothing was closed.' : 'Done — these groups are on your tab strip. Nothing was closed.'];
  if (leftInPlace) parts.push('Tabs you had already grouped were left where they were.');
  if (locked) parts.push(`Chrome keeps ${locked === 1 ? 'one of these' : 'some of these'} locked as a saved group.`);
  status.replaceChildren(parts.join(' '));
  if (made.length) {
    const undo = el('button', 'quiet', 'Undo');
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      await ungroupOurs(made, moved);
      status.replaceChildren('Undone — your tab strip is back to how it was.');
    });
    status.append(' ', undo);
  }
}

/**
 * Is the recorder alive? Opening this page creates a tab, and a working collector records it
 * within a moment. If it does not, the groups below may be stale — say so plainly rather than
 * let someone act on them (the owner's browser once ran two weeks this way, unnoticed).
 */
async function checkRecorder(): Promise<void> {
  const me = await chrome.tabs.getCurrent();
  if (me?.id === undefined) return;
  for (let i = 0; i < 8; i++) {
    if (await getTraceByTabId(me.id)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  $('health').hidden = false;
}

/**
 * Is the recorder this page's build? Chrome keeps running the worker it registered until the
 * extension is reloaded or switched off and on — not on a restart — while this page loads from
 * disk. The owner's Chrome ran an old worker for two weeks and then nine days that way. A worker
 * too old to answer is older than this page; a newer one means this page is the stale one, which
 * the next visit fixes by itself.
 */
async function checkBuild(): Promise<void> {
  const r = (await chrome.runtime.sendMessage({ type: 'build' }).catch(() => null)) as { build?: number } | null;
  if (typeof r?.build !== 'number' || r.build < __BUILD_ID__) $('stale').hidden = false;
}

// ---------------------------------------------------------------------------------------------
// Archive: find, bring back, open, forget
// ---------------------------------------------------------------------------------------------

/** Bring a card back from either of its buttons; a refusal is said in a toast, where a re-render cannot wipe it. */
async function onBringBack(cardId: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  const r = await bringBack(cardId);
  if (!r.ok && r.reason) toast(r.reason);
  else document.querySelector('.toast')?.remove();
  await renderArchive(true);
}

/** Open a whole card again, any time after its day; the tabs land at the end of the strip, behind this page. */
async function onOpenAll(c: ArchiveCard, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    await openCard(c);
    toast(`“${c.name}” is open again, at the end of your tab strip.`);
  } catch (e) {
    toast(`That did not work: ${(e as Error).message}`);
  } finally {
    button.disabled = false;
  }
}

/**
 * One put-away card. `matched`: a search found these of its tabs (not the card itself), so the
 * list is open and holds only them.
 */
function archiveCard(c: ArchiveCard, open: boolean, matched?: ArchivedTab[]): HTMLElement {
  const card = el('section', `group c-${c.color}`);
  card.dataset.card = c.cardId;
  const header = el('header');
  header.append(el('h2', undefined, c.name));
  const actions = el('div');
  // One action per card (§6.4): the undo for its first day, then opening it again, as often as wanted.
  if (undoable(c)) {
    const back = el('button', undefined, 'Bring back');
    back.addEventListener('click', () => void onBringBack(c.cardId, back));
    actions.append(back);
  } else {
    const all = el('button', undefined, 'Open all');
    all.addEventListener('click', () => void onOpenAll(c, all));
    actions.append(all);
  }
  const forget = el('button', 'quiet', 'Forget this');
  forget.addEventListener('click', async () => {
    forget.disabled = true;
    await forgetCard(c.cardId);
    await renderArchive(true);
  });
  actions.append(forget);
  header.append(actions);
  card.append(header);
  const when = [cardWhen(c), c.hosts.slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  card.append(el('p', `when${c.restoredAt ? ' done' : ''}`, c.restoredAt ? `${when} · brought back` : when));
  const details = el('details');
  details.open = open || !!matched;
  details.append(el('summary', undefined, matched ? 'What matched' : 'What was in it'));
  const ul = el('ul');
  for (const t of matched ?? c.tabs) {
    const li = line(t.title, t.host, t.url, t.summary);
    const openBtn = el('button', 'quiet', 'Open');
    openBtn.addEventListener('click', () => void openOne(t.url));
    const fg = el('button', 'quiet', 'Forget this');
    fg.addEventListener('click', async () => {
      fg.disabled = true;
      await forgetTab(c.cardId, t.traceId);
      await renderArchive(true);
    });
    li.append(openBtn, fg);
    ul.append(li);
  }
  details.append(ul);
  card.append(details);
  return card;
}

/** What the list last showed; the periodic refresh redraws only when this changes. */
let archiveShown = '';
/** What is typed in "Find something you put away". */
let query = '';
/** Put-away cards on screen: five more at a time, like the groups above (§6.4). */
let cardsShown = VISIBLE;

/**
 * Redraw "Put away" — every card, newest first, or what a search found, best first. The
 * 20-second refresh (summaries arrive in the background) only redraws when something on it
 * changed, and keeps open "What was in it" lists open — it used to snap them shut and drop the
 * focused button every time.
 */
async function renderArchive(force = false): Promise<void> {
  const cards = await getCards();
  // Read after the await: of two redraws in flight, both show what is typed now.
  const searching = queryTerms(query).length > 0;
  const shown = JSON.stringify([
    searching ? query : '',
    cardsShown,
    cards.map((c) => [c.cardId, c.name, c.restoredAt, undoable(c), cardWhen(c), c.tabs.map((t) => [t.traceId, t.summary])]),
  ]);
  if (!force && shown === archiveShown) return;
  archiveShown = shown;
  const section = $('archive');
  const root = $('cards');
  const open = new Set([...root.querySelectorAll<HTMLElement>('[data-card]')].filter((s) => s.querySelector('details')?.open).map((s) => s.dataset.card));
  root.replaceChildren();
  section.hidden = cards.length === 0;
  const list = searching ? searchArchive(cards, query) : cards.map((card) => ({ card, tabs: card.tabs, whole: true }));
  if (searching && list.length === 0) root.append(el('p', 'empty', 'Nothing put away matches that.'));
  for (const h of list.slice(0, cardsShown)) root.append(archiveCard(h.card, open.has(h.card.cardId), h.whole ? undefined : h.tabs));
  $('cards-more').hidden = list.length <= cardsShown;
}

/** A search box behaves like one: results as you type, "/" to get to it from anywhere on the page. */
function wireSearch(): void {
  const find = $<HTMLInputElement>('find');
  let pending: ReturnType<typeof setTimeout> | undefined;
  const onFind = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      query = find.value;
      cardsShown = VISIBLE;
      void renderArchive(true);
    }, 120);
  };
  find.addEventListener('input', onFind);
  find.addEventListener('search', onFind); // Escape and the clear button
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || $('archive').hidden) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    find.focus();
  });
  $('cards-more-btn').addEventListener('click', () => {
    cardsShown += VISIBLE;
    void renderArchive(true);
  });
}

function toast(text: string, cardId?: string): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', 'toast', text);
  t.setAttribute('role', 'status'); // announced by screen readers without stealing focus
  if (cardId) {
    const back = el('button', undefined, 'Bring back');
    back.addEventListener('click', () => void onBringBack(cardId, back));
    t.append(back);
  }
  document.body.append(t);
  // The same Bring back stays under "Put away" for a day, so nothing depends on catching this.
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
  wireSearch();
  try {
    await load();
  } catch (e) {
    console.error(e);
    $('groups').replaceChildren(el('p', 'empty', 'Something went wrong reading your tabs. Reloading this page usually fixes it — nothing has been changed.'));
  }
  void checkRecorder();
  void checkBuild();
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
