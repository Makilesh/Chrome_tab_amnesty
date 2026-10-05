/**
 * Shareable-export redaction. Pure — no chrome.* — so the x-ray export, tools/read-profile.ts and
 * the labels template all apply exactly the same rules, and they are unit-tested.
 *
 * Shareable keeps what the clusterer needs (titles for S7, path tokens, query KEYS for S6, headings)
 * and drops what it does not: query values, page text, and anything shaped like an email address.
 * Titles and headings carry addresses more often than one would think — Gmail puts the account and
 * senders in them — and a shareable file is meant to leave the machine.
 */
import type { TabTrace } from '../cluster/types';
import { reduceUrl } from './url';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function scrubText(s: string): string {
  return s.replace(EMAIL, '[email]');
}

export function redactTrace(t: TabTrace): TabTrace {
  return {
    ...t,
    url: reduceUrl(t.url),
    title: scrubText(t.title),
    queryKeys: Object.fromEntries(Object.keys(t.queryKeys).map((k) => [k, ''])),
    digest: t.digest
      ? { description: scrubText(t.digest.description), headings: t.digest.headings.map(scrubText), leadText: '' }
      : null,
  };
}
