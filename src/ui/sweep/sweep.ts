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
import { cardHosts, cardWhen, undoable } from '../../archive/card';
import { copyFileName, copyToHtml, MAX_COPY_BYTES, readCopy } from '../../archive/copy';
import { betterName, type NamedGroup, quickName, type RememberedName, rememberedName, rememberName } from '../../archive/naming';
import {
  addNeverRemember,
  bringInCopy,
  forgetCard,
  forgetTab,
  getCards,
  getNeverRemember,
  getRememberedNames,
  removeNeverRemember,
  saveRememberedNames,
  siteToNeverRemember,
} from '../../archive/store';
import { fold, queryTerms, searchArchive } from '../../archive/search';
import { archiveAndClose, bringBack, groupOnStrip, openCard, openOne, type StripPlace, ungroupOurs } from '../../archive/sweep';
import type { ArchiveCard, ArchivedTab } from '../../archive/types';
import { cluster } from '../../cluster/cluster';
import { isUnsegmented } from '../../cluster/lexical';
import type { Community, TabTrace } from '../../cluster/types';
import { hasStarted } from '../../collector/consent';
import { getOpenTraces, getTraceByTabId } from '../../collector/db';

/** Groups on screen at once: one button each, five at most (§6.4). */
const VISIBLE = 5;
/** Put-away cards on screen at once: two buttons each, so two, to stay inside five decisions (§6.4). */
const SHELF_STEP = 2;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Someone asked their computer for less motion: everything below then simply changes. */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The page's motion tokens (index.html): ease-out on the way in, ease-in on the way out. */
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

/**
 * A step that cannot be undone asks first (WCAG 3.3.4; .ux-profile.md, rule 5): the first press
 * says what will happen and turns the button into the second step; the second press does it. It
 * goes back after six seconds, or when focus leaves the button.
 */
function confirmFirst(btn: HTMLButtonElement, rest: string, armed: string, warning: () => string, act: () => Promise<void>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    setLabel(btn, rest);
    btn.classList.remove('armed');
  };
  btn.addEventListener('blur', () => timer !== undefined && disarm());
  btn.addEventListener('click', async () => {
    if (timer === undefined) {
      setLabel(btn, armed);
      btn.classList.add('armed');
      say(warning());
      timer = setTimeout(disarm, 6000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    await act();
  });
}

/** One of the page's own line icons (index.html, <symbol id="i-…">), only ever beside words. */
function icon(name: string, cls = 'i'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** A button whose words can change while its icon stays. Its text is exactly its words. */
function button(label: string, cls?: string, iconName?: string): HTMLButtonElement {
  const b = el('button', cls);
  if (iconName) b.append(icon(iconName));
  b.append(el('span', undefined, label));
  return b;
}

function setLabel(b: HTMLButtonElement, label: string): void {
  const words = b.querySelector('span');
  if (words) words.textContent = label;
  else b.textContent = label;
}

/** A group's mark: a small tab in its Chrome tab-group colour (index.html, .swatch). */
const swatch = () => el('span', 'swatch');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A page's site icon, from Chrome's own copy on this computer (the "favicon" permission) — never a
 * request to the site. A page that is not a web page gets the plain page icon.
 */
function favicon(url: string): Element {
  if (!/^https?:/.test(url)) return icon('page', 'i fav');
  const src = new URL(chrome.runtime.getURL('/_favicon/'));
  src.searchParams.set('pageUrl', url);
  src.searchParams.set('size', '32');
  const img = el('img', 'fav');
  img.src = src.href;
  img.alt = '';
  img.width = img.height = 16;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}

/** The icons of a card's first few sites, side by side: what was in it, recognisable while it is shut. */
function siteIcons(tabs: readonly { url: string; host: string }[]): HTMLElement {
  const box = el('span', 'favs');
  box.setAttribute('aria-hidden', 'true');
  const seen = new Set<string>();
  for (const t of tabs) {
    if (seen.size === 4 || seen.has(t.host)) continue;
    seen.add(t.host);
    box.append(favicon(t.url));
  }
  return box;
}

/**
 * `text` with the searched-for words marked where search.ts matched them: at the start of a word,
 * or anywhere in scripts written without spaces. Accents and case are folded the same way.
 */
function marked(text: string, terms: readonly string[]): Node[] {
  if (!terms.length || !text) return [document.createTextNode(text)];
  // Fold one character at a time, so a place in the folded text maps back to the original.
  let folded = '';
  const at: number[] = []; // at[k]: where folded[k] came from in `text`
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
    i += ch.length;
  }
  at.push(text.length);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    const anywhere = [...term].some(isUnsegmented);
    for (let from = folded.indexOf(term); from >= 0; from = folded.indexOf(term, from + 1)) {
      if (anywhere || from === 0 || !/[\p{L}\p{N}]/u.test(folded[from - 1]!)) ranges.push([at[from]!, at[from + term.length]!]);
    }
  }
  if (!ranges.length) return [document.createTextNode(text)];
  ranges.sort((a, b) => a[0] - b[0]);
  const out: Node[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    const start = Math.max(s, pos);
    if (e <= start) continue;
    if (start > pos) out.push(document.createTextNode(text.slice(pos, start)));
    out.push(el('mark', undefined, text.slice(start, e)));
    pos = e;
  }
  if (pos < text.length) out.push(document.createTextNode(text.slice(pos)));
  return out;
}

