/**
 * Phase 1 records. Free of `chrome.*` so the pure parts run in Node.
 *
 * An archive card is what "Archive & close" writes BEFORE it closes anything: the group's name,
 * the event it belonged to, and one line per tab with everything needed to bring it back and to
 * recognise it later. Nothing is ever deleted except by an explicit "forget" (§6.10).
 */
import type { Digest } from '../cluster/types';

/** Chrome's fixed tab-group colour enum (§5.6). */
export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** Which tier produced a group's name. */
export type NamingTier = 'nano' | 'heuristic';

export interface GroupName {
  /** ≤ 24 characters. Proposed, never typed by the user (§6.7). */
  name: string;
  color: GroupColor;
  tier: NamingTier;
}

export interface ArchivedTab {
  traceId: string;
  url: string;
  title: string;
  host: string;
  /** Position in the group at archive time; restore recreates this order. */
  order: number;
  digest: Digest | null;
  /** Written later by the summarisation queue; null until then, or if the Summarizer is unavailable. */
  summary: string | null;
  openedAt: number;
}

export interface ArchiveCard {
  cardId: string;
  name: string;
  color: GroupColor;
  tier: NamingTier;
  /** Event label, e.g. "Tuesday afternoon" (§6.5). Empty when the group had no real timing. */
  when: string;
  hosts: string[];
  archivedAt: number;
  /** Undo stays reachable until this time (§6.8: 24 h, survives restart). */
  undoUntil: number;
  tabs: ArchivedTab[];
  /** Set when the whole card was brought back. The card stays — nothing is deleted. */
  restoredAt: number | null;
  /** Community id the card came from; stable within one sweep only. */
  sourceCommunity: number;
}

/** A queued piece of long work for the offscreen document (§5.5). */
export interface SummariseJob {
  jobId: string;
  cardId: string;
  traceId: string;
  createdAt: number;
  attempts: number;
  /** 'done' and 'unavailable' are terminal. */
  state: 'pending' | 'done' | 'unavailable' | 'failed';
}

export const UNDO_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_NAME_CHARS = 24;
