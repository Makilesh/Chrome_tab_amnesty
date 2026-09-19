/**
 * Read-only descriptions of a community for the x-ray page. No AI in Phase 0, so the heading is
 * heuristic: the highest-IDF tokens the group shares, plus its hosts. The user never names
 * anything (§6.7); date is secondary metadata (§6.5). No counts of anything (§6.1).
 */
import { tokens } from './lexical';
import { timingKnown } from './segment';
import type { Community, TabTrace } from './types';

export interface Description {
  /** e.g. "deploy · rollout · acme" — or the dominant host when nothing is shared */
  heading: string;
  /** hosts in the group, most common first */
  hosts: string[];
  /** "Tuesday afternoon" — when the burst started; secondary, never the label */
  when: string;
}

const STOPPY = new Set(['github', 'docs', 'google', 'wiki', 'wikipedia', 'stackoverflow', 'reddit', 'youtube']);

export function whenLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { weekday: 'long' });
  const h = d.getHours();
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  const ageDays = (now - ms) / 86_400_000;
  if (ageDays < 1 && new Date(now).getDate() === d.getDate()) return `this ${part}`;
  if (ageDays < 2 && new Date(now - 86_400_000).getDate() === d.getDate()) return `yesterday ${part}`;
  if (ageDays < 7) return `${day} ${part}`;
  if (ageDays < 14) return `last ${day}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

export function describe(community: Community, byId: Map<string, TabTrace>, corpus: TabTrace[]): Description {
  const members = community.traceIds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);

  // hosts, most common first
  const hostCount = new Map<string, number>();
  for (const t of members) hostCount.set(t.host, (hostCount.get(t.host) ?? 0) + 1);
  const hosts = [...hostCount.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);

  // shared tokens ranked by (share of members containing it) * idf over the whole corpus
  const df = new Map<string, number>();
  for (const t of corpus) for (const w of new Set(tokens(t))) df.set(w, (df.get(w) ?? 0) + 1);
  const inGroup = new Map<string, number>();
  for (const t of members) for (const w of new Set(tokens(t))) inGroup.set(w, (inGroup.get(w) ?? 0) + 1);
  const n = corpus.length;
  const ranked = [...inGroup.entries()]
    .filter(([w, k]) => k >= Math.max(2, members.length * 0.4) && !STOPPY.has(w) && w.length > 2)
    .map(([w, k]) => [w, (k / members.length) * Math.log((n + 1) / ((df.get(w) ?? 0) + 1))] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  const heading = ranked.length ? ranked.join(' · ') : (hosts[0] ?? '');
  // §6.5: label by event. A restore-time timestamp is not an event, so it never labels a group.
  const timed = members.filter(timingKnown);
  const when = timed.length ? whenLabel(Math.min(...timed.map((t) => t.openedAt))) : '';
  return { heading, hosts, when };
}
