/**
 * S7: TF-IDF cosine on our own corpus. Same arithmetic as analysis/tabamnesty/lexical.py so the
 * parity test can compare edge weights exactly.
 */
import type { TabTrace } from './types';

const TOKEN = /[a-z0-9]{2,}/g;
const STOP = new Set(
  (
    'a an and are as at be by for from has have in is it its of on or that the this to was ' +
    'were will with you your we our not no but if then than so can how what when where who why ' +
    'which html http https www com page home index new free best top'
  ).split(' '),
);

export type Vector = Map<string, number>;

export function tokens(t: TabTrace): string[] {
  const parts = [t.title ?? ''];
  if (t.digest) {
    parts.push(t.digest.description ?? '', ...(t.digest.headings ?? []), t.digest.leadText ?? '');
  }
  parts.push(...(t.pathTokens ?? []));
  const text = parts.join(' ').toLowerCase();
  return (text.match(TOKEN) ?? []).filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
}

/** traceId -> L2-normalised {term: weight}. tf = 1 + ln(count); idf = ln((N+1)/(df+1)) + 1. */
export function tfidfVectors(traces: TabTrace[]): Map<string, Vector> {
  const docs = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  for (const t of traces) {
    const c = new Map<string, number>();
    for (const w of tokens(t)) c.set(w, (c.get(w) ?? 0) + 1);
    for (const w of c.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    docs.set(t.traceId, c);
  }
  const n = docs.size;
  const out = new Map<string, Vector>();
  for (const [tid, c] of docs) {
    const vec: Vector = new Map();
    let norm = 0;
    for (const [w, k] of c) {
      const v = (1 + Math.log(k)) * (Math.log((n + 1) / ((df.get(w) ?? 0) + 1)) + 1);
      vec.set(w, v);
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [w, v] of vec) vec.set(w, v / norm);
    else vec.clear();
    out.set(tid, vec);
  }
  return out;
}

export function cosine(a: Vector, b: Vector): number {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [w, v] of a) {
    const bv = b.get(w);
    if (bv !== undefined) s += v * bv;
  }
  return s;
}
