/**
 * Phase 1 gate measurement. Pure — no `chrome.*` — so the report runs in Node.
 *
 * The gate: testers press Archive & close of their own accord, AND their open-tab count is still
 * lower seven days later. The collector keeps a snapshot of the open-tab count every few hours;
 * the archive cards say when Archive & close was pressed. Neither number is ever shown in the
 * product (§6.1) — they exist only in the study export and in `npm run phase1`.
 *
 * Whether a press was unprompted cannot be seen in data; that is the tester's report.
 */
import type { ArchiveCard, NamingTier } from './types';

export interface OpenSnapshot {
  at: number;
  /** http(s) tabs open across all normal windows at `at`. */
  open: number;
}

export interface StudyArchive {
  archivedAt: number;
  tabs: number;
  tier: NamingTier;
  restoredAt: number | null;
}

export interface StudySummary {
  kind: 'tab-amnesty-phase1-study';
  schemaVersion: 1;
  exportedAt: number;
  snapshots: OpenSnapshot[];
  archives: StudyArchive[];
}

export const SNAPSHOT_EVERY_MIN = 360;
/** 60 days at one snapshot per 6 h. */
export const MAX_SNAPSHOTS = 240;
const DAY = 86_400_000;

export function appendSnapshot(list: OpenSnapshot[], s: OpenSnapshot): OpenSnapshot[] {
  return [...list, s].slice(-MAX_SNAPSHOTS);
}

/** What leaves the machine for the study: times and counts only — no names, no URLs. */
export function studySummary(snapshots: OpenSnapshot[], cards: ArchiveCard[], now = Date.now()): StudySummary {
  return {
    kind: 'tab-amnesty-phase1-study',
    schemaVersion: 1,
    exportedAt: now,
    snapshots,
    archives: cards
      .map((c) => ({ archivedAt: c.archivedAt, tabs: c.tabs.length, tier: c.tier, restoredAt: c.restoredAt }))
      .sort((a, b) => a.archivedAt - b.archivedAt),
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface GateReading {
  presses: number;
  pressDays: number;
  broughtBack: number;
  firstPress: number | null;
  /** Median open count over the 48 h before the first press. */
  before: number | null;
  /** Median open count over days 6–8 after the first press. */
  day7: number | null;
  pressed: boolean;
  /** null = not enough snapshots yet to say. */
  lowerAtDay7: boolean | null;
  /** When day 7 can be read, if it cannot yet. */
  readableFrom: number | null;
}

export function readGate(s: StudySummary): GateReading {
  const presses = s.archives.length;
  const pressDays = new Set(s.archives.map((a) => new Date(a.archivedAt).toDateString())).size;
  const broughtBack = s.archives.filter((a) => a.restoredAt !== null).length;
  const firstPress = presses ? s.archives[0]!.archivedAt : null;
  if (firstPress === null) {
    return { presses, pressDays, broughtBack, firstPress, before: null, day7: null, pressed: false, lowerAtDay7: null, readableFrom: null };
  }
  const inRange = (lo: number, hi: number) => s.snapshots.filter((x) => x.at >= lo && x.at < hi).map((x) => x.open);
  const before = median(inRange(firstPress - 2 * DAY, firstPress));
  const day7 = median(inRange(firstPress + 6 * DAY, firstPress + 8 * DAY));
  const lastSnap = s.snapshots.at(-1)?.at ?? 0;
  const complete = lastSnap >= firstPress + 8 * DAY - SNAPSHOT_EVERY_MIN * 60_000;
  const lowerAtDay7 = before === null || day7 === null || !complete ? null : day7 < before;
  return {
    presses,
    pressDays,
    broughtBack,
    firstPress,
    before,
    day7,
    pressed: true,
    lowerAtDay7,
    // With no snapshot before the first press there is nothing to compare against, ever.
    readableFrom: lowerAtDay7 === null && before !== null ? firstPress + 8 * DAY : null,
  };
}
