/**
 * Forgetting is first-class (§6.10). The pure part: the never-remember test. The stored list
 * lives in the `meta` store (see store.ts) so the collector, the sweep page and the queue all
 * read the same one.
 */
import type { TabTrace } from '../cluster/types';

/** Normalise what a person types: "www.Example.co.uk/" -> "example.co.uk". */
export function normaliseDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return s;
}

/** True when the trace's site, or any parent of it, is on the list. */
export function isNeverRemembered(t: Pick<TabTrace, 'host' | 'eTLD1'>, list: readonly string[]): boolean {
  if (list.length === 0) return false;
  const host = (t.host ?? '').toLowerCase();
  const etld1 = (t.eTLD1 ?? '').toLowerCase();
  for (const d of list) {
    if (!d) continue;
    if (host === d || etld1 === d || host.endsWith('.' + d)) return true;
  }
  return false;
}
