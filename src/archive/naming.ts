/**
 * Group naming — the only model call in the product, one per community, never per tab.
 *
 * Tiers (§7 Phase 1): on-device Gemini Nano via the Prompt API when `availability()` says so;
 * otherwise the heuristic (highest-IDF shared tokens or the dominant domain). Nothing leaves the
 * machine in either tier. The model is fed the *evidence* for the grouping — timing, what was
 * typed first, what got switched between — not just a title list, because a bare title list
 * produces "Various Development Resources".
 *
 * `evidence()` and `heuristicName()` are pure and unit-tested; `nanoName()` touches the browser.
 */
import { urlFeatures } from '../collector/url';
import { colorFor, restoreOrder } from './card';
import { namesNeverSite } from './forget';
import { inputLanguages, languagesToTry } from './language';
import { type ArchiveCard, type ArchivedTab, GROUP_COLORS, type GroupColor, type GroupName, MAX_NAME_CHARS } from './types';
import { describe, type Description } from '../cluster/describe';
import { STOP } from '../cluster/lexical';
import { timingKnown } from '../cluster/segment';
import type { Community, TabTrace } from '../cluster/types';

// --- evidence --------------------------------------------------------------------------------

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** A short factual account of why these tabs are one group. Titles last, evidence first. */
export function evidence(members: TabTrace[], byId: Map<string, TabTrace>): string {
  const lines: string[] = [];
  const timed = members.filter(timingKnown).sort((a, b) => a.openedAt - b.openedAt);
  if (timed.length >= 2) {
    const span = timed[timed.length - 1]!.openedAt - timed[0]!.openedAt;
    lines.push(`${timed.length === members.length ? 'All' : timed.length} of these tabs were opened within ${minutes(span)} of each other.`);
  }
  const first = timed[0];
  if (first) {
    const how = first.transition === 'typed' ? 'a typed visit to' : first.transition === 'link' ? 'a link to' : 'a visit to';
    lines.push(`It started with ${how} ${first.host}${first.title ? ` ("${first.title.slice(0, 60)}")` : ''}.`);
  }
  const ids = new Set(members.map((t) => t.traceId));
  const chained = members.filter((t) => t.openerTraceId && ids.has(t.openerTraceId)).length;
  if (chained > 0) lines.push(`${chained} of them were opened from another tab in the group.`);
  const switches = members.reduce((n, t) => n + Object.entries(t.coActive).filter(([o]) => ids.has(o)).reduce((s, [, c]) => s + c, 0), 0);
  if (switches >= 2) lines.push('The person switched back and forth between these tabs.');
  const hosts = [...new Set(members.map((t) => t.host))];
  lines.push(`Sites: ${hosts.slice(0, 6).join(', ')}${hosts.length > 6 ? ', …' : ''}.`);
  lines.push('Tabs:');
  for (const t of members.slice(0, 12)) {
    const desc = t.digest?.description ? ` — ${t.digest.description.slice(0, 80)}` : '';
    lines.push(`- ${t.title.slice(0, 80) || t.url}${desc}`);
  }
  if (members.length > 12) lines.push('- …');
  void byId;
  return lines.join('\n');
}

// --- heuristic tier --------------------------------------------------------------------------

