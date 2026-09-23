import { describe, expect, it } from 'vitest';
import type { TabTrace, Transition } from '../cluster/types';
import { buildCard, colorFor, dominantHost, inStripOrder, restoreOrder, stableHash, undoable } from './card';
import { isNeverRemembered, normaliseDomain } from './forget';
import { clampName, evidence, heuristicName, sharedTitleName } from './naming';
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

describe('forget', () => {
  it('normalises what a person types', () => {
    expect(normaliseDomain(' https://www.Example.co.uk/path ')).toBe('example.co.uk');
    expect(normaliseDomain('reddit.com')).toBe('reddit.com');
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
    const n = heuristicName(group, { heading: 'builder · center', hosts: ['a.com'], when: '' }, corpus);
    expect(n).toEqual({ name: 'AWS', color: colorFor(group), tier: 'heuristic' });
  });

  it('never names a group after a platform; falls back to the heading word, then the site', () => {
    const members = [tr('1', { host: 'github.com', title: 'acme/x | GitHub' }), tr('2', { host: 'github.com', title: 'acme/y | GitHub' })];
    expect(sharedTitleName(members, members)).toBe('acme');
    const bare = [tr('1', { host: 'www.acme.com' }), tr('2', { host: 'www.acme.com' })];
    expect(heuristicName(bare, { heading: 'deploy · rollout', hosts: ['www.acme.com'], when: '' }).name).toBe('Deploy');
    expect(heuristicName(bare, { heading: 'www.acme.com', hosts: ['www.acme.com'], when: '' }).name).toBe('acme.com');
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
});
