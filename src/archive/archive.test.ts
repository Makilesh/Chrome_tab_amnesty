import { describe, expect, it } from 'vitest';
import type { TabTrace, Transition } from '../cluster/types';
import { whenLabel } from '../cluster/describe';
import { buildCard, cardWhen, colorFor, dominantHost, inStripOrder, restoreOrder, stableHash, undoable } from './card';
import { isNeverRemembered, normaliseDomain } from './forget';
import { inputLanguages, languagesToTry } from './language';
import { clampName, evidence, heuristicName, languageHints, NAME_MEMORY_MAX, namePrompt, NAME_SYSTEM, ownTitle, rememberedName, rememberName, sharedTitleName } from './naming';
import { appendSnapshot, readGate, studySummary } from './study';
import { GROUP_COLORS, UNDO_WINDOW_MS } from './types';

const MIN = 60_000;

function tr(traceId: string, o: Partial<TabTrace> = {}): TabTrace {
  const host = o.host ?? 'a.com';
  return {
    traceId,
    tabId: 0,
    windowId: 1,
    index: 0,
    openerTraceId: null,
    openedAt: 0,
    transition: 'link' as Transition,
    backfilled: false,
    lastActiveAt: null,
    activationCount: 0,
    dwellMs: 0,
    coActive: {},
    url: `https://${host}/`,
    host,
    eTLD1: host,
    pathTokens: [],
    queryKeys: {},
    title: '',
    digest: null,
    digestAt: null,
    pinned: false,
    discarded: false,
    closedAt: null,
    ...o,
  };
}

