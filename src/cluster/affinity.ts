/**
 * The affinity signals S1–S8, N1. Port of analysis/tabamnesty/signals.py — change both or
 * `npm run parity` fails. All signals are in [0, 1].
 */
import { cosine, tfidfVectors, type Vector } from './lexical';
import { AMBIENT, type Betas, SIGNALS, type SignalVector, STRIP_TAU, TEMPORAL_TAU_MS } from './params';
import { sessionIndex } from './segment';
import type { TabTrace } from './types';

// ---------------------------------------------------------------------------------------------
// Exclusion — not down-weighting. These belong to every project so they belong to none.
// ---------------------------------------------------------------------------------------------

export function isAmbient(t: TabTrace): boolean {
  const host = (t.host ?? '').toLowerCase();
  if (AMBIENT.hosts.has(host) || AMBIENT.etld1.has((t.eTLD1 ?? '').toLowerCase())) return true;
  const hp = host + '/' + (t.pathTokens ?? []).join('/');
  return AMBIENT.searchPaths.some((p) => hp.startsWith(p));
}

/** Excluded: pinned, ambient hosts, closed, and non-http URLs. */
export function eligible(traces: TabTrace[]): { kept: TabTrace[]; excluded: TabTrace[] } {
  const kept: TabTrace[] = [];
  const excluded: TabTrace[] = [];
  for (const t of traces) {
    const url = t.url ?? '';
    const out = t.pinned || t.closedAt !== null || !/^https?:\/\//.test(url) || isAmbient(t);
    (out ? excluded : kept).push(t);
  }
  return { kept, excluded };
}

// ---------------------------------------------------------------------------------------------
// Per-corpus context computed once
// ---------------------------------------------------------------------------------------------

export class Context {
  readonly byId = new Map<string, TabTrace>();
  readonly parent = new Map<string, string | null>();
  readonly depth = new Map<string, number>();
  readonly root = new Map<string, string>();
  readonly session: Map<string, number>;
  readonly tfidf: Map<string, Vector>;
  readonly feats = new Map<string, Set<string>>();

  constructor(readonly traces: TabTrace[]) {
    for (const t of traces) {
      this.byId.set(t.traceId, t);
      const p = t.openerTraceId;
      this.parent.set(t.traceId, p && p !== t.traceId ? p : null);
    }
    for (const tid of [...this.parent.keys()]) this.resolve(tid);
    this.session = sessionIndex(traces);
    this.tfidf = tfidfVectors(traces);
    for (const t of traces) {
      const f = new Set<string>(t.pathTokens ?? []);
      for (const [k, v] of Object.entries(t.queryKeys ?? {})) f.add(`${k}=${v}`);
      this.feats.set(t.traceId, f);
    }
  }

  private resolve(tid: string): void {
    const chain: string[] = [];
    let cur: string | null | undefined = tid;
    while (cur != null && !this.depth.has(cur) && !chain.includes(cur)) {
      chain.push(cur);
      cur = this.parent.get(cur); // ids outside the corpus have no entry -> undefined -> root
    }
    let baseDepth: number;
    let baseRoot: string;
    if (cur != null && this.depth.has(cur)) {
      baseDepth = this.depth.get(cur)!;
      baseRoot = this.root.get(cur)!;
    } else {
      baseDepth = -1;
      baseRoot = chain[chain.length - 1]!;
      this.parent.set(baseRoot, null); // cut cycles so the forest stays a forest
    }
    chain.reverse().forEach((node, i) => {
      this.depth.set(node, baseDepth + 1 + i);
      this.root.set(node, baseRoot);
    });
  }

  /** Path length between a and b in the opener forest; null if in different trees. */
  treeDistance(a: string, b: string): number | null {
    if (this.root.get(a) !== this.root.get(b)) return null;
    const anc = new Map<string, number>();
    let cur: string | null | undefined = a;
    while (cur != null) {
      anc.set(cur, this.depth.get(cur) ?? 0);
      cur = this.parent.get(cur);
    }
    cur = b;
    while (cur != null) {
      const d = anc.get(cur);
      if (d !== undefined) return this.depth.get(a)! - d + (this.depth.get(b)! - (this.depth.get(cur) ?? 0));
      cur = this.parent.get(cur);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------------------------

export function s1Lineage(ctx: Context, a: TabTrace, b: TabTrace): number {
  const d = ctx.treeDistance(a.traceId, b.traceId);
  return d === null ? 0 : 1 / (1 + d);
}

export function s2Temporal(a: TabTrace, b: TabTrace): number {
  return Math.exp(-Math.abs(a.openedAt - b.openedAt) / TEMPORAL_TAU_MS);
}

/** Pair count normalised by the smaller activation count. */
export function s8Coactive(a: TabTrace, b: TabTrace): number {
  const n = (a.coActive?.[b.traceId] ?? 0) + (b.coActive?.[a.traceId] ?? 0);
  if (n === 0) return 0;
  const denom = Math.max(1, Math.min(a.activationCount ?? 0, b.activationCount ?? 0));
  return Math.min(1, n / (2 * denom));
}

export function s3Session(ctx: Context, a: TabTrace, b: TabTrace): number {
  return ctx.session.get(a.traceId) === ctx.session.get(b.traceId) ? 1 : 0;
}

export function s6PathQuery(ctx: Context, a: TabTrace, b: TabTrace): number {
  const fa = ctx.feats.get(a.traceId)!;
  const fb = ctx.feats.get(b.traceId)!;
  let inter = 0;
  for (const x of fa) if (fb.has(x)) inter++;
  const union = fa.size + fb.size - inter;
  return union ? inter / union : 0;
}

export function s4Strip(a: TabTrace, b: TabTrace): number {
  if (a.windowId !== b.windowId) return 0;
  return Math.exp(-Math.abs(a.index - b.index) / STRIP_TAU);
}

export function s7Lexical(ctx: Context, a: TabTrace, b: TabTrace): number {
  return cosine(ctx.tfidf.get(a.traceId)!, ctx.tfidf.get(b.traceId)!);
}

const brand = (etld1: string) => (etld1 ? etld1.split('.')[0]! : '');

export function s5Domain(a: TabTrace, b: TabTrace): number {
  const ea = (a.eTLD1 ?? '').toLowerCase();
  const eb = (b.eTLD1 ?? '').toLowerCase();
  if (!ea || !eb) return 0;
  if (ea === eb) return 1;
  // sibling: same brand label under a different suffix (github.com / github.io)
  return brand(ea) === brand(eb) && brand(ea).length >= 4 ? 0.5 : 0;
}

export function n1CrossWindow(a: TabTrace, b: TabTrace, s1: number): number {
  return a.windowId !== b.windowId && s1 === 0 ? 1 : 0;
}

export function signalVector(ctx: Context, a: TabTrace, b: TabTrace): SignalVector {
  const s1 = s1Lineage(ctx, a, b);
  return {
    S1_lineage: s1,
    S2_temporal: s2Temporal(a, b),
    S8_coactive: s8Coactive(a, b),
    S3_session: s3Session(ctx, a, b),
    S6_path_query: s6PathQuery(ctx, a, b),
    S4_strip: s4Strip(a, b),
    S7_lexical: s7Lexical(ctx, a, b),
    S5_domain: s5Domain(a, b),
    N1_cross_window: n1CrossWindow(a, b, s1),
  };
}

/** Weighted sum, summed in SIGNALS order so it matches the Python side bit for bit. */
export function affinity(vec: SignalVector, betas: Betas): number {
  let s = 0;
  for (const k of SIGNALS) s += betas[k] * vec[k];
  return s;
}