let lineIds = 0;

function line(title: string, host: string, url: string, summary?: string | null, terms: readonly string[] = []): HTMLLIElement {
  const li = el('li');
  const label = title || url;
  const t = el('span', 't');
  t.append(...marked(label, terms));
  t.id = `line-${++lineIds}`; // a line's own buttons are described by it
  t.title = url;
  li.append(favicon(url), t);
  if (host && host !== label) li.append(el('span', 'host', host)); // a page titled by its own address shows it once
  if (summary) {
    const sum = el('span', 'sum');
    sum.append(...marked(summary, terms));
    li.append(sum);
  }
  return li;
}

/**
 * Change the page in one continuous movement instead of a jump: an element with the same
 * view-transition-name before and after travels between its two places (index.html,
 * ::view-transition rules). Where Chrome is older, or less motion was asked for, it just changes.
 */
async function morph(update: () => Promise<void> | void): Promise<void> {
  if (calm() || !('startViewTransition' in document)) return update();
  const t = document.startViewTransition(async () => {
    await update();
  });
  t.ready.catch(() => {}); // a skipped animation is not an error; the change itself still happens
  t.finished.catch(() => {});
  await t.updateCallbackDone;
}

/** A put-away card's place: the group card takes the same name to travel to it (onArchive). */
const shelfName = (cardId: string) => `card-${cardId}`;

/** A name that improves in place fades in, rather than flickering (transitions.dev, text swap). */
function swapText(e: HTMLElement, text: string): void {
  e.textContent = text;
  if (!calm()) e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE_OUT });
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
  // Most open web tabs adopted rather than seen opening (just after Start): their grouping goes by
  // place and text only, so the page says it gets better. It goes by itself as new tabs replace them.
  const web = traces.filter((t) => /^https?:/.test(t.url));
  $('learning').hidden = web.length === 0 || web.filter((t) => t.backfilled).length * 2 < web.length;

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
    if (h) swapText(h, better.name);
  }
}

function groupCard(g: Group): HTMLElement {
  const card = el('section', `group c-${g.name.color}`);
  card.style.viewTransitionName = `group-${g.community.id}`; // the groups below close up smoothly
  g.el = card;
  const header = el('header');
  const name = el('div', 'name');
  const h = el('h2', undefined, g.name.name);
  h.id = `group-${g.community.id}`;
  name.append(swatch(), h);
  // When, as an event (§6.5), beside the name. The sites are on the lines, each with its icon.
  if (g.name.description.when) name.append(el('span', 'when', cap(g.name.description.when)));
  const btn = button('Archive & close', 'primary', 'archive');
  btn.setAttribute('aria-describedby', h.id); // five "Archive & close" buttons, each says which group
  btn.addEventListener('click', (e) => void onArchive(g, card, btn, e.detail === 0)); // detail 0: Enter or Space
  header.append(name, btn);
  card.append(header);
  const ul = el('ul');
  for (const t of g.members) ul.append(line(t.title, t.host, t.url));
  card.append(ul);
  return card;
}

