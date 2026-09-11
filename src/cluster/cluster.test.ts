import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Context,
  eligible,
  s1Lineage,
  s2Temporal,
  s4Strip,
  s5Domain,
  s6PathQuery,
  s8Coactive,
  signalVector,
} from './affinity';
import { ablationBetas, buildGraph, cluster, partitionToTarget } from './cluster';
import { cosine, tfidfVectors, tokens } from './lexical';
import { BETAS, SIGNALS } from './params';
import { segment } from './segment';
import type { TabTrace, Transition } from './types';

const MIN = 60_000;

function tr(traceId: string, o: Partial<TabTrace> & { path?: string[] } = {}): TabTrace {
  const host = o.host ?? 'a.com';
  const { path, ...rest } = o;
  return {
    traceId,
    tabId: o.index ?? 0,
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
    url: o.url ?? `https://${host}/${(path ?? []).join('/')}`,
    host,
    eTLD1: o.eTLD1 ?? host,
    pathTokens: path ?? [],
    queryKeys: {},
    title: '',
    digest: null,
    digestAt: null,
    pinned: false,
    discarded: false,
    closedAt: null,
    ...rest,
  };
}

const ids = (s: TabTrace[][]) => s.map((x) => x.map((t) => t.traceId));

describe('segment', () => {
  it('cuts on a gap', () => {
    expect(ids(segment([tr('a'), tr('b', { openedAt: 5 * MIN }), tr('c', { openedAt: 40 * MIN })]))).toEqual([['a', 'b'], ['c']]);
  });
  it('cuts on new intent without opener, not with one', () => {
    expect(ids(segment([tr('a'), tr('b', { openedAt: MIN, transition: 'typed' }), tr('c', { openedAt: 2 * MIN, openerTraceId: 'b' })]))).toEqual([['a'], ['b', 'c']]);
    expect(segment([tr('a'), tr('b', { openedAt: MIN, openerTraceId: 'a', transition: 'typed' })])).toHaveLength(1);
  });
  it('unknown is not a boundary', () => {
    expect(segment([tr('a'), tr('b', { openedAt: MIN, transition: 'unknown' })])).toHaveLength(1);
  });
});

describe('signals', () => {
  it('lineage distances', () => {
    const ts = [tr('root'), tr('c1', { openerTraceId: 'root' }), tr('c2', { openerTraceId: 'root' }), tr('g1', { openerTraceId: 'c1' }), tr('x')];
    const ctx = new Context(ts);
    const by = (id: string) => ctx.byId.get(id)!;
    expect(s1Lineage(ctx, by('root'), by('c1'))).toBe(1 / 2);
    expect(s1Lineage(ctx, by('c1'), by('c2'))).toBe(1 / 3);
    expect(s1Lineage(ctx, by('g1'), by('c2'))).toBe(1 / 4);
    expect(s1Lineage(ctx, by('root'), by('x'))).toBe(0);
  });
  it('lineage through an opener outside the corpus, and cycles', () => {
    const ts = [tr('c1', { openerTraceId: 'gone' }), tr('c2', { openerTraceId: 'gone' })];
    expect(s1Lineage(new Context(ts), ts[0]!, ts[1]!)).toBeCloseTo(1 / 3);
    const cyc = [tr('a', { openerTraceId: 'b' }), tr('b', { openerTraceId: 'a' })];
    expect(s1Lineage(new Context(cyc), cyc[0]!, cyc[1]!)).toBeGreaterThan(0);
  });
  it('temporal and strip', () => {
    expect(s2Temporal(tr('a'), tr('b', { openedAt: 8 * MIN }))).toBeCloseTo(Math.exp(-1));
    expect(s4Strip(tr('a'), tr('b', { index: 4 }))).toBeCloseTo(Math.exp(-1));
    expect(s4Strip(tr('a'), tr('b', { windowId: 2 }))).toBe(0);
  });
  it('domain and siblings', () => {
    expect(s5Domain(tr('a', { eTLD1: 'github.com' }), tr('b', { eTLD1: 'github.com' }))).toBe(1);
    expect(s5Domain(tr('a', { eTLD1: 'github.com' }), tr('b', { eTLD1: 'github.io' }))).toBe(0.5);
    expect(s5Domain(tr('a', { eTLD1: 'go.com' }), tr('b', { eTLD1: 'go.dev' }))).toBe(0);
  });
  it('path/query jaccard', () => {
    const ts = [tr('a', { path: ['acme', 'deploy'], queryKeys: { tab: 'files' } }), tr('b', { path: ['acme', 'billing'], queryKeys: { tab: 'files' } })];
    expect(s6PathQuery(new Context(ts), ts[0]!, ts[1]!)).toBeCloseTo(0.5);
  });
  it('coactive normalised', () => {
    expect(s8Coactive(tr('a', { activationCount: 4, coActive: { b: 2 } }), tr('b', { activationCount: 10, coActive: { a: 2 } }))).toBeCloseTo(0.5);
    expect(s8Coactive(tr('a'), tr('b'))).toBe(0);
  });
  it('vector keys match betas', () => {
    const ts = [tr('a'), tr('b')];
    expect(Object.keys(signalVector(new Context(ts), ts[0]!, ts[1]!)).sort()).toEqual([...SIGNALS].sort());
    expect(Object.keys(BETAS).sort()).toEqual([...SIGNALS].sort());
  });
  it('exclusion', () => {
    const ts = [
      tr('pin', { pinned: true }),
      tr('mail', { host: 'mail.google.com', eTLD1: 'google.com' }),
      tr('music', { host: 'open.spotify.com', eTLD1: 'spotify.com' }),
      tr('new', { url: 'chrome://newtab/' }),
      tr('search', { host: 'www.google.com', eTLD1: 'google.com', path: ['search'] }),
      tr('ok', { host: 'github.com' }),
    ];
    const { kept, excluded } = eligible(ts);
    expect(kept.map((t) => t.traceId)).toEqual(['ok']);
    expect(excluded).toHaveLength(5);
  });
});

