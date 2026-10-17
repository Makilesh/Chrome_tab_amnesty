/**
 * Forgetting is first-class (§6.10). The pure part: the never-remember test. The stored list
 * lives in the `meta` store (see store.ts) so the collector, the sweep page and the queue all
 * read the same one.
 */
import type { TabTrace } from '../cluster/types';

/**
 * Normalise what a person types or pastes into the host a trace records: "www.Example.co.uk/" ->
 * "example.co.uk". Parsed as a url, so a port, a login, a path or a query goes, and a Unicode name
 * becomes the punycode Chrome records ("bücher.de" -> "xn--bcher-kva.de") — before, such an entry
 * was listed but matched nothing, and the site went on being recorded.
 */
export function normaliseDomain(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return '';
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `http://${s}`).hostname;
    return host.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return s.replace(/^[a-z]+:\/\//, '').replace(/[/?#:].*$/, '').replace(/^www\./, '');
  }
}

/** A never-remembered site named anywhere in a group name (its domain, or that domain's first word). */
export function namesNeverSite(name: string, never: readonly string[]): boolean {
  const n = name.toLowerCase();
  return never.some((d) => d && (n.includes(d) || ((d.split('.')[0] ?? '').length >= 4 && n.includes(d.split('.')[0]!))));
}

/** True when the trace's site, or any parent of it, is on the list. */
export function isNeverRemembered(t: Partial<Pick<TabTrace, 'host' | 'eTLD1'>>, list: readonly string[]): boolean {
  if (list.length === 0) return false;
  const host = (t.host ?? '').toLowerCase();
  const etld1 = (t.eTLD1 ?? '').toLowerCase();
  for (const d of list) {
    if (!d) continue;
    if (host === d || etld1 === d || host.endsWith('.' + d)) return true;
  }
  return false;
}
