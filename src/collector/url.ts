/**
 * URL feature extraction. Pure — no chrome.* — so it can be unit-tested in Node and reused by
 * the tools. Lives in collector/ because it is called at capture time.
 */
import suffixes from './suffixes.json';

const SUFFIX_SET: ReadonlySet<string> = new Set([...suffixes.private, ...suffixes.icann]);

export interface UrlFeatures {
  host: string;
  eTLD1: string;
  pathTokens: string[];
  queryKeys: Record<string, string>;
}

/** Path segments that carry no project meaning on their own. */
const NOISE_TOKENS = new Set(['', 'index', 'html', 'htm', 'php', 'aspx', 'www']);

/**
 * Registrable domain from a hostname using the trimmed suffix list. When ambiguous, split rather
 * than collapse: an unknown multi-label suffix falls back to last-two-labels, but a host that is
 * itself a listed suffix (e.g. "github.io") is returned as-is rather than shortened.
 */
export function eTLD1(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h || /^[\d.]+$/.test(h) || h.includes(':')) return h; // IPv4 / IPv6 literal
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  // Walk from the longest candidate suffix down, so "s3.amazonaws.com" beats "amazonaws.com".
  for (let i = 1; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    if (SUFFIX_SET.has(candidate)) {
      return labels.slice(i - 1).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

export function urlFeatures(raw: string): UrlFeatures {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { host: '', eTLD1: '', pathTokens: [], queryKeys: {} };
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const pathTokens = u.pathname
    .split(/[/._\-~]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => !NOISE_TOKENS.has(t));
  const queryKeys: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    // First value wins; values are truncated so a trace never stores a huge token.
    if (!(k in queryKeys)) queryKeys[k] = v.slice(0, 200);
  });
  return { host, eTLD1: eTLD1(host), pathTokens, queryKeys };
}

/** Host + path only — what a shareable export keeps of a URL. */
export function reduceUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '';
  }
}