describe('lexical', () => {
  it('tokens drop stop words and numbers', () => {
    expect(tokens(tr('a', { title: 'The Deploy Runbook 42', path: ['acme', 'deploy'] }))).toEqual(['deploy', 'runbook', 'acme', 'deploy']);
  });
  it('cosine bounds', () => {
    const v = tfidfVectors([tr('a', { title: 'pandas groupby error' }), tr('b', { title: 'pandas groupby dtype' }), tr('c', { title: 'lisbon hotel' })]);
    expect(cosine(v.get('a')!, v.get('a')!)).toBeCloseTo(1);
    expect(cosine(v.get('a')!, v.get('b')!)).toBeGreaterThan(0);
    expect(cosine(v.get('a')!, v.get('c')!)).toBe(0);
  });
});

describe('cluster', () => {
  const synthetic = (): { traces: TabTrace[]; labels: Record<string, string | null> } => {
    // Generated by the Python bench: `python -m tabamnesty.synth synthetic`. Skipped if absent.
    const traces = (JSON.parse(readFileSync('fixtures/synthetic.json', 'utf8')) as { traces: TabTrace[] }).traces;
    const labels = JSON.parse(readFileSync('fixtures/synthetic.labels.json', 'utf8')) as Record<string, string | null>;
    delete labels._comment;
    return { traces, labels };
  };
  let have = true;
  try {
    synthetic();
  } catch {
    have = false;
  }

  it.skipIf(!have)('recovers synthetic projects with no singleton communities', () => {
    const { traces, labels } = synthetic();
    const p = cluster(traces);
    expect(p.communities.length).toBeGreaterThanOrEqual(3);
    expect(p.communities.every((c) => c.traceIds.length >= 2)).toBe(true);
    // every community is dominated by one label
    for (const c of p.communities) {
      const counts = new Map<string | null, number>();
      for (const id of c.traceIds) counts.set(labels[id] ?? null, (counts.get(labels[id] ?? null) ?? 0) + 1);
      expect(Math.max(...counts.values()) / c.traceIds.length).toBeGreaterThan(0.8);
    }
    expect(p.excluded).toEqual(expect.arrayContaining(traces.filter((t) => t.pinned).map((t) => t.traceId)));
  });

  it.skipIf(!have)('partitionToTarget lands in range', () => {
    const { kept } = eligible(synthetic().traces);
    const g = buildGraph(kept, BETAS);
    const { communities } = partitionToTarget(g, 3, 9);
    const n = communities.filter((c) => c.length >= 2).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(9);
  });

  it('empty graph is all loose ends', () => {
    const p = cluster([tr('a'), tr('b', { openedAt: 1e9, host: 'b.com', windowId: 2, index: 50 })]);
    expect(p.communities).toEqual([]);
    expect(p.looseEnds.sort()).toEqual(['a', 'b']);
  });

  it('ablation runs cover every signal', () => {
    const runs = ablationBetas();
    expect(runs.no_S1_S2_S8).toBeDefined();
    for (const s of SIGNALS) expect(runs[`no_${s}`]![s]).toBe(0);
  });
});
