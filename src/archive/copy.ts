/**
 * "Keep a copy": everything put away, as one file the person saves where their downloads go —
 * outside the browser, so it outlives an uninstall, a new computer or a profile Chrome resets.
 * (The second copy in backup.ts lives inside the profile and goes with it: it covers a database
 * Chrome replaces, not these.) Pure — no chrome.* — and unit-tested.
 *
 * The file is a web page. Opened in any browser it lists every card, each tab a link to its page,
 * no extension needed; the same records ride along as JSON, which "Bring in a copy" reads back.
 * Titles and addresses come from the web, so they are written as text, never as markup; links
 * are http(s) only; and the page forbids itself every script in its own Content-Security-Policy.
 *
 * Reading one back trusts nothing in it: every field is checked and clipped, an address must be
 * http(s), a card never arrives undoable (Bring back is for the records of this browser), and the
 * never-remember list here holds for whatever comes in (§6.10).
 */
import { urlFeatures } from '../collector/url';
import { dominantHost, restoreOrder } from './card';
import { isNeverRemembered, namesNeverSite, normaliseDomain } from './forget';
import { GROUP_COLORS, type ArchiveCard, type ArchivedTab, type GroupColor } from './types';

const KIND = 'tab-amnesty-copy';
const VERSION = 1;
/** A card is a few kilobytes; a file this big is not a copy. */
export const MAX_COPY_BYTES = 100 * 1024 * 1024;
const MAX_CARDS = 100_000;
const MAX_TABS = 2_000;

export interface Copy {
  kind: typeof KIND;
  version: number;
  savedAt: number;
  cards: ArchiveCard[];
  neverRemember: string[];
}

