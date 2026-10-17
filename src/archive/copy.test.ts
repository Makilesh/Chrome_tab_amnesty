import { describe, expect, it } from 'vitest';
import type { TabTrace, Transition } from '../cluster/types';
import { buildCard } from './card';
import { cardsToBringIn, copyFileName, copyToHtml, readCopy, type Copy } from './copy';
import type { ArchiveCard } from './types';

function tr(traceId: string, title: string, url: string, o: Partial<TabTrace> = {}): TabTrace {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return {
    traceId, tabId: 0, windowId: 1, index: Number(traceId.replace(/\D/g, '')) || 0, openerTraceId: null, openedAt: 0,
    transition: 'link' as Transition, backfilled: false, lastActiveAt: null, activationCount: 0, dwellMs: 0, coActive: {},
    url, host, eTLD1: host, pathTokens: [], queryKeys: {}, title, digest: null, digestAt: null, pinned: false,
    discarded: false, closedAt: null, ...o,
  };
}

const at = (day: number, h: number) => new Date(2026, 9, day, h).getTime();
const NOW = at(17, 12);

function card(id: string, name: string, tabs: TabTrace[], archivedAt: number): ArchiveCard {
  return buildCard({ id: 0, traceIds: tabs.map((t) => t.traceId) }, tabs, { name, color: 'orange', tier: 'heuristic' }, '', [...new Set(tabs.map((t) => t.host))], archivedAt, id, archivedAt - 3_600_000);
}

const trip = card(
  'trip',
  'Lisbon',
  [
    tr('t1', 'Belém Tower - Wikipedia', 'https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower'),
    tr('t2', 'Alfama - Wikipedia', 'https://en.wikipedia.org/wiki/Alfama', { digest: { description: 'The oldest district', headings: ['History'], leadText: 'Narrow streets.' } }),
  ],
  at(16, 15),
);
trip.tabs[1]!.summary = 'Fado houses and viewpoints.';
const deploy = card('deploy', 'Deploy runbook', [tr('d1', 'Rollback steps', 'https://wiki.acme.dev/ops/rollback')], at(2, 10));

