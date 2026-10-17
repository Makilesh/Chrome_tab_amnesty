import { describe, expect, it } from 'vitest';
import type { TabTrace, Transition } from '../cluster/types';
import { buildCard } from './card';
import { fold, queryTerms, searchArchive } from './search';
import type { ArchiveCard } from './types';

function tr(traceId: string, title: string, url: string, o: Partial<TabTrace> = {}): TabTrace {
  const host = new URL(url).hostname;
  return {
    traceId, tabId: 0, windowId: 1, index: Number(traceId.replace(/\D/g, '')) || 0, openerTraceId: null, openedAt: 0,
    transition: 'link' as Transition, backfilled: false, lastActiveAt: null, activationCount: 0, dwellMs: 0, coActive: {},
    url, host, eTLD1: host, pathTokens: [], queryKeys: {}, title, digest: null, digestAt: null, pinned: false,
    discarded: false, closedAt: null, ...o,
  };
}

const at = (day: number, h: number) => new Date(2026, 9, day, h).getTime();

function card(id: string, name: string, tabs: TabTrace[], archivedAt: number, whenAt: number | null = null): ArchiveCard {
  return buildCard({ id: 0, traceIds: tabs.map((t) => t.traceId) }, tabs, { name, color: 'blue', tier: 'heuristic' }, '', [...new Set(tabs.map((t) => t.host))], archivedAt, id, whenAt);
}

const trip = card(
  'trip',
  'Lisbon',
  [
    tr('t1', 'Belém Tower - Wikipedia', 'https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower'),
    tr('t2', 'Alfama - Wikipedia', 'https://en.wikipedia.org/wiki/Alfama', {
      digest: { description: 'The oldest district of Lisbon', headings: ['History', 'Fado houses'], leadText: 'Narrow streets and viewpoints over the river.' },
    }),
  ],
  at(12, 15),
  at(12, 14),
);
const deploy = card('deploy', 'Deploy runbook', [tr('d1', 'Rollback steps | Wiki', 'https://wiki.acme.dev/ops/rollback'), tr('d2', 'Pricing plans', 'https://acme.dev/pricing')], at(14, 10), at(14, 9));

describe('search across everything put away', () => {
  const cards = [deploy, trip];
  const now = at(16, 12); // Friday

  it('ignores case and accents, and a word may be the start of a longer one', () => {
    expect(fold('Belém')).toBe('belem');
    expect(queryTerms('  Lisb  ALFAMA ')).toEqual(['lisb', 'alfama']);
    expect(searchArchive(cards, 'belem', now).map((h) => h.tabs.map((t) => t.traceId))).toEqual([['t1']]);
    expect(searchArchive(cards, 'alfam', now)[0]?.tabs.map((t) => t.traceId)).toEqual(['t2']);
  });

  it('needs every word typed, anywhere in the tab or its card', () => {
    expect(searchArchive(cards, 'alfama fado', now).map((h) => h.card.cardId)).toEqual(['trip']); // a heading
    expect(searchArchive(cards, 'alfama pricing', now)).toEqual([]);
    expect(searchArchive(cards, 'lisbon rollback', now)).toEqual([]);
  });

  it("finds a page by what it said, not only its title: description, headings, opening text, summary", () => {
    expect(searchArchive(cards, 'oldest district', now)[0]?.tabs.map((t) => t.traceId)).toEqual(['t2']);
    expect(searchArchive(cards, 'viewpoints river', now)[0]?.tabs.map((t) => t.traceId)).toEqual(['t2']);
    const summarised = card('s', 'Notes', [tr('n1', 'Untitled', 'https://notes.example/1', {})], at(15, 9));
    summarised.tabs[0]!.summary = 'How to roll back a broken release';
    expect(searchArchive([summarised], 'broken release', now).map((h) => h.card.cardId)).toEqual(['s']);
  });

  it("a word in the card's own name, sites or when shows the whole card", () => {
    const byName = searchArchive(cards, 'runbook', now);
    expect(byName.map((h) => [h.card.cardId, h.tabs.length, h.whole])).toEqual([['deploy', 2, true]]);
    expect(searchArchive(cards, 'rollback', now).map((h) => [h.card.cardId, h.tabs.length, h.whole])).toEqual([['deploy', 1, false]]);
    // "Monday" — said as of now, the way the list says it (§6.5): find it without remembering the date.
    const monday = new Date(at(12, 14)).toLocaleDateString(undefined, { weekday: 'long' });
    expect(searchArchive(cards, monday, now).map((h) => h.card.cardId)).toEqual(['trip']);
    expect(searchArchive(cards, 'wikipedia', now).map((h) => [h.card.cardId, h.tabs.length])).toEqual([['trip', 2]]);
  });

  it('ranks a title match above a match in the page text, then the newer card', () => {
    const a = card('a', 'One', [tr('a1', 'River cruise', 'https://a.example/x')], at(10, 9));
    const b = card('b', 'Two', [tr('b1', 'Something', 'https://b.example/y', { digest: { description: '', headings: [], leadText: 'a river walk' } })], at(15, 9));
    expect(searchArchive([b, a], 'river', now).map((h) => h.card.cardId)).toEqual(['a', 'b']);
    expect(searchArchive([a, card('c', 'Three', [tr('c1', 'River map', 'https://c.example/z')], at(15, 9))], 'river', now).map((h) => h.card.cardId)).toEqual(['c', 'a']);
  });

  it('nothing typed, nothing found', () => {
    expect(searchArchive(cards, '   ', now)).toEqual([]);
    expect(searchArchive(cards, '—', now)).toEqual([]);
  });
});
