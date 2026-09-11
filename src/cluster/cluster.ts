/**
 * Graph + Louvain + partition-to-target. Port of analysis/tabamnesty/cluster.py.
 *
 * Louvain, not connected components and not single-link: both chain, so one weak bridge merges
 * two real projects. Louvain optimises modularity and a lone bridge does not survive that.
 */
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { affinity, Context, eligible, signalVector } from './affinity';
import {
  type Betas,
  BETAS,
  MAX_COMMUNITY,
  RESOLUTION_ITERS,
  SIGNALS,
  type SignalVector,
  TARGET_HI,
  TARGET_LO,
  W_MIN,
} from './params';
import type { Partition, TabTrace } from './types';

export type PairKey = `${string}|${string}`;
export const pairKey = (a: string, b: string): PairKey => `${a}|${b}`;

/** Deterministic PRNG so Louvain gives the same answer for the same input (mulberry32). */
function seededRng(seed = 0): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every unordered pair's signal vector, keyed "a|b" in input order. O(n²). */
export function pairSignals(traces: TabTrace[]): { ctx: Context; vecs: Map<PairKey, SignalVector> } {
  const ctx = new Context(traces);
  const vecs = new Map<PairKey, SignalVector>();
  for (let i = 0; i < traces.length; i++) {
    for (let j = i + 1; j < traces.length; j++) {
      vecs.set(pairKey(traces[i]!.traceId, traces[j]!.traceId), signalVector(ctx, traces[i]!, traces[j]!));
    }
  }
  return { ctx, vecs };
}

export function buildGraph(
  traces: TabTrace[],
  betas: Betas,
  wMin = W_MIN,
  vecs?: Map<PairKey, SignalVector>,
): Graph {
  vecs ??= pairSignals(traces).vecs;
  const g = new Graph({ type: 'undirected' });
  for (const t of traces) g.addNode(t.traceId);
  for (const [key, vec] of vecs) {
    const w = affinity(vec, betas);
    if (w >= wMin) {
      const [a, b] = key.split('|') as [string, string];
      g.addEdge(a, b, { weight: w });
    }
  }
  return g;
}

function runLouvain(g: Graph, resolution: number): string[][] {
  if (g.size === 0) return g.nodes().map((n) => [n]);
  const mapping = louvain(g, { resolution, getEdgeWeight: 'weight', rng: seededRng(0) });
  const byComm = new Map<number, string[]>();
  for (const n of g.nodes()) {
    const c = mapping[n]!;
    if (!byComm.has(c)) byComm.set(c, []);
    byComm.get(c)!.push(n);
  }
  return [...byComm.values()];
}

/**
 * Binary-search Louvain's resolution (log scale) until the number of real communities
 * (size >= 2) lands in [lo, hi]. Group count is a product guarantee, not an algorithm output.
 */
export function partitionToTarget(
  g: Graph,
  lo = TARGET_LO,
  hi = TARGET_HI,
  iters = RESOLUTION_ITERS,
): { communities: string[][]; resolution: number } {
  let loR = Math.log(0.02);
  let hiR = Math.log(20);
  let best: string[][] | null = null;
  let bestRes = 1;
  let bestGap = Infinity;
  for (let i = 0; i < iters; i++) {
    const mid = (loR + hiR) / 2;
    const res = Math.exp(mid);
    const comms = runLouvain(g, res);
    const n = comms.filter((c) => c.length >= 2).length;
    const gap = n >= lo && n <= hi ? 0 : Math.min(Math.abs(n - lo), Math.abs(n - hi));
    if (gap < bestGap || (gap === bestGap && Math.abs(mid) < Math.abs(Math.log(bestRes)))) {
      best = comms;
      bestRes = res;
      bestGap = gap;
    }
    if (gap === 0) break;
    if (n > hi) hiR = mid; // too many groups -> lower resolution
    else loR = mid;
  }
  return { communities: best!, resolution: bestRes };
}

export function splitLarge(g: Graph, comms: string[][], maxSize = MAX_COMMUNITY): string[][] {
  const out: string[][] = [];
  for (const c of comms) {
    if (c.length <= maxSize) {
      out.push(c);
      continue;
    }
    const sub = new Graph({ type: 'undirected' });
    for (const n of c) sub.addNode(n);
    for (const n of c) {
      g.forEachEdge(n, (_e, attrs, s, t) => {
        if (sub.hasNode(s) && sub.hasNode(t) && !sub.hasEdge(s, t)) sub.addEdge(s, t, attrs);
      });
    }
    const parts = runLouvain(sub, 1);
    if (parts.length <= 1) out.push(c); // Louvain will not split it; keep rather than force
    else out.push(...splitLarge(g, parts, maxSize));
  }
  return out;
}

export interface ClusterOptions {
  betas?: Betas;
  wMin?: number;
  lo?: number;
  hi?: number;
  vecs?: Map<PairKey, SignalVector>;
}

export interface ClusterResult extends Partition {
  resolution: number;
  /** pinned / ambient / non-http / closed — never scored as ours */
  excluded: string[];
}

export function cluster(traces: TabTrace[], opts: ClusterOptions = {}): ClusterResult {
  const betas = opts.betas ?? BETAS;
  const { kept, excluded } = eligible(traces);
  const excludedIds = excluded.map((t) => t.traceId);
  if (kept.length === 0) return { communities: [], looseEnds: [], resolution: 1, excluded: excludedIds };
  const g = buildGraph(kept, betas, opts.wMin ?? W_MIN, opts.vecs);
  const { communities: raw, resolution } = partitionToTarget(g, opts.lo, opts.hi);
  const comms = splitLarge(g, raw);
  const order = new Map(kept.map((t, i) => [t.traceId, i]));
  const ord = (id: string) => order.get(id) ?? Infinity;
  const real = comms
    .filter((c) => c.length >= 2)
    .map((c) => [...c].sort((a, b) => ord(a) - ord(b)))
    .sort((a, b) => b.length - a.length || ord(a[0]!) - ord(b[0]!));
  const looseEnds = comms
    .filter((c) => c.length < 2)
    .map((c) => c[0]!)
    .sort((a, b) => ord(a) - ord(b));
  return {
    communities: real.map((traceIds, id) => ({ id, traceIds })),
    looseEnds,
    resolution,
    excluded: excludedIds,
  };
}

/** Every beta zeroed one at a time, plus the S1+S2+S8 gate condition together. */
export function ablationBetas(betas: Betas = BETAS): Record<string, Betas> {
  const runs: Record<string, Betas> = { baseline: { ...betas } };
  for (const s of SIGNALS) runs[`no_${s}`] = { ...betas, [s]: 0 };
  runs.no_S1_S2_S8 = { ...betas, S1_lineage: 0, S2_temporal: 0, S8_coactive: 0 };
  return runs;
}