/** "tab-amnesty-put-away-2026-10-17.html", by the person's own calendar. */
export function copyFileName(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `tab-amnesty-put-away-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.html`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const isWeb = (url: string) => /^https?:\/\//i.test(url);

const STYLE = `
:root { color-scheme: light dark; --bg: #fbfaf7; --fg: #23211d; --muted: #7a756b; --card: #ffffff; --line: #e8e4db; --link: #4a6fa5; }
@media (prefers-color-scheme: dark) { :root { --bg: #1b1a18; --fg: #ebe8e1; --muted: #9a958a; --card: #242320; --line: #37352f; --link: #8fb0e0; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.lede, .never, .empty { color: var(--muted); }
.lede { margin: 0 0 20px; }
section { background: var(--card); border: 1px solid var(--line); border-left-width: 5px; border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; }
h2 { font-size: 16px; font-weight: 600; margin: 0; }
.when { color: var(--muted); font-size: 13px; margin: 2px 0 8px; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 3px 0; overflow-wrap: anywhere; }
a { color: var(--link); }
.host { color: var(--muted); font-size: 12px; margin-left: 8px; }
.sum { display: block; color: var(--muted); font-size: 13px; }
.never { font-size: 13px; margin-top: 28px; }
.c-grey { border-left-color: #9aa0a6; } .c-blue { border-left-color: #4a6fa5; } .c-red { border-left-color: #d9534f; }
.c-yellow { border-left-color: #e0b02a; } .c-green { border-left-color: #4f9d69; } .c-pink { border-left-color: #d66fa8; }
.c-purple { border-left-color: #8e6fd6; } .c-cyan { border-left-color: #3aa6b9; } .c-orange { border-left-color: #e08a3a; }
`;

/** The whole file: a page anyone can read, with the records for "Bring in a copy" inside it. */
export function copyToHtml(cards: readonly ArchiveCard[], neverRemember: readonly string[], savedAt: number): string {
  const copy: Copy = { kind: KIND, version: VERSION, savedAt, cards: [...cards], neverRemember: [...neverRemember] };
  const sections = cards.map((c) => {
    const when = [day(c.whenAt ?? c.archivedAt), c.hosts.slice(0, 3).join(', ')].filter(Boolean).join(' · ');
    const items = restoreOrder(c).map((t) => {
      const label = esc(t.title || t.url);
      const link = isWeb(t.url) ? `<a href="${esc(t.url)}">${label}</a>` : label;
      const host = t.host && t.host !== (t.title || t.url) ? `<span class="host">${esc(t.host)}</span>` : '';
      const sum = t.summary ? `<span class="sum">${esc(t.summary)}</span>` : '';
      return `<li>${link}${host}${sum}</li>`;
    });
    return `<section class="c-${colour(c.color)}"><h2>${esc(c.name)}</h2><p class="when">${esc(when)}</p><ul>\n${items.join('\n')}\n</ul></section>`;
  });
  // The records, as data the page never runs: every "<" escaped, so no title can close the element.
  const json = JSON.stringify(copy).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Put away — a copy saved ${esc(day(savedAt))}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Everything you put away</h1>
<p class="lede">A copy Tab Amnesty saved on ${esc(day(savedAt))}. Each link opens its page. To bring all of it back into Tab Amnesty, on this computer or another one: click the Tab Amnesty icon, open “Keep a copy” at the bottom of its page, choose “Bring in a copy…” and pick this file.</p>
${sections.length ? sections.join('\n') : '<p class="empty">Nothing was put away when this copy was saved.</p>'}
${neverRemember.length ? `<p class="never">Sites never remembered: ${esc(neverRemember.join(', '))}</p>` : ''}
<script type="application/json" id="${KIND}">${json}</script>
</main>
</body>
</html>
`;
}

function colour(c: unknown): GroupColor {
  return GROUP_COLORS.includes(c as GroupColor) ? (c as GroupColor) : 'grey';
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v: unknown, n: number, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map((x) => x.slice(0, max)) : [];

function readTab(v: unknown, i: number): ArchivedTab | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const url = str(o.url, 8192);
  if (!isWeb(url)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  const d = o.digest && typeof o.digest === 'object' ? (o.digest as Record<string, unknown>) : null;
  return {
    traceId: str(o.traceId, 100) || crypto.randomUUID(),
    url,
    title: str(o.title, 1000),
    host: urlFeatures(url).host, // from the address, not from the file
    order: num(o.order) ?? i,
    digest: d ? { description: str(d.description, 500), headings: strings(d.headings, 20, 120), leadText: str(d.leadText, 1000) } : null,
    summary: typeof o.summary === 'string' ? o.summary.slice(0, 2000) : null,
    openedAt: num(o.openedAt) ?? 0,
  };
}

function readCard(v: unknown, now: number): ArchiveCard | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const cardId = str(o.cardId, 100);
  const tabs = (Array.isArray(o.tabs) ? o.tabs.slice(0, MAX_TABS) : []).map(readTab).filter((t): t is ArchivedTab => !!t);
  if (!cardId || tabs.length === 0) return null;
  return {
    cardId,
    name: str(o.name, 60).trim() || 'Put away',
    color: colour(o.color),
    tier: o.tier === 'nano' ? 'nano' : 'heuristic',
    when: str(o.when, 100),
    whenAt: num(o.whenAt),
    hosts: strings(o.hosts, 20, 253),
    archivedAt: num(o.archivedAt) ?? now,
    undoUntil: Math.min(num(o.undoUntil) ?? now, now), // never an undo from a file
    tabs,
    restoredAt: num(o.restoredAt),
    sourceCommunity: num(o.sourceCommunity) ?? 0,
  };
}

/**
 * Read a copy back from a file's text: the page "Keep a copy" saves, or its records on their own.
 * 'newer' when a later Tab Amnesty saved it; null when it is not a copy at all.
 */
export function readCopy(text: string, now = Date.now()): Copy | 'newer' | null {
  const block = /<script\b[^>]*\bid=["']?tab-amnesty-copy["']?[^>]*>([\s\S]*?)<\/script>/i.exec(text);
  const json = block ? block[1]! : text.trimStart().startsWith('{') ? text : null;
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== KIND || typeof o.version !== 'number') return null;
  if (o.version > VERSION) return 'newer';
  const seen = new Set<string>();
  const cards: ArchiveCard[] = [];
  for (const c of (Array.isArray(o.cards) ? o.cards.slice(0, MAX_CARDS) : []).map((x) => readCard(x, now))) {
    if (!c || seen.has(c.cardId)) continue;
    seen.add(c.cardId);
    cards.push(c);
  }
  const neverRemember = [...new Set(strings(o.neverRemember, 10_000, 253).map(normaliseDomain).filter(Boolean))];
  return { kind: KIND, version: VERSION, savedAt: num(o.savedAt) ?? now, cards, neverRemember };
}

/**
 * What of a copy to add here: the cards this browser does not have (what it has is never
 * changed), without any tab on a site never remembered here, and not named after one (§6.10).
 */
export function cardsToBringIn(copy: Copy, have: ReadonlySet<string>, never: readonly string[]): ArchiveCard[] {
  const out: ArchiveCard[] = [];
  for (const c of copy.cards) {
    if (have.has(c.cardId)) continue;
    const kept = c.tabs.map((t) => ({ t, f: urlFeatures(t.url) })).filter(({ f }) => !isNeverRemembered(f, never));
    if (kept.length === 0) continue;
    const tabs = kept.map(({ t }) => t);
    const hosts = c.hosts.filter((h) => !isNeverRemembered({ host: h, eTLD1: h }, never));
    const name = namesNeverSite(c.name, never) ? dominantHost(kept.map(({ f }) => f)) || 'Put away' : c.name;
    out.push({ ...c, tabs, hosts, name });
  }
  return out;
}
