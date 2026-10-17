/**
 * Search across everything put away — Phase 2's return path. Pure (no `chrome.*`), unit-tested.
 * Lexical on purpose: the brief says semantic only if lexical proves insufficient, measured first.
 *
 * Every word typed must start a word somewhere in a put-away tab or in its card: the tab's title,
 * address, site, the page's description, headings and opening text, its summary; the card's
 * name, sites and when ("tuesday" finds Tuesday's). Case and accents are ignored ("belem" finds
 * "Belém"). A word found only in the card's own name or when shows the whole card.
 */
import { cardWhen, restoreOrder } from './card';
import type { ArchiveCard, ArchivedTab } from './types';

export interface SearchHit {
  card: ArchiveCard;
  /** The tabs that matched, in the card's order; all of them when the card itself matched. */
  tabs: ArchivedTab[];
  /** The card itself matched (its name, sites or when), not only some of its tabs. */
  whole: boolean;
  score: number;
}

/** Lower case, accents off: "Belém" -> "belem". */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

function words(s: string | null | undefined): string[] {
  return s ? fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean) : [];
}

/** The words of a query. */
export function queryTerms(q: string): string[] {
  return [...new Set(words(q))];
}

/** Field weights: what a person most likely remembers counts most. */
const TAB_FIELDS: [number, (t: ArchivedTab) => string | null | undefined][] = [
  [3, (t) => t.title],
  [2, (t) => t.summary],
  [2, (t) => t.digest?.headings.join(' ')],
  [1.5, (t) => t.digest?.description],
  [1.5, (t) => t.host],
  [1, (t) => decodeSafe(t.url)],
  [1, (t) => t.digest?.leadText],
];

function decodeSafe(u: string): string {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
}

/** Best weight at which a term starts a word among the fields, 0 when it does not. */
function weightOf(term: string, fields: [number, string[]][]): number {
  let best = 0;
  for (const [w, ws] of fields) if (w > best && ws.some((x) => x.startsWith(term))) best = w;
  return best;
}

export function searchArchive(cards: readonly ArchiveCard[], query: string, now = Date.now()): SearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const card of cards) {
    const cardFields: [number, string[]][] = [
      [3, words(card.name)],
      [1, words(cardWhen(card, now))],
      [1, words(card.hosts.join(' '))],
    ];
    const cardWeights = terms.map((t) => weightOf(t, cardFields));
    if (cardWeights.every((w) => w > 0)) {
      hits.push({ card, tabs: restoreOrder(card), whole: true, score: cardWeights.reduce((s, w) => s + w, 0) });
      continue;
    }
    let best = 0;
    const tabs: ArchivedTab[] = [];
    for (const tab of restoreOrder(card)) {
      const tabFields: [number, string[]][] = TAB_FIELDS.map(([w, get]) => [w, words(get(tab))]);
      let score = 0;
      let all = true;
      for (let i = 0; i < terms.length; i++) {
        const w = Math.max(weightOf(terms[i]!, tabFields), cardWeights[i]!);
        if (w === 0) {
          all = false;
          break;
        }
        score += w;
      }
      if (!all) continue;
      tabs.push(tab);
      best = Math.max(best, score);
    }
    if (tabs.length) hits.push({ card, tabs, whole: false, score: best });
  }
  return hits.sort((a, b) => b.score - a.score || b.card.archivedAt - a.card.archivedAt);
}
