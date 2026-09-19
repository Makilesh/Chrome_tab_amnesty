import { describe, expect, it } from 'vitest';
import type { TabTrace, Transition } from '../cluster/types';
import { buildCard, colorFor, dominantHost, inStripOrder, restoreOrder, stableHash, undoable } from './card';
import { isNeverRemembered, normaliseDomain } from './forget';
import { clampName, evidence, heuristicName } from './naming';
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

  it('heuristic name comes from shared tokens, else the dominant domain; colour from the hash', () => {
    const members = [tr('1', { host: 'acme.com' }), tr('2', { host: 'acme.com' })];
    const fromTokens = heuristicName(members, { heading: 'deploy · rollout', hosts: ['acme.com'], when: '' });
    expect(fromTokens.name).toBe('Deploy Rollout');
    expect(fromTokens.tier).toBe('heuristic');
    expect(fromTokens.color).toBe(colorFor(members));
    const fromHost = heuristicName(members, { heading: 'www.acme.com', hosts: ['www.acme.com'], when: '' });
    expect(fromHost.name).toBe('acme.com');
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
