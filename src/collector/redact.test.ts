import { describe, expect, it } from 'vitest';
import { cluster } from '../cluster/cluster';
import type { TabTrace } from '../cluster/types';
import { looksLikeId, redactTraces, scrubText } from './redact';
import { urlFeatures } from './url';

function tr(traceId: string, url: string, o: Partial<TabTrace> = {}): TabTrace {
  return {
    traceId, tabId: 0, windowId: 1, index: 0, openerTraceId: null, openedAt: 0, transition: 'link', backfilled: false,
    lastActiveAt: null, activationCount: 0, dwellMs: 0, coActive: {}, url, ...urlFeatures(url), title: '', digest: null,
    digestAt: null, pinned: false, discarded: false, closedAt: null, ...o,
  };
}

describe('shareable redaction', () => {
  it('replaces anything shaped like an email address', () => {
    expect(scrubText('Page shared with you - someone.name+tag@gmail.com - Gmail')).toBe('Page shared with you - [email] - Gmail');
    expect(scrubText('No address here @ all')).toBe('No address here @ all');
  });

  it('knows an id when it sees one, and a word when it sees one', () => {
    for (const id of ['zr31rrrnjmnph20f12xqh5r19c', '3d2e0ff3425b80919e8ecc9ec6e98296', '274922421881', '8REHIWx', 'KYNmcBaXqWvT', 'connor9994']) {
      expect(looksLikeId(id)).toBe(true);
    }
    for (const w of ['buildathon', 'careers', 'p', 'c3', 'pricing', 'workspace']) expect(looksLikeId(w)).toBe(false);
  });

  it('swaps ids for stand-ins: same value, same stand-in, in url, path tokens and across tabs', () => {
    const [a, b, c] = redactTraces([
      tr('a', 'https://www.ilovepdf.com/download/zr31rrrnjmnph20f12xqh5r19c?x=1'),
      tr('b', 'https://app.notion.com/p/Buildathon-3d2e0ff3425b80919e8ecc9ec6e98296'),
      tr('c', 'https://app.notion.com/p/3d2e0ff3425b80919e8ecc9ec6e98296'),
    ]) as [TabTrace, TabTrace, TabTrace];
    expect(JSON.stringify([a, b, c])).not.toMatch(/zr31rrrnjmnph20f12xqh5r19c|3d2e0ff3425b80919e8ecc9ec6e98296/);
    expect(a.url).toMatch(/^https:\/\/www\.ilovepdf\.com\/download\/id[0-9a-f]{12}$/);
    expect(a.queryKeys).toEqual({ x: '' });
    expect(b.pathTokens.at(-1)).toBe(c.pathTokens.at(-1));
    expect(b.url).toContain('/p/Buildathon-id');
    expect(redactTraces([tr('n', 'https://jobs.example.com/job/274922421881')])[0]!.pathTokens.at(-1)).toMatch(/^\d{12}$/);
  });

  it('stand-ins are random: the same value gets unrelated stand-ins in every export', () => {
    const t = tr('x', 'https://example.com/year/2026/report-9f8e7d6c');
    const runs = Array.from({ length: 5 }, () => redactTraces([t])[0]!.pathTokens.join('/'));
    expect(new Set(runs).size).toBe(5);
    for (const r of runs) expect(r).not.toMatch(/2026|9f8e7d6c/);
  });

  it('keeps nothing from mail/search tabs but the site, and nothing from local files', () => {
    const [mail, search, file] = redactTraces([
      tr('m', 'https://mail.google.com/mail/u/0/', {
        title: 'Inbox (3) - me@x.com',
        digest: { description: '', headings: ['Your invoice from Acme'], leadText: '' },
      }),
      tr('s', 'https://www.google.com/search?q=private+thing', { title: 'private thing - Google Search' }),
      tr('f', 'file:///D:/Users/me/Resume_Me.pdf', { title: 'Resume_Me.pdf' }),
    ]) as [TabTrace, TabTrace, TabTrace];
    expect([mail.title, mail.digest, mail.host]).toEqual(['', null, 'mail.google.com']);
    expect([search.title, search.queryKeys]).toEqual(['', { q: '' }]);
    expect([file.url, file.title, file.pathTokens]).toEqual(['file:///', '[local file]', []]);
  });

  it('does not change what the clusterer sees: same partition before and after', () => {
    const ts = [
      tr('a1', 'https://app.notion.com/p/Plan-3d2e0ff3425b80919e8ecc9ec6e98296', { title: 'Plan launch', openedAt: 0, transition: 'typed' }),
      tr('a2', 'https://docs.acme.io/d/9f8e7d6c5b4a39281706f5e4d3c2b1a0/edit', { title: 'Launch checklist', openedAt: 60_000, openerTraceId: 'a1' }),
      tr('a3', 'https://app.notion.com/p/3d2e0ff3425b80919e8ecc9ec6e98296', { title: 'Plan launch notes', openedAt: 90_000, openerTraceId: 'a1' }),
      tr('b1', 'https://en.wikipedia.org/wiki/Lisbon', { title: 'Lisbon', openedAt: 40 * 60_000, transition: 'typed' }),
      tr('b2', 'https://en.wikipedia.org/wiki/Alfama', { title: 'Alfama', openedAt: 41 * 60_000, openerTraceId: 'b1' }),
      tr('b3', 'https://www.booking.com/hotel/pt/casa-123456.html', { title: 'Casa Lisbon hotel', openedAt: 42 * 60_000, openerTraceId: 'b1' }),
    ];
    const norm = (p: ReturnType<typeof cluster>) => p.communities.map((c) => [...c.traceIds].sort().join(',')).sort();
    expect(norm(cluster(redactTraces(ts)))).toEqual(norm(cluster(ts)));
  });
});
