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
 *     document / workspace / job / account ids. The stand-in is the same for the same value
 *     throughout one export (so tabs that shared an id still share it: S6, S7 and S5 see the same
 *     equalities), differs between exports (a per-export random salt that is never written out), and
 *     a numeric id stays numeric (S7 ignores pure numbers, so the text signal is unchanged).
 *   - Email addresses in titles, descriptions and headings become "[email]".
 *   - Mail, chat, calendar and search tabs (the ambient list) keep no title or page text: they are
 *     excluded from clustering, and their headings are other people's subject lines.
 *   - Local files keep nothing but the fact that they were local files.
 *   - Page text (leadText) is dropped.
 */
import { isAmbient } from '../cluster/affinity';
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

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Redact a set of traces for one shareable file. One salt per call: stand-ins are consistent
 * inside the returned set and meaningless outside it. Pass a fixed salt only in tests.
 */
export function redactTraces(traces: TabTrace[], salt: string = randomSalt()): TabTrace[] {
  const stand = (key: string): string => {
    const a = fnv1a(`${salt}\u0000${key}`);
    const b = fnv1a(`${key}\u0000${salt}`);
    if (/^\d+$/.test(key)) return (BigInt(a) * 4294967296n + BigInt(b)).toString().padStart(12, '0').slice(-12);
    return `id${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0').slice(0, 4)}`;
  };
  // Keys are lower-case: pathTokens and hosts are lower-cased when recorded, URLs keep case.
  const idKeys = new Set<string>();
  const remember = (s: string) => {
    for (const run of s.match(RUN) ?? []) if (looksLikeId(run)) idKeys.add(run.toLowerCase());
  };
  for (const t of traces) {
    remember(t.host ?? '');
    try {
      remember(new URL(t.url).pathname);
    } catch {
      /* not a URL */
    }
    for (const p of t.pathTokens ?? []) remember(p);
  }
  const swap = (s: string) => s.replace(RUN, (run) => (idKeys.has(run.toLowerCase()) ? stand(run.toLowerCase()) : run));

  return traces.map((t) => {
    if (/^file:/i.test(t.url)) {
      return { ...t, url: 'file:///', title: '[local file]', host: '', eTLD1: '', pathTokens: [], queryKeys: {}, digest: null };
    }
    let url = '';
    try {
      const u = new URL(t.url);
      url = `${u.protocol}//${swap(u.host)}${swap(u.pathname)}`;
    } catch {
      url = '';
    }
    const ambient = /^https?:/i.test(t.url) && isAmbient(t);
    return {
      ...t,
      url,
      host: swap(t.host ?? ''),
      eTLD1: swap(t.eTLD1 ?? ''),
      pathTokens: (t.pathTokens ?? []).map(swap),
      queryKeys: Object.fromEntries(Object.keys(t.queryKeys ?? {}).map((k) => [k, ''])),
      title: ambient ? '' : scrubText(t.title ?? ''),
      digest:
        ambient || !t.digest
          ? null
          : { description: scrubText(t.digest.description), headings: t.digest.headings.map(scrubText), leadText: '' },
    };
  });
}
