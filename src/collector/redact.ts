/**
 * Shareable-export redaction. Pure — no chrome.* — so the x-ray export, tools/read-profile.ts and
 * the labels template apply exactly the same rules, and they are unit-tested.
 *
 * A shareable file is meant to leave the machine (testers send theirs; the repository is public).
 * It keeps what the clusterer needs and nothing else:
 *
 *   - URL reduced to scheme + host + path; query values blanked (keys are S6 features).
 *   - Identifier-looking runs in the host and path — anything with a digit and 4+ characters,
 *     mixed-case slugs of 12+, any run of 20+ — become stand-ins: share links, download tokens,
 *     document / workspace / job / account ids. Each distinct value gets a fresh RANDOM stand-in
 *     from a table that lives only in memory for one export: the same value gets the same stand-in
 *     throughout that file (so tabs that shared an id still share it — S6, S7 and S5 see the same
 *     equalities), nothing links a stand-in to its value or to any other export, and a numeric id
 *     stays numeric (S7 ignores pure numbers, so the text signal is unchanged). Not a hash: a keyed
 *     hash of a low-entropy id (a year, a 6-digit job number) can be tested against guesses by anyone
 *     who recovers the key, and the first version here used a non-cryptographic one (DECISIONS
 *     2026-10-05).
 *   - Email addresses in titles, descriptions and headings become "[email]".
 *   - Mail, chat, calendar and search tabs (the ambient list) keep no title or page text: they are
 *     excluded from clustering, and their headings are other people's subject lines.
 *   - Local files keep nothing but the fact that they were local files.
 *   - Page text (leadText) is dropped.
 */
import { isAmbient } from '../cluster/affinity';
import { decodeSegment } from '../cluster/lexical';
import type { TabTrace } from '../cluster/types';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RUN = /[A-Za-z0-9]+/g;

export function scrubText(s: string): string {
  return s.replace(EMAIL, '[email]');
}

/** Decided on the run as it appeared in the URL, so mixed case still counts. */
export function looksLikeId(run: string): boolean {
  if (run.length >= 4 && /\d/.test(run)) return true;
  if (run.length >= 12 && /[a-z]/.test(run) && /[A-Z]/.test(run)) return true;
  return run.length >= 20;
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function randomDigits(n: number): string {
  let out = '';
  while (out.length < n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    for (const x of b) if (x < 250 && out.length < n) out += String(x % 10); // 250-255 rejected: no bias
  }
  return out;
}

/**
 * Redact a set of traces for one shareable file. Stand-ins are consistent inside the returned set
 * and meaningless outside it: the table is a local variable and is never written anywhere.
 */
export function redactTraces(traces: TabTrace[]): TabTrace[] {
  const table = new Map<string, string>();
  const used = new Set<string>();
  const stand = (key: string): string => {
    const known = table.get(key);
    if (known) return known;
    let s: string;
    do s = /^\d+$/.test(key) ? randomDigits(12) : `id${randomHex(6)}`;
    while (used.has(s));
    used.add(s);
    table.set(key, s);
    return s;
  };
  // Keys are lower-case: pathTokens and hosts are lower-cased when recorded, URLs keep case.
  const idKeys = new Set<string>();
  const remember = (s: string) => {
    for (const run of s.match(RUN) ?? []) if (looksLikeId(run)) idKeys.add(run.toLowerCase());
  };
  // Ids are looked for in DECODED text: in "/my%20notes" the run "20notes" is an escape plus a
  // word, not an id. S7 decodes path tokens the same way (lexical.decodeSegment).
  const decodePath = (p: string) => p.split('/').map(decodeSegment).join('/');
  for (const t of traces) {
    remember(t.host ?? '');
    try {
      remember(decodePath(new URL(t.url).pathname));
    } catch {
      /* not a URL */
    }
    for (const p of t.pathTokens ?? []) remember(decodeSegment(p));
  }
  const swap = (s: string) => s.replace(RUN, (run) => (idKeys.has(run.toLowerCase()) ? stand(run.toLowerCase()) : run));
  /** A path token: decoded, ids swapped, re-encoded if it was encoded — S6 sees the same
   *  equalities, and S7 (which decodes) sees the same words with ids renamed. */
  const swapToken = (p: string) => {
    const d = decodeSegment(p);
    if (d === p) return swap(p);
    const s = swap(d);
    return s === d ? p : encodeURIComponent(s);
  };

  return traces.map((t) => {
    if (/^file:/i.test(t.url)) {
      return { ...t, url: 'file:///', title: '[local file]', host: '', eTLD1: '', pathTokens: [], queryKeys: {}, digest: null };
    }
    let url = '';
    try {
      const u = new URL(t.url);
      url = `${u.protocol}//${swap(u.host)}${swap(decodePath(u.pathname))}`;
    } catch {
      url = '';
    }
    const ambient = /^https?:/i.test(t.url) && isAmbient(t);
    return {
      ...t,
      url,
      host: swap(t.host ?? ''),
      eTLD1: swap(t.eTLD1 ?? ''),
      pathTokens: (t.pathTokens ?? []).map(swapToken),
      queryKeys: Object.fromEntries(Object.keys(t.queryKeys ?? {}).map((k) => [k, ''])),
      title: ambient ? '' : scrubText(t.title ?? ''),
      digest:
        ambient || !t.digest
          ? null
          : { description: scrubText(t.digest.description), headings: t.digest.headings.map(scrubText), leadText: '' },
    };
  });
}