describe('keep a copy', () => {
  it('reads back exactly what it saved, never as an undo', () => {
    const html = copyToHtml([trip, deploy], ['bank.example'], NOW);
    const copy = readCopy(html, NOW) as Copy;
    expect(copy.savedAt).toBe(NOW);
    expect(copy.neverRemember).toEqual(['bank.example']);
    expect(copy.cards.map((c) => c.cardId)).toEqual(['trip', 'deploy']);
    expect(copy.cards[0]).toEqual({ ...trip, undoUntil: NOW }); // Bring back's day is this browser's, not the file's
    expect(copy.cards[1]).toEqual(deploy); // its day was long over
  });

  it('is a page anyone can read: names, when, every tab a link, no script', () => {
    const html = copyToHtml([trip], [], NOW);
    expect(html).toContain('<h2>Lisbon</h2>');
    expect(html).toContain(new Date(trip.whenAt!).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    expect(html).toContain('<a href="https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower">Belém Tower - Wikipedia</a>');
    expect(html).toContain('<span class="sum">Fado houses and viewpoints.</span>');
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    expect(html.match(/<script\b/g)).toHaveLength(1); // the records, as data
    expect(html).toMatch(/<script type="application\/json" id="tab-amnesty-copy">/);
    expect(copyToHtml([], [], NOW)).toContain('Nothing was put away when this copy was saved.');
  });

  it('writes what pages call themselves as text, and links only to web pages', () => {
    const evil = card('evil', '<img src=x onerror=alert(1)>', [tr('e1', '</script><script>alert(1)</script>', 'https://evil.example/')], at(15, 9));
    evil.tabs.push({ ...evil.tabs[0]!, traceId: 'e2', url: 'javascript:alert(1)', order: 1 });
    const html = copyToHtml([evil], [], NOW);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    const back = readCopy(html, NOW) as Copy;
    expect(back.cards[0]!.name).toBe('<img src=x onerror=alert(1)>');
    expect(back.cards[0]!.tabs.map((t) => t.title)).toEqual(['</script><script>alert(1)</script>']); // the javascript: line is not brought in
  });

  it('trusts nothing in a file: wrong kinds, newer versions, bad fields', () => {
    expect(readCopy('<html><body>hello</body></html>')).toBeNull();
    expect(readCopy('{"kind":"something-else","version":1}')).toBeNull();
    expect(readCopy('{"kind":"tab-amnesty-copy","version":1,')).toBeNull();
    expect(readCopy('{"kind":"tab-amnesty-copy","version":2,"cards":[]}')).toBe('newer');
    const odd = {
      kind: 'tab-amnesty-copy', version: 1, savedAt: NOW, neverRemember: ['WWW.Reddit.com/', 7],
      cards: [
        { cardId: 'a', name: 'x'.repeat(500), color: 'magenta', tier: 'gpt', undoUntil: NOW * 2, tabs: [{ url: 'https://a.example/1', host: 'evil.example', title: 3 }] },
        { cardId: 'a', name: 'duplicate', tabs: [{ url: 'https://a.example/2' }] },
        { name: 'no id', tabs: [{ url: 'https://a.example/3' }] },
        { cardId: 'b', name: 'nothing to open', tabs: [{ url: 'file:///C:/secret.txt' }, { url: 'not a url' }] },
      ],
    };
    const copy = readCopy(JSON.stringify(odd), NOW) as Copy;
    expect(copy.neverRemember).toEqual(['reddit.com']);
    expect(copy.cards).toHaveLength(1);
    expect(copy.cards[0]).toMatchObject({ cardId: 'a', color: 'grey', tier: 'heuristic', undoUntil: NOW, archivedAt: NOW, restoredAt: null });
    expect(copy.cards[0]!.name).toHaveLength(60);
    expect(copy.cards[0]!.tabs[0]).toMatchObject({ host: 'a.example', title: '', order: 0, digest: null, summary: null });
  });

  it('still reads a copy the browser saved again ("Save page as" moves attributes about)', () => {
    const html = copyToHtml([deploy], [], NOW).replace('<script type="application/json" id="tab-amnesty-copy">', '<script id="tab-amnesty-copy" type="application/json">');
    expect((readCopy(html, NOW) as Copy).cards.map((c) => c.cardId)).toEqual(['deploy']);
  });

  it('brings in only what is not here, and nothing on a site never remembered here', () => {
    const mixed = card('mixed', 'Monthly money', [tr('m1', 'Statement', 'https://online.bank.example/statements'), tr('m2', 'Budget sheet', 'https://sheets.example/budget')], at(14, 9));
    const only = card('only', 'Account', [tr('o1', 'Account', 'https://bank.example/')], at(13, 9));
    const copy = readCopy(copyToHtml([trip, deploy, mixed, only], [], NOW), NOW) as Copy;
    const added = cardsToBringIn(copy, new Set(['deploy']), ['bank.example']);
    expect(added.map((c) => c.cardId)).toEqual(['trip', 'mixed']);
    expect(added[1]!.tabs.map((t) => t.traceId)).toEqual(['m2']);
    expect(added[1]!.hosts).toEqual(['sheets.example']);
    expect(added[1]!.name).toBe('Monthly money'); // a name that does not name the site stays
    const named = card('named', 'Bank example', [tr('n1', 'x', 'https://bank.example/a'), tr('n2', 'y', 'https://notes.example/b')], at(12, 9));
    expect(cardsToBringIn(readCopy(copyToHtml([named], [], NOW), NOW) as Copy, new Set(), ['bank.example'])[0]!.name).toBe('notes.example');
  });

  it('names the file by the day it was saved', () => {
    expect(copyFileName(at(7, 9))).toBe('tab-amnesty-put-away-2026-10-07.html');
  });
});