/** First letter of each word up, in any script ("école" -> "École", not "éCole"). */
function titleCase(s: string): string {
  return s.replace(/(^|[^\p{L}\p{M}\p{N}'’])(\p{L})/gu, (_, before: string, c: string) => before + c.toLocaleUpperCase());
}

export function clampName(s: string): string {
  const cleaned = s.replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s.]+$/g, '').trim();
  if (cleaned.length <= MAX_NAME_CHARS) return cleaned;
  const cut = cleaned.slice(0, MAX_NAME_CHARS);
  const sp = cut.lastIndexOf(' ');
  return (sp > 8 ? cut.slice(0, sp) : cut).trim();
}

/**
 * Platforms whose name says where, not what. A group is named after one only when nearly all of
 * it is there and its tabs share nothing better: a dozen Claude conversations are "Claude", but a
 * project that happens to live on GitHub is named for the project.
 */
const PLATFORM = new Set([
  'github', 'gitlab', 'google', 'gmail', 'docs', 'drive', 'notion', 'linkedin', 'luma', 'youtube',
  'reddit', 'wikipedia', 'stackoverflow', 'stack', 'overflow', 'medium', 'twitter', 'facebook',
  'instagram', 'chatgpt', 'claude', 'gemini', 'perplexity', 'amazon', 'search', 'results', 'login',
  'sign', 'account', 'create', 'untitled', 'new', 'tab', 'home', 'page', 'welcome', 'dashboard',
]);
/** Letters, combining marks (Indic vowel signs) and digits — a word in any script. */
const TITLE_WORD = /[\p{L}\p{M}\p{N}]{3,}/gu;
/** What sites put between a page's own title and their name: "Lisbon – Travel guide at Wikivoyage". */
const SEPARATOR = /\s+[|·•–—:-]\s+|\s*[|·•]\s*/u;

const isWordKey = (k: string) => !STOP.has(k) && !/^\p{N}+$/u.test(k);

/** The registrable domain's own word: "wikipedia" for en.wikipedia.org. */
function siteWord(t: Pick<TabTrace, 'host' | 'eTLD1'>): string {
  return ((t.eTLD1 || t.host || '').replace(/^www\./, '').split('.')[0] ?? '').toLowerCase();
}

/** Per host, the first or last title pieces its pages repeat ("Python 3.15.0 documentation"). */
const repeatedCache = new WeakMap<TabTrace[], Map<string, Set<string>>>();
function repeatedEnds(corpus: TabTrace[]): Map<string, Set<string>> {
  let m = repeatedCache.get(corpus);
  if (!m) {
    const counts = new Map<string, Map<string, number>>();
    for (const t of corpus) {
      const parts = t.title.split(SEPARATOR).map((p) => p.trim().toLowerCase()).filter(Boolean);
      if (parts.length < 2) continue;
      const per = counts.get(t.host) ?? new Map<string, number>();
      for (const p of new Set([parts[0]!, parts[parts.length - 1]!])) per.set(p, (per.get(p) ?? 0) + 1);
      counts.set(t.host, per);
    }
    m = new Map([...counts].map(([host, per]) => [host, new Set([...per].filter(([, n]) => n >= 2).map(([p]) => p))]));
    repeatedCache.set(corpus, m);
  }
  return m;
}

/**
 * A page's own title, without the site's name around it: a first or last piece that names the
 * site ("Lisbon - Wikipedia", "Amazon.in : rtx 5070 ti") or that the site's other titles repeat.
 * Those pieces are shared by every tab on the site — they named the walkthrough's Lisbon trip
 * "Travel" (Wikivoyage's "Travel guide").
 */
export function ownTitle(t: Pick<TabTrace, 'title' | 'host' | 'eTLD1'>, corpus: TabTrace[] = []): string {
  const parts = t.title.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return t.title;
  const word = siteWord(t);
  const repeated = repeatedEnds(corpus).get(t.host) ?? new Set<string>();
  const isSite = (p: string) => (word.length >= 3 && p.toLowerCase().includes(word)) || repeated.has(p.toLowerCase());
  let lo = 0;
  let hi = parts.length;
  if (isSite(parts[hi - 1]!)) hi--;
  if (hi - lo > 1 && isSite(parts[lo]!)) lo++;
  return parts.slice(lo, hi).join(' ');
}

/**
 * The words of a title (lower-cased key -> the casing the person saw), and its adjacent word pairs
 * ("First Commit"): a pair is not a coincidence the way two unrelated shared words are.
 */
function titleTerms(own: string): Map<string, string> {
  const out = new Map<string, string>();
  // Every run of letters, so a pair is two words that really stand together: "Claude in Chrome"
  // has no pair, and "Claude Chrome" is not a phrase anyone wrote.
  const runs = own.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const word = (w: string | undefined) => !!w && w.length >= 3 && isWordKey(w.toLowerCase());
  for (let i = 0; i < runs.length; i++) {
    const w = runs[i]!;
    if (!word(w)) continue;
    const k = w.toLowerCase();
    if (!PLATFORM.has(k) && !out.has(k)) out.set(k, w);
    const next = runs[i + 1];
    if (!word(next)) continue;
    const k2 = next!.toLowerCase();
    if (!(PLATFORM.has(k) && PLATFORM.has(k2))) out.set(`${k} ${k2}`, `${w} ${next}`);
  }
  return out;
}

/** Title-term document frequency, once per corpus array (see describe.ts, same reason). */
const titleDfCache = new WeakMap<TabTrace[], Map<string, number>>();
function titleDf(corpus: TabTrace[]): Map<string, number> {
  let df = titleDfCache.get(corpus);
  if (!df) {
    df = new Map<string, number>();
    for (const t of corpus) for (const k of titleTerms(ownTitle(t, corpus)).keys()) df.set(k, (df.get(k) ?? 0) + 1);
    titleDfCache.set(corpus, df);
  }
  return df;
}

/**
 * What the group's own titles share that the rest of the browser does not: count in the group
 * times IDF over all open titles, in the casing the person saw; a word pair beats its words on a
 * tie. `n` is how many tabs share it.
 */
function bestShared(members: TabTrace[], corpus: TabTrace[]): { form: string; n: number } | null {
  const df = titleDf(corpus);
  const inGroup = new Map<string, { n: number; form: string }>();
  for (const t of members) {
    for (const [k, form] of titleTerms(ownTitle(t, corpus))) {
      const cur = inGroup.get(k);
      inGroup.set(k, { n: (cur?.n ?? 0) + 1, form: cur?.form ?? form });
    }
  }
  const size = corpus.length;
  const ranked = [...inGroup.entries()]
    .filter(([, v]) => v.n >= 2)
    .map(([k, v]) => ({ ...v, pair: k.includes(' '), score: v.n * (Math.log((size + 1) / ((df.get(k) ?? 0) + 1)) + 1) }))
    .sort((a, b) => b.score - a.score || Number(b.pair) - Number(a.pair));
  return ranked[0] ?? null;
}

export function sharedTitleName(members: TabTrace[], corpus: TabTrace[]): string {
  return bestShared(members, corpus)?.form ?? '';
}

/** A word as the group's titles spell it most often ("ChatGPT", not one tweet's "CHATGPT"), if they do. */
function seenForm(word: string, members: TabTrace[]): string | undefined {
  const forms = new Map<string, number>();
  for (const t of members) for (const w of t.title.match(TITLE_WORD) ?? []) if (w.toLowerCase() === word) forms.set(w, (forms.get(w) ?? 0) + 1);
  return [...forms].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** The platform at least 70 % of the group is on, spelt as its titles spell it. */
function dominantPlatform(members: TabTrace[]): string | null {
  const counts = new Map<string, number>();
  for (const t of members) {
    const w = siteWord(t);
    if (PLATFORM.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 0.7 * members.length) return null;
  return seenForm(top[0], members) ?? titleCase(top[0]);
}

const JOB_HOSTS =
  /(^|\.)(greenhouse\.io|lever\.co|smartrecruiters\.com|myworkdayjobs\.com|eightfold\.ai|ashbyhq\.com|workable\.com|naukri\.com|wellfound\.com|instahyre\.com|cutshort\.io|foundit\.in|amazon\.jobs|iimjobs\.com|hirist\.tech|indeed\.[a-z.]+|glassdoor\.[a-z.]+)$/;
/**
 * A job posting or application: a job board, a careers or jobs site, a site's own /jobs or
 * /careers pages, or a title that says so in so many words. A lone "job" or "jobs" is not enough:
 * Jenkins (/job/deploy), GitHub Actions (/runs/1/job/2), GitLab (/-/jobs/3) and "Steve Jobs" all
 * have one, and naming someone's deploy "Job search" characterises it (§6.6).
 */
function looksLikeJob(t: TabTrace): boolean {
  const host = (t.host ?? '').toLowerCase();
  const first = (t.pathTokens ?? [])[0]?.toLowerCase() ?? '';
  return (
    JOB_HOSTS.test(host) ||
    /^(careers?|jobs)\./.test(host) ||
    /^(careers?|jobs)$/.test(first) ||
    /\b(careers at|job application|(is|are|we're|we are) hiring)\b/i.test(t.title)
  );
}

/** The own title of the tab the group started from ("Lenovo Cart", "CUDA Toolkit 13.4.2"). */
function rootTitle(members: TabTrace[], corpus: TabTrace[]): string {
  const root = [...members].sort((a, b) => a.openedAt - b.openedAt)[0];
  return root ? ownTitle(root, corpus).trim() : '';
}

/**
 * Heuristic tier, for every browser without Gemini Nano (most of them): mostly job postings ->
 * "Job search"; else what the tabs' own titles share; a platform's name when nearly all of the
 * group is there and what they share is a plain word that covers under half of it ("session" in a
 * dozen Claude tabs — a proper name like "VoidAlgo" keeps its group); else the x-ray heading's
 * first word; else the own title of the tab the group started from; else the site's name, never a
 * bare address. Everything here runs with the AI APIs absent.
 */
export function heuristicName(members: TabTrace[], d: Description, corpus: TabTrace[] = members): GroupName {
  const done = (name: string): GroupName => ({ name: clampName(name) || 'Untitled', color: colorFor(members), tier: 'heuristic' });
  const jobs = members.filter(looksLikeJob).length;
  if (jobs >= 2 && jobs >= members.length / 2) return done('Job search');
  const shared = bestShared(members, corpus);
  const platform = dominantPlatform(members);
  // A shared term outranks the platform only as a proper name of its own — not a plain word, and
  // not the platform's name with a word added ("Claude Code" among a dozen Claude tabs).
  const plain = !!shared && (shared.form === shared.form.toLowerCase() || (!!platform && shared.form.toLowerCase().split(' ').includes(platform.toLowerCase())));
  if (platform && (!shared || (plain && shared.n < members.length / 2))) return done(platform);
  if (shared) return done(shared.form);
  if (d.heading.includes(' · ') || !d.heading.includes('.')) {
    const first = (d.heading.split(' · ')[0] ?? '').trim();
    if (first) return done(seenForm(first.toLowerCase(), members) ?? titleCase(first));
  }
  const fromRoot = rootTitle(members, corpus);
  if (fromRoot) return done(fromRoot);
  const top = members.find((t) => t.host === d.hosts[0]) ?? members[0];
  const site = top ? siteWord(top) : '';
  return done(site ? (seenForm(site, members) ?? titleCase(site)) : 'Untitled');
}

// --- on-device tier --------------------------------------------------------------------------

export const NAME_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: MAX_NAME_CHARS },
    color: { type: 'string', enum: [...GROUP_COLORS] },
  },
  required: ['name', 'color'],
  additionalProperties: false,
};

export const NAME_SYSTEM =
  'You name groups of browser tabs for the person who opened them. A group is one thing they were doing — ' +
  'a task, an errand, a piece of research — not a topic. Answer with a short, specific name (at most 24 ' +
  'characters) in the language of the tabs, the kind of name the person would recognise at a glance. ' +
  'Use plain words, no abbreviations, and keep the place, product or subject when there is one. ' +
  'If a few tabs do not fit with the rest, name what most of the tabs share — never name the group after ' +
  'a single tab. Never describe the person or judge what they did. Pick the colour that fits the group.';

/** Sampling the extension asks for; some Chrome versions refuse it outside extensions — then defaults. */
export const NAME_SAMPLING = { temperature: 0.3, topK: 3 } as const;

/**
 * The exact prompt for one group — used by the extension and by tools/judge-nano.ts, so a
 * measurement of names measures what users get. `taken`: names already given to other groups in
 * this sweep; the model is told to tell this one apart (two trips are "Lisbon Trip" and "Porto
 * Trip", not "Trip Planning" twice).
 */
export function namePrompt(members: TabTrace[], byId: Map<string, TabTrace>, taken: string[] = []): { system: string; text: string; schema: object } {
  let text = evidence(members, byId);
  if (taken.length) {
    text += `\nNames already given to other groups: ${taken.map((n) => `"${n}"`).join(', ')}. Do not reuse one. Only if this group is about the same thing as one of those, add what makes it different, such as a place, a product or a person; otherwise name it on its own terms.`;
  }
  return { system: NAME_SYSTEM, text, schema: NAME_SCHEMA };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The language hints for one name request — the same for `availability()` and `create()`. */
export function languageHints(lang: string): Pick<LanguageModelCreateOptions, 'expectedInputs' | 'expectedOutputs'> {
  return {
    expectedInputs: [{ type: 'text', languages: inputLanguages(lang) }],
    expectedOutputs: [{ type: 'text', languages: [lang] }],
  };
}

/** The language the model can name groups in on this machine, or null when it cannot here. */
export async function nanoLanguage(ui?: string): Promise<string | null> {
  if (typeof LanguageModel === 'undefined') return null;
  for (const lang of languagesToTry(ui)) {
    try {
      if ((await LanguageModel.availability(languageHints(lang))) === 'available') return lang;
    } catch {
      // this Chrome refuses that language; try the next
    }
  }
  return null;
}

/**
 * One prompt per community. Returns null when the model is unavailable, answers badly, or — even
 * after being told — repeats a name another group already has (the heuristic name, which differs,
 * is kept instead: two cards with one name are worse than one plainer name).
 */
export async function nanoName(
  members: TabTrace[],
  byId: Map<string, TabTrace>,
  fallbackColor: GroupColor,
  taken: string[] = [],
): Promise<GroupName | null> {
  const lang = await nanoLanguage();
  if (!lang) return null;
  const { system, text, schema } = namePrompt(members, byId, taken);
  let session: LanguageModelSession | null = null;
  try {
    const base = { initialPrompts: [{ role: 'system' as const, content: system }], ...languageHints(lang) };
    session = await LanguageModel!.create({ ...base, ...NAME_SAMPLING }).catch(() => LanguageModel!.create(base));
    const parsed = JSON.parse(await session.prompt(text, { responseConstraint: schema })) as { name?: unknown; color?: unknown };
    const name = typeof parsed.name === 'string' ? clampName(parsed.name) : '';
    if (!name || taken.some((t) => sameName(t, name))) return null;
    const color = (GROUP_COLORS as readonly string[]).includes(parsed.color as string) ? (parsed.color as GroupColor) : fallbackColor;
    return { name, color, tier: 'nano' };
  } catch {
    return null;
  } finally {
    session?.destroy();
  }
}

export type NamedGroup = GroupName & { description: Description };

/** Instant name for a community: the heuristic tier, no model call. Shown first (§6.3). */
export function quickName(community: Community, byId: Map<string, TabTrace>, corpus: TabTrace[]): NamedGroup {
  const members = community.traceIds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
  const description = describe(community, byId, corpus);
  return { ...heuristicName(members, description, corpus), description };
}

/**
 * The on-device upgrade of a quick name, or null to keep it. Colour always stays the stable-hash
 * one so a project keeps it across sweeps (DECISIONS 2026-09-19). `taken`: names other groups
 * already got from the model in this sweep.
 */
export async function betterName(
  community: Community,
  byId: Map<string, TabTrace>,
  quick: NamedGroup,
  taken: string[] = [],
): Promise<NamedGroup | null> {
  const members = community.traceIds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
  const nano = await nanoName(members, byId, quick.color, taken);
  return nano ? { ...nano, color: quick.color, description: quick.description } : null;
}

/** The name for a community: Nano if it can, the heuristic otherwise. Always returns something. */
export async function nameGroup(community: Community, byId: Map<string, TabTrace>, corpus: TabTrace[], taken: string[] = []): Promise<NamedGroup> {
  const quick = quickName(community, byId, corpus);
  return (await betterName(community, byId, quick, taken)) ?? quick;
}

// --- name memory -------------------------------------------------------------------------------

/**
 * A project keeps its name across sweeps, the way it keeps its colour: the model's name for a group
 * is remembered with the group's tabs and reused while the group is still mostly those tabs. Model
 * names vary from run to run (measured: only 15 of 39 groups got the same name twice), and a card
 * that renames itself on every visit is not recognisable at a glance (§6.3).
 */
export interface RememberedName {
  members: string[];
  name: string;
  at: number;
}

export const NAME_MEMORY_MAX = 200;
/** Share of tabs in common (Jaccard) for "still the same group". */
export const SAME_GROUP = 0.5;

function jaccard(a: readonly string[], b: ReadonlySet<string>): number {
  if (a.length === 0 && b.size === 0) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.length + b.size - both);
}

/** The remembered name of the most similar earlier group (>= SAME_GROUP), unless already used in this sweep. */
export function rememberedName(members: readonly string[], memory: readonly RememberedName[], taken: readonly string[] = []): string | null {
  const ids = new Set(members);
  let best: RememberedName | null = null;
  let bestScore = SAME_GROUP;
  for (const m of memory) {
    const score = jaccard(m.members, ids);
    if (score >= bestScore && !taken.some((t) => t.trim().toLowerCase() === m.name.trim().toLowerCase())) {
      best = m;
      bestScore = score;
    }
  }
  return best?.name ?? null;
}

/** Record a group's name: replaces memories of the same group, keeps the newest NAME_MEMORY_MAX. */
export function rememberName(memory: readonly RememberedName[], members: readonly string[], name: string, now = Date.now()): RememberedName[] {
  const ids = new Set(members);
  const rest = memory.filter((m) => jaccard(m.members, ids) < SAME_GROUP);
  return [...rest, { members: [...members], name, at: now }].sort((a, b) => b.at - a.at).slice(0, NAME_MEMORY_MAX);
}

/** An archived line as the namer reads a record: its address's features, its title and page text. */
function asTrace(t: ArchivedTab): TabTrace {
  return {
    traceId: t.traceId, tabId: -1, windowId: 0, index: t.order, openerTraceId: null, openedAt: t.openedAt,
    transition: 'unknown', backfilled: false, lastActiveAt: null, activationCount: 0, dwellMs: 0, coActive: {},
    url: t.url, ...urlFeatures(t.url), title: t.title, digest: t.digest, digestAt: null,
    pinned: false, discarded: false, closedAt: null,
  };
}

/**
 * A card once some of its lines are forgotten (§6.10): the lines go, a site left with no line
 * goes from its sites, and a name that came from what was forgotten — the forgotten page's own
 * title, its site's name, a site never remembered now — is proposed again from what is left
 * (§6.7). A name the remaining lines still carry stays.
 */
export function withoutTabs(card: ArchiveCard, gone: ReadonlySet<string>, never: readonly string[] = []): ArchiveCard {
  const tabs = card.tabs.filter((t) => !gone.has(t.traceId));
  const lost = card.tabs.filter((t) => gone.has(t.traceId));
  if (lost.length === 0) return card;
  const hosts = card.hosts.filter((h) => tabs.some((t) => t.host === h || t.host.endsWith('.' + h)));
  const n = card.name.toLowerCase();
  const carries = (t: ArchivedTab) => t.title.toLowerCase().includes(n) || t.host.toLowerCase().includes(n);
  const fromLost = lost.some(carries) && !tabs.some(carries);
  let name = card.name;
  if (tabs.length && (fromLost || namesNeverSite(card.name, never))) {
    const members = restoreOrder({ ...card, tabs }).map(asTrace);
    const byId = new Map(members.map((m) => [m.traceId, m]));
    const d = describe({ id: 0, traceIds: members.map((m) => m.traceId) }, byId, members);
    name = heuristicName(members, d, members).name;
  }
  return { ...card, tabs, hosts, name };
}