/** Said in place of a list that has nothing in it, beside a quiet icon. */
function emptyNote(text: string, iconName?: string): HTMLElement {
  const p = el('p', 'empty');
  if (iconName) p.append(icon(iconName));
  p.append(text);
  return p;
}

const PRIVACY_URL = 'https://github.com/Makilesh/Chrome_tab_amnesty/blob/main/PRIVACY.md';

/**
 * The browser's own extensions page, as the person would type it: Tab Amnesty's words name their
 * browser, not Chrome (Edge and Brave open chrome:// addresses too, but call them their own).
 */
function extensionsPage(): string {
  if (/\bEdg\//.test(navigator.userAgent)) return 'edge://extensions';
  return 'brave' in navigator ? 'brave://extensions' : 'chrome://extensions';
}

/**
 * Asked first (collector/consent.ts): until the person presses Start nothing is recorded, so in
 * place of groups the page says plainly what Tab Amnesty would note, why, and where it stays —
 * the first screen of a first install. One button; closing the page is the other answer.
 */
function startNotice(): HTMLElement {
  const box = el('section', 'start');
  const h = el('h2', undefined, 'Before Tab Amnesty starts');
  h.id = 'start-title';
  box.setAttribute('aria-labelledby', h.id);
  const notes = el('ul');
  for (const what of [
    'its address and title',
    'which tab it came from, and when you switch to it',
    'a short digest of the page: its description, headings and opening text',
    'whether a box you typed in still holds unsent text (yes or no, never the text)',
  ]) notes.append(el('li', undefined, what));
  const go = button('Start grouping my tabs', 'primary');
  go.id = 'start';
  go.addEventListener('click', () => void onStart(go));
  const why = el('a', undefined, 'What it keeps, and why');
  why.href = PRIVACY_URL;
  why.target = '_blank';
  why.rel = 'noopener';
  const row = el('div', 'row');
  row.append(go, why);
  box.append(
    h,
    el('p', undefined, 'To group your tabs by what you were doing, Tab Amnesty notes, for each tab:'),
    notes,
    el('p', undefined, 'It all stays on this computer. Nothing is sent anywhere, there is no account, and you can forget anything at any time.'),
    row,
    el('p', 'aside', 'Rather not? Close this page: nothing is noted until you press Start.'),
  );
  return box;
}

async function onStart(btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  setLabel(btn, 'Starting…');
  const r = (await chrome.runtime.sendMessage({ type: 'start' }).catch(() => null)) as { ok?: boolean } | null;
  if (!r?.ok) {
    btn.disabled = false;
    setLabel(btn, 'Start grouping my tabs');
    toast(`Tab Amnesty could not start. Switch it off and on again in ${extensionsPage()}, then press Start again.`);
    return;
  }
  await morph(load);
  say('Started. Your open tabs are below, grouped by what you were doing.');
  focusHeading($('groups').querySelector<HTMLElement>('.group h2') ?? $('groups').querySelector<HTMLElement>('.empty'));
  void checkRecorder();
}

function renderGroups(): void {
  const root = $('groups');
  root.replaceChildren();
  if (groups.length === 0) root.append(emptyNote('Nothing to put away yet — this page fills in as you browse.', 'rest'));
  for (const g of groups.slice(0, shown)) root.append(groupCard(g));
  $('more').hidden = groups.length <= shown;
  $('strip').hidden = groups.length === 0; // nothing to show on the tab strip
}

function quoted(t: TabTrace): string {
  const s = (t.title || t.host).trim();
  return `“${s.length > 48 ? `${s.slice(0, 47)}…` : s}”`;
}

async function onArchive(g: Group, card: HTMLElement, btn: HTMLButtonElement, keyboard = false): Promise<void> {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  setLabel(btn, 'Putting away…');
  try {
    const d = g.name.description;
    const { card: saved, keptOpen } = await archiveAndClose(g.community, g.members, g.name, d.when, d.hosts, d.whenAt);
    // The card itself travels down onto the shelf, into its new place there: closing is seen to
    // be putting away, not losing (the thesis — close it, you'll still have it).
    if (saved) card.style.viewTransitionName = shelfName(saved.cardId);
    const at = groups.indexOf(g); // where the next group will stand
    await morph(async () => {
      groups = groups.filter((x) => x !== g);
      card.remove();
      renderGroups();
      await renderArchive();
    });
    const kept = keptOpen.length
      ? ` Left open, because you typed something in ${keptOpen.length === 1 ? 'it' : 'them'}: ${keptOpen.map(quoted).join(', ')}.`
      : '';
    if (saved) toast(`Put away “${saved.name}”.${kept}`, { cardId: saved.cardId, name: saved.name, ok: true });
    else if (keptOpen.length) toast(`Nothing put away.${kept}`);
    // Keyboard users keep their place on the next group's name — the one that moved up into this
    // one's place, or the one before if this was the last — not its button, where a second Enter
    // would put that group away too. (It used to be the first group: the page jumped to the top.)
    // The view follows only a keyboard user; a mouse user stays where they are and sees the card land.
    const heads = $('groups').querySelectorAll<HTMLElement>('.group h2');
    focusHeading(heads[Math.min(at, heads.length - 1)], keyboard) || $<HTMLButtonElement>('strip').focus({ preventScroll: true });
  } catch (e) {
    btn.disabled = false;
    setLabel(btn, 'Archive & close');
    card.append(failure('That did not work. Try again in a moment.', e, 'p'));
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
  const parts = [error ? 'Your browser did not let every group onto your tab strip. Nothing was closed.' : 'Done — these groups are on your tab strip. Nothing was closed.'];
  if (leftInPlace) parts.push('Tabs you had already grouped were left where they were.');
  if (locked) parts.push(`Your browser keeps ${locked === 1 ? 'one of these' : 'some of these'} locked as a saved group.`);
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
async function onBringBack(cardId: string, button: HTMLButtonElement, name: string): Promise<void> {
  button.disabled = true;
  const r = await bringBack(cardId);
  if (!r.ok && r.reason) toast(r.reason);
  else {
    document.querySelector('.toast')?.remove();
    say(`“${name}” is back on your tab strip.`);
  }
  await morph(() => renderArchive(true, { cardId, label: 'Open all' }));
}

/** Forget is for good, so the first press asks and the second forgets (confirmFirst). */
function forgetButton(what: string, forget: () => Promise<void>, describedBy: string): HTMLButtonElement {
  const btn = el('button', 'quiet', 'Forget this');
  btn.setAttribute('aria-describedby', describedBy);
  confirmFirst(btn, 'Forget this', 'Forget for good', () => `Press again to forget ${what}. This can't be undone.`, async () => {
    await forget();
    say(`Forgot ${what}.`);
  });
  return btn;
}

/** Open a whole card again, any time after its day; the tabs land at the end of the strip, behind this page. */
async function onOpenAll(c: ArchiveCard, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    await openCard(c);
    toast(`“${c.name}” is open again, at the end of your tab strip.`, { ok: true });
  } catch (e) {
    toast('Those tabs could not be opened. Try again in a moment.', { error: e });
  } finally {
    button.disabled = false;
  }
}

/**
 * One put-away card. `matched`: a search found these of its tabs (not the card itself), so the
 * list is open and holds only them.
 */
function archiveCard(c: ArchiveCard, open: boolean, matched?: ArchivedTab[], terms: readonly string[] = []): HTMLElement {
  const card = el('section', `group c-${c.color}`);
  card.dataset.card = c.cardId;
  card.style.viewTransitionName = shelfName(c.cardId);
  const header = el('header');
  const name = el('div', 'name');
  const h = el('h3');
  h.append(...marked(c.name, terms));
  h.id = `card-${c.cardId}`;
  name.append(swatch(), h);
  header.append(name);
  const actions = el('div', 'actions');
  // One action per card (§6.4): the undo for its first day, then opening it again, as often as wanted.
  if (undoable(c)) {
    const back = button('Bring back', undefined, 'back');
    back.setAttribute('aria-describedby', h.id);
    back.addEventListener('click', () => void onBringBack(c.cardId, back, c.name));
    actions.append(back);
  } else {
    const all = button('Open all', undefined, 'open');
    all.setAttribute('aria-describedby', h.id);
    all.addEventListener('click', () => void onOpenAll(c, all));
    actions.append(all);
  }
  actions.append(
    forgetButton(`“${c.name}”`, async () => {
      await forgetCard(c.cardId);
      await morph(() => renderArchive(true, { cardId: c.cardId }));
    }, h.id),
  );
  header.append(actions);
  card.append(header);
  const when = cap([cardWhen(c), cardHosts(c).slice(0, 3).join(', ')].filter(Boolean).join(' · '));
  const meta = el('p', `when${c.restoredAt ? ' done' : ''}`);
  meta.append(siteIcons(c.tabs), c.restoredAt ? `${when} · brought back` : when);
  card.append(meta);
  const details = el('details');
  details.open = open || !!matched;
  const summary = el('summary', undefined, matched ? 'What matched' : 'What was in it');
  summary.setAttribute('aria-describedby', h.id);
  details.append(summary);
  const ul = el('ul');
  for (const t of matched ?? c.tabs) {
    const li = line(t.title, t.host, t.url, t.summary, terms);
    const lineId = li.querySelector('.t')!.id;
    const openBtn = el('button', 'quiet', 'Open');
    openBtn.setAttribute('aria-describedby', lineId);
    openBtn.addEventListener('click', () => void openOne(t.url));
    const fg = forgetButton(`“${t.title || t.host}”`, async () => {
      await forgetTab(c.cardId, t.traceId);
      await morph(() => renderArchive(true, { cardId: c.cardId, label: 'Open all' }));
    }, lineId);
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
/** Put-away cards on screen, two more at a time (§6.4). */
let cardsShown = SHELF_STEP;

/**
 * Redraw "Put away" — every card, newest first, or what a search found, best first. The
 * 20-second refresh (summaries arrive in the background) only redraws when something on it
 * changed, and keeps open "What was in it" lists open — it used to snap them shut and drop the
 * focused button every time.
 */
async function renderArchive(force = false, keep?: { cardId: string; label?: string }): Promise<void> {
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
  // Where focus was, so a redraw does not drop it to the top of the page (a refresh, a forget).
  const was = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  const target = keep ?? (was ? { cardId: was.closest<HTMLElement>('[data-card]')?.dataset.card ?? '', label: was.textContent ?? undefined } : undefined);
  const order = [...root.querySelectorAll<HTMLElement>('[data-card]')].map((s) => s.dataset.card);
  root.replaceChildren();
  section.hidden = cards.length === 0;
  const list = searching ? searchArchive(cards, query) : cards.map((card) => ({ card, tabs: card.tabs, whole: true }));
  const terms = searching ? queryTerms(query) : [];
  if (searching && list.length === 0) {
    const none = emptyNote('Nothing put away matches that.');
    const clear = el('button', 'quiet', 'Clear the search');
    clear.addEventListener('click', () => {
      const find = $<HTMLInputElement>('find');
      find.value = '';
      find.dispatchEvent(new Event('search')); // as the box's own clear button does
      find.focus();
    });
    none.append(clear);
    root.append(none);
  }
  for (const h of list.slice(0, cardsShown)) root.append(archiveCard(h.card, open.has(h.card.cardId), h.whole ? undefined : h.tabs, terms));
  $('cards-more').hidden = list.length <= cardsShown;
  if (searching && query !== saidFor) say(list.length ? `Best match: “${list[0]!.card.name}”.` : 'Nothing put away matches that.'); // no count (§6.1)
  saidFor = searching ? query : '';
  if (target) refocus(root, target, order.indexOf(target.cardId));
}

/** The query whose result was last said, so a refresh does not say it again. */
let saidFor = '';

/** Focus the same button in the same card, else that card, else the card that took its place, else the search box. */
function refocus(root: HTMLElement, target: { cardId: string; label?: string }, index: number): void {
  const cardEls = [...root.querySelectorAll<HTMLElement>('[data-card]')];
  const card = cardEls.find((s) => s.dataset.card === target.cardId) ?? cardEls[Math.min(Math.max(index, 0), cardEls.length - 1)];
  const buttons = card ? [...card.querySelectorAll<HTMLButtonElement>('header button')] : [];
  const same = buttons.find((b) => b.textContent === target.label) ?? buttons[0];
  (same ?? $<HTMLInputElement>('find')).focus({ preventScroll: true });
}

/**
 * Move to a heading that is not itself focusable (after a step that removed what had focus),
 * scrolling only as far as it takes to see it: never a jump away from where the person is.
 */
function focusHeading(h: HTMLElement | null | undefined, follow = true): boolean {
  if (!h) return false;
  h.tabIndex = -1;
  h.focus({ preventScroll: true });
  if (follow) h.scrollIntoView({ block: 'nearest' });
  return true;
}

/** Said to screen readers through one region that is always there (WCAG 4.1.3). */
function say(text: string): void {
  const s = $('say');
  s.textContent = '';
  requestAnimationFrame(() => (s.textContent = text));
}

/** A search box behaves like one: results as you type. (No single-key shortcut to reach it: WCAG 2.1.4.) */
function wireSearch(): void {
  const find = $<HTMLInputElement>('find');
  let pending: ReturnType<typeof setTimeout> | undefined;
  const onFind = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      query = find.value;
      cardsShown = SHELF_STEP;
      void renderArchive(true);
    }, 120);
  };
  find.addEventListener('input', onFind);
  find.addEventListener('search', onFind); // Escape and the clear button
  $('cards-more-btn').addEventListener('click', async () => {
    const before = cardsShown;
    cardsShown += SHELF_STEP;
    await renderArchive(true);
    focusHeading($('cards').querySelectorAll<HTMLElement>('.group h3')[before]);
  });
}

/**
 * Words sent from the address bar ("ta" and some words, background.ts) as ?find=: they fill the
 * box, so "Put away" is drawn already searching for them. Then they leave this page's address:
 * every tab's address is recorded, and what a person searches for is not kept (DECISIONS
 * 2026-10-17) — the change reaches the record through onUpdated.
 */
function findFromAddress(): string {
  const asked = new URLSearchParams(location.search).get('find')?.trim() ?? '';
  if (asked) {
    query = asked;
    $<HTMLInputElement>('find').value = asked;
  }
  if (location.search) history.replaceState(null, '', location.pathname);
  return asked;
}

/**
 * Came here to find something: "Put away" is brought to the top of the window — the groups stay
 * one scroll above — and the box keeps the focus, so the words can be changed at once.
 */
function showFound(): void {
  $('archive').scrollIntoView({ block: 'start' });
  $<HTMLInputElement>('find').focus({ preventScroll: true });
}

/**
 * A failure, said plainly — what did not happen and what to do — with Chrome's own words one click
 * away for a bug report, never in the sentence (voice/errors: no raw error text in the UI).
 */
function copyDetails(e: unknown): HTMLButtonElement {
  const copy = el('button', 'quiet', 'Copy error details');
  copy.addEventListener('click', () => {
    const details = `Tab Amnesty ${chrome.runtime.getManifest().version}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
    void navigator.clipboard.writeText(details).then(
      () => say('Error details copied.'),
      () => say('Copying did not work.'),
    );
  });
  return copy;
}

function failure(text: string, e: unknown, tag: 'p' | 'span' = 'span'): HTMLElement {
  const box = el(tag, 'note');
  box.append(text, ' ', copyDetails(e));
  return box;
}

/** What just happened, at the bottom of the window. `ok`: it went as asked, said with a check. */
function toast(text: string, opts: { cardId?: string; name?: string; ok?: boolean; error?: unknown } = {}): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', 'toast');
  if (opts.ok) t.append(icon('check'));
  t.append(el('span', undefined, text));
  say(text); // through the page's one status region: a region inserted with its text is not reliably read
  if (opts.cardId) {
    const { cardId, name } = opts;
    const back = el('button', undefined, 'Bring back');
    back.addEventListener('click', () => void onBringBack(cardId, back, name ?? 'It'));
    t.append(back);
  }
  if ('error' in opts) t.append(copyDetails(opts.error));
  document.body.append(t);
  // The same Bring back stays under "Put away" for a day, so nothing depends on catching this.
  setTimeout(() => {
    if (!t.isConnected) return;
    if (calm()) return t.remove();
    t.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px) scale(0.98)' }], { duration: 150, easing: EASE_IN }).finished.then(
      () => t.remove(),
      () => t.remove(),
    );
  }, 12_000);
}

// ---------------------------------------------------------------------------------------------
// Keep a copy
// ---------------------------------------------------------------------------------------------

/** A file from this page goes where the person's downloads go; no permission is needed for that. */
function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function onSaveCopy(): Promise<void> {
  const status = $('copy-status');
  try {
    const now = Date.now();
    const name = copyFileName(now);
    saveFile(name, copyToHtml(await getCards(), await getNeverRemember(), now), 'text/html');
    status.textContent = `Saving “${name}” where your downloads go.`;
  } catch (e) {
    status.replaceChildren(failure('The copy could not be saved. Try again in a moment.', e));
  }
}

/** One copy at a time: two at once would each add the same cards. */
let bringingIn = false;

async function onBringInCopy(file: File): Promise<void> {
  if (bringingIn) return;
  bringingIn = true;
  const status = $('copy-status');
  try {
    if (file.size > MAX_COPY_BYTES) {
      status.textContent = 'That file is too big to be a copy saved by Tab Amnesty.';
      return;
    }
    const copy = readCopy(await file.text().catch(() => ''));
    if (copy === 'newer') {
      status.textContent = 'That copy was saved by a newer Tab Amnesty. Update this one, then bring it in.';
      return;
    }
    if (!copy) {
      status.textContent = 'That file is not a copy saved by Tab Amnesty.';
      return;
    }
    status.textContent = 'Bringing it in…';
    const { added, neverOffered } = await bringInCopy(copy);
    status.replaceChildren(added.length ? 'Done — what that copy had is under “Put away”.' : 'Nothing new to bring in from that copy.');
    if (neverOffered.length) offerNever(status, neverOffered);
    await renderArchive(true);
  } catch (e) {
    status.replaceChildren(failure('That copy could not be brought in. Try again in a moment.', e));
  } finally {
    bringingIn = false;
  }
}

/**
 * The copy's never-remember sites that this browser still remembers, offered and never applied
 * unasked: adding a site forgets what is kept about it here, and a copy brought in changes nothing.
 */
function offerNever(status: HTMLElement, sites: string[]): void {
  const yes = el('button', 'quiet', 'Never remember them here too');
  const warning = () => `Press again to never remember ${sites.join(', ')} here. What was kept about them is forgotten for good.`;
  confirmFirst(yes, 'Never remember them here too', 'Forget them for good', warning, async () => {
    let list = await getNeverRemember();
    for (const d of sites) list = await addNeverRemember(d);
    renderNever(list);
    await renderArchive(true);
    status.replaceChildren(`Never remembered here now: ${sites.join(', ')}.`);
  });
  status.append(` Sites never remembered in that copy but remembered here: ${sites.join(', ')}.`, ' ', yes);
}

// ---------------------------------------------------------------------------------------------
// Never remember
// ---------------------------------------------------------------------------------------------

/**
 * The never-remember box. Something that is not one site gets an example rather than silence; a
 * site asks once before it is added, because adding it forgets what was kept about it
 * (.ux-profile.md, rule 5). Enter in the box works as the button does.
 */
function wireNeverForm(): void {
  const input = $<HTMLInputElement>('never-input');
  const add = $<HTMLButtonElement>('never-add');
  const hint = $('never-hint');
  let armedFor = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    armedFor = '';
    add.textContent = 'Never remember this site';
    add.classList.remove('armed');
  };
  const tell = (text: string) => {
    hint.textContent = text;
    say(text);
  };
  input.addEventListener('input', () => {
    disarm();
    hint.textContent = '';
  });
  $('never-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const site = siteToNeverRemember(input.value);
    if (!site) {
      disarm();
      tell('That is not one site. Enter one like reddit.com.');
      return;
    }
    if (armedFor !== site) {
      disarm();
      armedFor = site;
      add.textContent = 'Forget it and never remember';
      add.classList.add('armed');
      tell(`What Tab Amnesty kept about ${site} will be forgotten for good. Press again to go ahead.`);
      timer = setTimeout(() => {
        disarm();
        hint.textContent = '';
      }, 8000);
      return;
    }
    disarm();
    hint.textContent = '';
    renderNever(await addNeverRemember(site));
    input.value = '';
    say(`${site} is never remembered now.`);
    await renderArchive(true); // lines of the site just left the cards
  });
}

function renderNever(list: string[]): void {
  const ul = $('never-list');
  ul.replaceChildren();
  list.forEach((d, i) => {
    const li = el('li', undefined, d);
    const rm = el('button', 'quiet', 'Remember again');
    rm.setAttribute('aria-label', `Remember ${d} again`);
    rm.addEventListener('click', async () => {
      renderNever(await removeNeverRemember(d));
      const left = [...$('never-list').querySelectorAll('button')];
      (left[i] ?? left[i - 1] ?? $('never-input')).focus();
    });
    li.append(rm);
    ul.append(li);
  });
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  for (const page of document.querySelectorAll('.ext-page')) page.textContent = extensionsPage();
  wireSearch();
  const asked = findFromAddress();
  if (!(await hasStarted().catch(() => true))) {
    $('groups').replaceChildren(startNotice()); // asked first (collector/consent.ts)
    $('strip').hidden = true;
  } else {
    try {
      await load();
    } catch (e) {
      console.error(e);
      $('groups').replaceChildren(el('p', 'empty', 'Something went wrong reading your tabs. Reloading this page usually fixes it — nothing has been changed.'));
    }
    void checkRecorder(); // only once recording is allowed: before Start it is meant to be quiet
  }
  void checkBuild();
  await renderArchive();
  if (asked) showFound();
  renderNever(await getNeverRemember());

  $('strip').addEventListener('click', () => void onStrip());
  $('more-btn').addEventListener('click', () => {
    const before = shown;
    shown += VISIBLE;
    renderGroups();
    focusHeading($('groups').querySelectorAll<HTMLElement>('.group h2')[before]);
  });
  $('copy-save').addEventListener('click', () => void onSaveCopy());
  $('copy-open').addEventListener('click', () => $('copy-file').click());
  $('copy-file').addEventListener('change', () => {
    const input = $<HTMLInputElement>('copy-file');
    const file = input.files?.[0];
    input.value = ''; // so the same file can be chosen again
    if (file) void onBringInCopy(file);
  });
  wireNeverForm();
  // Summaries arrive in the background; refresh the archive now and then to show them.
  setInterval(() => void renderArchive(), 20_000);
}

void main();
