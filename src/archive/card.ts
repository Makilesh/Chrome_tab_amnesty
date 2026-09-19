/**
 * Pure helpers for archive cards: building one from a community, the colour a project keeps
 * across sweeps, and what "bring it back" has to recreate. No `chrome.*`, unit-tested.
 */
import type { Community, TabTrace } from '../cluster/types';
import { GROUP_COLORS, type ArchiveCard, type ArchivedTab, type GroupColor, type GroupName, UNDO_WINDOW_MS } from './types';

/** FNV-1a over the string; small and stable across runs and machines. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The host most tabs in the group are on; ties go to the first seen. */
export function dominantHost(traces: TabTrace[]): string {
  const count = new Map<string, number>();
  for (const t of traces) count.set(t.eTLD1 || t.host, (count.get(t.eTLD1 || t.host) ?? 0) + 1);
  let best = '';
  let n = 0;
  for (const [h, c] of count) if (c > n) [best, n] = [h, c];
  return best;
}

/**
 * Colour by stable hash of the dominant registrable domain, so a project keeps its colour from
 * one sweep to the next (recognisability beats aesthetics). Grey is skipped: it reads as
 * "unnamed" on the strip.
 */
export function colorFor(traces: TabTrace[]): GroupColor {
  const palette = GROUP_COLORS.filter((c) => c !== 'grey');
  return palette[stableHash(dominantHost(traces)) % palette.length]!;
}

/** Members in strip order (window, then index) — the order restore recreates. */
export function inStripOrder(traces: TabTrace[]): TabTrace[] {
  return [...traces].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
}

export function buildCard(
  community: Community,
  members: TabTrace[],
  name: GroupName,
  when: string,
  hosts: string[],
  now = Date.now(),
  id: string = crypto.randomUUID(),
): ArchiveCard {
  const tabs: ArchivedTab[] = inStripOrder(members).map((t, order) => ({
    traceId: t.traceId,
    url: t.url,
    title: t.title,
    host: t.host,
    order,
    digest: t.digest,
    summary: null,
    openedAt: t.openedAt,
  }));
  return {
    cardId: id,
    name: name.name,
    color: name.color,
    tier: name.tier,
    when,
    hosts,
    archivedAt: now,
    undoUntil: now + UNDO_WINDOW_MS,
    tabs,
    restoredAt: null,
    sourceCommunity: community.id,
  };
}

export function undoable(card: ArchiveCard, now = Date.now()): boolean {
  return card.restoredAt === null && now < card.undoUntil;
}

/** URLs in the order they should be recreated. */
export function restoreOrder(card: ArchiveCard): ArchivedTab[] {
  return [...card.tabs].sort((a, b) => a.order - b.order);
}