describe('card', () => {
  it('colour is a stable function of the dominant domain and never grey', () => {
    const a = [tr('1', { host: 'jira.acme.com', eTLD1: 'acme.com' }), tr('2', { host: 'acme.com' }), tr('3', { host: 'x.org' })];
    expect(dominantHost(a)).toBe('acme.com');
    expect(colorFor(a)).toBe(colorFor([tr('9', { host: 'acme.com' })]));
    expect(colorFor(a)).not.toBe('grey');
    expect(GROUP_COLORS).toContain(colorFor(a));
    expect(stableHash('acme.com')).toBe(stableHash('acme.com'));
    expect(stableHash('acme.com')).not.toBe(stableHash('acme.org'));
  });

  it('builds a card with tabs in strip order, undo open for 24 h, nothing closed yet', () => {
    const members = [tr('b', { windowId: 1, index: 5, title: 'B' }), tr('a', { windowId: 1, index: 2, title: 'A' }), tr('c', { windowId: 2, index: 0, title: 'C' })];
    const card = buildCard({ id: 3, traceIds: ['a', 'b', 'c'] }, members, { name: 'Deploy', color: 'blue', tier: 'heuristic' }, 'Tuesday afternoon', ['a.com'], 1000, 'id-1');
    expect(card.tabs.map((t) => t.title)).toEqual(['A', 'B', 'C']);
    expect(card.tabs.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(card.undoUntil).toBe(1000 + UNDO_WINDOW_MS);
    expect(card.restoredAt).toBeNull();
    expect(card.tabs.every((t) => t.summary === null)).toBe(true);
    expect(undoable(card, 1000 + UNDO_WINDOW_MS - 1)).toBe(true);
    expect(undoable(card, 1000 + UNDO_WINDOW_MS)).toBe(false);
    expect(undoable({ ...card, restoredAt: 2000 }, 1500)).toBe(false);
    expect(restoreOrder({ ...card, tabs: [...card.tabs].reverse() }).map((t) => t.title)).toEqual(['A', 'B', 'C']);
    expect(inStripOrder(members).map((t) => t.traceId)).toEqual(['a', 'b', 'c']);
  });
});

describe('when', () => {
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime(); // October 2026, local time

  it('an archived card says its time relative to now, not as it read when archived (§6.5)', () => {
    const card = { when: 'this afternoon', whenAt: at(12, 14) };
    expect(cardWhen(card, at(12, 15, 30))).toBe('this afternoon');
    expect(cardWhen(card, at(13, 10))).toBe('yesterday afternoon');
    const later = cardWhen(card, at(15, 10));
    expect(later).toMatch(/ afternoon$/);
    expect(later).not.toMatch(/^(this|yesterday) /);
    // A card from before the moment was kept keeps the words it was archived with.
    expect(cardWhen({ when: 'this afternoon' }, at(15, 10))).toBe('this afternoon');
  });

  it('says late nights and the small hours the way people do', () => {
    expect(whenLabel(at(12, 23), at(12, 23, 20))).toBe('tonight');
    expect(whenLabel(at(12, 2), at(12, 3))).toBe('early this morning');
    expect(whenLabel(at(12, 23), at(13, 9))).toBe('last night');
    expect(whenLabel(at(12, 2), at(13, 9))).toBe('early yesterday morning');
  });
});

describe('forget', () => {
  it('normalises what a person types', () => {
    expect(normaliseDomain(' https://www.Example.co.uk/path ')).toBe('example.co.uk');
    expect(normaliseDomain('reddit.com')).toBe('reddit.com');
  });
  it('normalises to the host a trace records: no port, login or query; Unicode as punycode', () => {
    expect(normaliseDomain('http://localhost:3000/app')).toBe('localhost');
    expect(normaliseDomain('intranet.corp:8443')).toBe('intranet.corp');
    expect(normaliseDomain('https://user@example.com/')).toBe('example.com');
    expect(normaliseDomain('example.com?x=1')).toBe('example.com');
    expect(normaliseDomain('bücher.de')).toBe('xn--bcher-kva.de');
    expect(normaliseDomain('   ')).toBe('');
    // ...and so they match what the collector records (url.ts takes new URL().hostname).
    expect(isNeverRemembered({ host: 'localhost', eTLD1: 'localhost' }, [normaliseDomain('http://localhost:3000/app')])).toBe(true);
  });
  it('matches the site and its subdomains, not lookalikes', () => {
    const list = ['reddit.com'];
    expect(isNeverRemembered(tr('1', { host: 'old.reddit.com', eTLD1: 'reddit.com' }), list)).toBe(true);
    expect(isNeverRemembered(tr('1', { host: 'reddit.com' }), list)).toBe(true);
    expect(isNeverRemembered(tr('1', { host: 'notreddit.com' }), list)).toBe(false);
    expect(isNeverRemembered(tr('1', { host: 'a.com' }), [])).toBe(false);
  });
});

describe('naming', () => {
  it('clamps to 24 characters at a word boundary and strips quotes', () => {
    expect(clampName('"Flat hunting in Leeds"')).toBe('Flat hunting in Leeds');
    expect(clampName('The deploy incident that ate Tuesday afternoon').length).toBeLessThanOrEqual(24);
    expect(clampName('The deploy incident that ate Tuesday afternoon')).toBe('The deploy incident');
  });

  it('heuristic name is the word the titles share, in the casing the person saw', () => {
    const corpus = [
      tr('1', { host: 'a.com', title: 'AWS Builder Center' }),
      tr('2', { host: 'b.com', title: 'Amazon Web Services (AWS)' }),
      tr('3', { host: 'c.com', title: 'QA role | Acceleration Center | LinkedIn' }),
      tr('4', { host: 'd.com', title: 'Something else entirely' }),
    ];
    const group = corpus.slice(0, 3);
    expect(sharedTitleName(group, corpus)).toBe('AWS');
    const n = heuristicName(group, { heading: 'builder · center', hosts: ['a.com'], when: '', whenAt: null }, corpus);
    expect(n).toEqual({ name: 'AWS', color: colorFor(group), tier: 'heuristic' });
  });

  it('never names a group after a platform; falls back to the heading word, then the site', () => {
    const members = [tr('1', { host: 'github.com', title: 'acme/x | GitHub' }), tr('2', { host: 'github.com', title: 'acme/y | GitHub' })];
    expect(sharedTitleName(members, members)).toBe('acme');
    const bare = [tr('1', { host: 'www.acme.com' }), tr('2', { host: 'www.acme.com' })];
    expect(heuristicName(bare, { heading: 'deploy · rollout', hosts: ['www.acme.com'], when: '', whenAt: null }).name).toBe('Deploy');
    // The site's name, never a bare address.
    expect(heuristicName(bare, { heading: 'www.acme.com', hosts: ['www.acme.com'], when: '', whenAt: null }).name).toBe('Acme');
  });

  describe('names without Gemini Nano (17 Oct: most machines)', () => {
    const none = { heading: 'x.y', hosts: [], when: '', whenAt: null };
    const t = (id: string, host: string, title: string, openedAt = 0, etld1 = host) => tr(id, { host, eTLD1: etld1, title, openedAt });

    it("leaves the site's name out of titles: a Wikivoyage trip is Lisbon, not Travel", () => {
      const g = [
        t('1', 'en.wikivoyage.org', 'Sintra – Travel guide at Wikivoyage', 0, 'wikivoyage.org'),
        t('2', 'en.wikipedia.org', 'Lisbon - Wikipedia', 1, 'wikipedia.org'),
        t('3', 'en.wikivoyage.org', 'Lisbon – Travel guide at Wikivoyage', 2, 'wikivoyage.org'),
        t('4', 'en.wikipedia.org', 'Alfama - Wikipedia', 3, 'wikipedia.org'),
      ];
      expect(ownTitle(g[0]!, g)).toBe('Sintra');
      expect(heuristicName(g, none, g).name).toBe('Lisbon');
    });

    it("names a group after its platform when nearly all of it is there and nothing else covers half", () => {
      const claude = [
        t('1', 'claude.ai', 'Claude Code'),
        t('2', 'claude.ai', 'New session - Claude'),
        t('3', 'claude.ai', 'New session - Claude'),
        t('4', 'claude.ai', 'Sign in - Claude'),
        t('5', 'claude.com', 'Claude in Chrome | Claude by Anthropic'),
        t('6', 'claude.ai', 'Claude in Chrome'),
        t('7', 'claude.ai', 'Claude Code'),
      ];
      expect(heuristicName(claude, none, claude).name).toBe('Claude');
      const gpt = [t('1', 'chatgpt.com', 'ChatGPT'), t('2', 'chatgpt.com', 'ChatGPT'), t('3', 'chatgpt.com', 'ChatGPT'), t('4', 'x.com', 'a post')];
      expect(heuristicName(gpt, none, gpt).name).toBe('ChatGPT'); // as the titles spell it
    });

    it('calls a group of job postings what it is', () => {
      const g = [
        tr('1', { host: 'linkedin.com', eTLD1: 'linkedin.com', title: 'QA Engineer – Associate | PwC', pathTokens: ['jobs', 'view'] }),
        tr('2', { host: 'paypal.eightfold.ai', eTLD1: 'eightfold.ai', title: 'Careers at PayPal' }),
      ];
      expect(heuristicName(g, none, g).name).toBe('Job search');
    });

    it('prefers a pair of words the titles share, and never shows a bare address', () => {
      const ev = [
        t('1', 'wemakedevs.org', 'First Commit | Bharat Builds Tour | WeMakeDevs'),
        t('2', 'luma.com', 'First Commit IRL: Meet the Team · Luma'),
        t('3', 'luma.com', 'Events · Luma'),
      ];
      expect(heuristicName(ev, none, ev).name).toBe('First Commit');
      const gpu = [
        t('1', 'developer.nvidia.com', 'CUDA Toolkit 13.4.2 Downloads | NVIDIA Developer', 0, 'nvidia.com'),
        t('2', 'amazon.in', 'Amazon.in : rtx 5070 ti', 1),
        t('3', 'lenovo.com', 'Lenovo Cart | Lenovo India', 2),
      ];
      const n = heuristicName(gpu, { heading: 'developer.nvidia.com', hosts: ['developer.nvidia.com'], when: '', whenAt: null }, gpu).name;
      expect(n).toBe('CUDA Toolkit 13.4.2'); // the tab the group started from, not "developer.nvidia.com"
    });
  });

  it('the naming prompt asks for what most tabs share, and to tell a group apart from names already given', () => {
    const a = tr('a', { title: 'Lisbon hotels' });
    const b = tr('b', { title: 'Alfama walking tour' });
    const byId = new Map([a, b].map((t) => [t.traceId, t]));
    expect(NAME_SYSTEM).toContain('name what most of the tabs share');
    expect(NAME_SYSTEM).toContain('never name the group after a single tab');
    const plain = namePrompt([a, b], byId);
    expect(plain.text).toBe(evidence([a, b], byId));
    const taken = namePrompt([a, b], byId, ['Porto Trip', 'Job Applications']);
    expect(taken.text).toContain('Names already given to other groups: "Porto Trip", "Job Applications"');
    expect(taken.text).toContain('Do not reuse one');
    expect(NAME_SYSTEM).toContain('no abbreviations');
  });

  it('asks the model in the language of the browser when a model may have it, else English', () => {
    expect(languagesToTry('en-IN')).toEqual(['en']);
    expect(languagesToTry('de-DE')).toEqual(['de', 'en']);
    expect(languagesToTry('ja')).toEqual(['ja', 'en']);
    expect(languagesToTry('hi-IN')).toEqual(['en']); // not offered by Chrome's models: English, never nothing
    expect(languagesToTry('')).toEqual(['en']);
    expect(inputLanguages('fr')).toEqual(['fr', 'en']);
    expect(languageHints('de')).toEqual({
      expectedInputs: [{ type: 'text', languages: ['de', 'en'] }],
      expectedOutputs: [{ type: 'text', languages: ['de'] }],
    });
  });

  it('evidence leads with timing, lineage and switching, never with a judgement', () => {
    const a = tr('a', { openedAt: 0, transition: 'typed', host: 'jira.acme.com', title: 'ACME-1 deploy failing' });
    const b = tr('b', { openedAt: 3 * MIN, openerTraceId: 'a', host: 'github.com', title: 'acme/deploy PR' });
    const c = tr('c', { openedAt: 4 * MIN, openerTraceId: 'a', host: 'acme.com', coActive: { b: 3 } });
    const byId = new Map([a, b, c].map((t) => [t.traceId, t]));
    const e = evidence([a, b, c], byId);
    expect(e).toContain('opened within 4 minutes of each other');
    expect(e).toContain('a typed visit to jira.acme.com');
    expect(e).toContain('2 of them were opened from another tab in the group');
    expect(e).toContain('switched back and forth');
    expect(e).toContain('- ACME-1 deploy failing');
    expect(e).not.toMatch(/hours on|wasted|messy/i);
  });
});

describe('phase 1 study', () => {
  const H = 3_600_000;
  const D = 24 * H;
  const card = (at: number, restoredAt: number | null = null) =>
    ({ ...buildCard({ id: 0, traceIds: ['a'] }, [tr('a')], { name: 'X', color: 'blue', tier: 'heuristic' }, '', [], at, 'c' + at), restoredAt });
  const snaps = (from: number, to: number, open: (t: number) => number) => {
    const out = [];
    for (let t = from; t <= to; t += 6 * H) out.push({ at: t, open: open(t) });
    return out;
  };

  it('exports times and counts only — no names, no URLs', () => {
    const s = studySummary([{ at: 1, open: 40 }], [card(5 * D)], 99);
    expect(JSON.stringify(s)).not.toMatch(/https?:|"X"/);
    expect(s.archives).toEqual([{ archivedAt: 5 * D, tabs: 1, tier: 'heuristic', restoredAt: null }]);
    expect(appendSnapshot(Array.from({ length: 300 }, (_, i) => ({ at: i, open: 1 })), { at: 999, open: 2 }).length).toBe(240);
  });

  it('reads the gate: lower at day 7, not yet readable, or never pressed', () => {
    const first = 10 * D;
    const lower = readGate(studySummary(snaps(first - 3 * D, first + 9 * D, (t) => (t < first ? 120 : 70)), [card(first), card(first + 2 * D, first + 2 * D + H)]));
    expect(lower).toMatchObject({ presses: 2, pressDays: 2, broughtBack: 1, before: 120, day7: 70, lowerAtDay7: true });

    const early = readGate(studySummary(snaps(first - 3 * D, first + 3 * D, () => 100), [card(first)]));
    expect(early.lowerAtDay7).toBeNull();
    expect(early.readableFrom).toBe(first + 8 * D);

    const bounced = readGate(studySummary(snaps(first - 3 * D, first + 9 * D, () => 100), [card(first)]));
    expect(bounced.lowerAtDay7).toBe(false);

    expect(readGate(studySummary(snaps(0, 9 * D, () => 100), [])).pressed).toBe(false);
  });

  it('a press still counts after its card is forgotten: the study keeps the time, nothing else', () => {
    const first = 10 * D;
    const s = studySummary(snaps(first - 3 * D, first + 9 * D, (t) => (t < first ? 120 : 70)), [], 99, [first]);
    expect(readGate(s)).toMatchObject({ presses: 1, pressed: true, firstPress: first, lowerAtDay7: true });
    expect(s.archives).toEqual([{ archivedAt: first, tabs: 0, tier: 'heuristic', restoredAt: null, forgotten: true }]);
    // A press whose card is still there is counted once.
    expect(studySummary([], [card(first)], 99, [first]).archives).toHaveLength(1);
  });

  it('says when waiting cannot help: snapshots run past day 8 but none fell in days 6-8', () => {
    const first = 10 * D;
    // The browser was not opened on days 6-8: snapshots before the press and from day 9 on only.
    const gap = [...snaps(first - 3 * D, first, () => 120), ...snaps(first + 9 * D, first + 10 * D, () => 70)];
    const g = readGate(studySummary(gap, [card(first)]));
    expect(g).toMatchObject({ before: 120, day7: null, lowerAtDay7: null, readableFrom: null });
  });
});

describe('name memory', () => {
  it('a group that is still mostly the same tabs keeps its name; a different group does not', () => {
    let mem = rememberName([], ['a', 'b', 'c', 'd'], 'PayPal Job Search', 1);
    expect(rememberedName(['a', 'b', 'c', 'e'], mem)).toBe('PayPal Job Search'); // 3 of 5 shared
    expect(rememberedName(['a', 'x', 'y', 'z'], mem)).toBeNull(); // 1 of 7 shared
    expect(rememberedName(['a', 'b', 'c', 'd'], mem, ['paypal job search'])).toBeNull(); // already on screen
    mem = rememberName(mem, ['a', 'b', 'c', 'e'], 'PayPal Applications', 2); // same group, renamed: replaces
    expect(mem.map((m) => m.name)).toEqual(['PayPal Applications']);
  });

  it('keeps the newest entries only', () => {
    let mem: ReturnType<typeof rememberName> = [];
    for (let i = 0; i < NAME_MEMORY_MAX + 5; i++) mem = rememberName(mem, [`t${i}`], `Group ${i}`, i);
    expect(mem.length).toBe(NAME_MEMORY_MAX);
    expect(mem[0]!.name).toBe(`Group ${NAME_MEMORY_MAX + 4}`);
  });
});

