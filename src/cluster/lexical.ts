/**
 * S7: TF-IDF cosine on our own corpus. Same arithmetic as analysis/tabamnesty/lexical.py so the
 * parity test can compare edge weights exactly.
 */
import type { TabTrace } from './types';

/**
 * Scripts written without spaces between words. A run of these is indexed as overlapping
 * character bigrams; any other run of letters/marks/numbers is one token. Same code-point table
 * as UNSEGMENTED in lexical.py.
 */
const UNSEGMENTED: ReadonlyArray<readonly [number, number]> = [
  [0x0e00, 0x0eff], // Thai, Lao
  [0x1000, 0x109f], // Myanmar
  [0x1780, 0x17ff], // Khmer
  [0x19e0, 0x19ff], // Khmer symbols
  [0x3005, 0x3007], // 々 〆 〇
  [0x3040, 0x30ff], // Hiragana, Katakana
  [0x31f0, 0x31ff], // Katakana phonetic extensions
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xff66, 0xff9f], // half-width katakana
  [0x20000, 0x323af], // CJK extensions B-H
];
const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u;
const NUMBER = /^\p{N}+$/u;
const STOP = new Set(
  (
    'a an and are as at be by for from has have in is it its of on or that the this to was ' +
    'were will with you your we our not no but if then than so can how what when where who why ' +
    'which html http https www com page home index new free best top'
  ).split(' '),
);

export type Vector = Map<string, number>;

function isUnsegmented(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return UNSEGMENTED.some(([lo, hi]) => lo <= cp && cp <= hi);
}

/** Percent-decode a path token; a malformed escape or invalid UTF-8 leaves it as it was. */
export function decodeSegment(s: string): string {
  if (!s.includes('%')) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Maximal runs of Unicode letters, marks and numbers, >= 2 code points. Runs in a script
 * written without spaces (UNSEGMENTED) become overlapping character bigrams instead.
 */
export function splitWords(text: string): string[] {
  const out: string[] = [];
  const run: string[] = [];
  let runUnseg = false;
  const flush = () => {
    if (runUnseg) for (let i = 0; i + 1 < run.length; i++) out.push(run[i]! + run[i + 1]!);
    else if (run.length >= 2) out.push(run.join(''));
    run.length = 0;
  };
  for (const ch of text) {
    if (!WORD_CHAR.test(ch)) {
      flush();
      continue;
    }
    const u = isUnsegmented(ch);
    if (run.length && u !== runUnseg) flush();
    runUnseg = u;
    run.push(ch);
  }
  flush();
  return out;
}

export function tokens(t: TabTrace): string[] {
  const parts = [t.title ?? ''];
  if (t.digest) {
    parts.push(t.digest.description ?? '', ...(t.digest.headings ?? []), t.digest.leadText ?? '');
  }
  parts.push(...(t.pathTokens ?? []).map(decodeSegment));
  const text = parts.join(' ').normalize('NFKC').toLowerCase();
  return splitWords(text).filter((w) => !STOP.has(w) && !NUMBER.test(w));
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
