/**
 * Group naming — the only model call in the product, one per community, never per tab.
 *
 * Tiers (§7 Phase 1): on-device Gemini Nano via the Prompt API when `availability()` says so;
 * otherwise the heuristic (highest-IDF shared tokens or the dominant domain). Nothing leaves the
 * machine in either tier. The model is fed the *evidence* for the grouping — timing, what was
 * typed first, what got switched between — not just a title list, because a bare title list
 * produces "Various Development Resources".
 *
 * `evidence()` and `heuristicName()` are pure and unit-tested; `nanoName()` touches the browser.
 */
import { colorFor } from './card';
import { GROUP_COLORS, type GroupColor, type GroupName, MAX_NAME_CHARS } from './types';
import { describe, type Description } from '../cluster/describe';
import { timingKnown } from '../cluster/segment';
import type { Community, TabTrace } from '../cluster/types';

// --- evidence --------------------------------------------------------------------------------

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** A short factual account of why these tabs are one group. Titles last, evidence first. */
export function evidence(members: TabTrace[], byId: Map<string, TabTrace>): string {
  const lines: string[] = [];
  const timed = members.filter(timingKnown).sort((a, b) => a.openedAt - b.openedAt);
  if (timed.length >= 2) {
    const span = timed[timed.length - 1]!.openedAt - timed[0]!.openedAt;
    lines.push(`${timed.length === members.length ? 'All' : timed.length} of these tabs were opened within ${minutes(span)} of each other.`);
  }
  const first = timed[0];
  if (first) {
    const how = first.transition === 'typed' ? 'a typed visit to' : first.transition === 'link' ? 'a link to' : 'a visit to';
    lines.push(`It started with ${how} ${first.host}${first.title ? ` ("${first.title.slice(0, 60)}")` : ''}.`);
  }
  const ids = new Set(members.map((t) => t.traceId));
  const chained = members.filter((t) => t.openerTraceId && ids.has(t.openerTraceId)).length;
  if (chained > 0) lines.push(`${chained} of them were opened from another tab in the group.`);
  const switches = members.reduce((n, t) => n + Object.entries(t.coActive).filter(([o]) => ids.has(o)).reduce((s, [, c]) => s + c, 0), 0);
  if (switches >= 2) lines.push('The person switched back and forth between these tabs.');
  const hosts = [...new Set(members.map((t) => t.host))];
  lines.push(`Sites: ${hosts.slice(0, 6).join(', ')}${hosts.length > 6 ? ', …' : ''}.`);
  lines.push('Tabs:');
  for (const t of members.slice(0, 12)) {
    const desc = t.digest?.description ? ` — ${t.digest.description.slice(0, 80)}` : '';
    lines.push(`- ${t.title.slice(0, 80) || t.url}${desc}`);
  }
  if (members.length > 12) lines.push('- …');
  void byId;
  return lines.join('\n');
}

// --- heuristic tier --------------------------------------------------------------------------

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function clampName(s: string): string {
  const cleaned = s.replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s.]+$/g, '').trim();
  if (cleaned.length <= MAX_NAME_CHARS) return cleaned;
  const cut = cleaned.slice(0, MAX_NAME_CHARS);
  const sp = cut.lastIndexOf(' ');
  return (sp > 8 ? cut.slice(0, sp) : cut).trim();
}

/** Heuristic name from the x-ray description: shared tokens, else the dominant domain. */
export function heuristicName(members: TabTrace[], d: Description): GroupName {
  const fromTokens = d.heading.includes(' · ') || !d.heading.includes('.') ? d.heading.split(' · ').map(titleCase).join(' ') : '';
  const name = clampName(fromTokens || d.hosts[0]?.replace(/^www\./, '') || 'Untitled') || 'Untitled';
  return { name, color: colorFor(members), tier: 'heuristic' };
}

// --- on-device tier --------------------------------------------------------------------------

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: MAX_NAME_CHARS },
    color: { type: 'string', enum: [...GROUP_COLORS] },
  },
  required: ['name', 'color'],
  additionalProperties: false,
};

const SYSTEM =
  'You name groups of browser tabs for the person who opened them. A group is one thing they were doing — ' +
  'a task, an errand, a piece of research — not a topic. Answer with a short, specific name (at most 24 ' +
  'characters) in the language of the tabs, the kind of name the person would recognise at a glance. ' +
  'Never describe the person or judge what they did. Pick the colour that fits the group.';

export async function nanoAvailable(): Promise<boolean> {
  try {
    return typeof LanguageModel !== 'undefined' && (await LanguageModel.availability()) === 'available';
  } catch {
    return false;
  }
}

/** One prompt per community. Returns null when the model is unavailable or answers badly. */
export async function nanoName(members: TabTrace[], byId: Map<string, TabTrace>, fallbackColor: GroupColor): Promise<GroupName | null> {
  if (!(await nanoAvailable())) return null;
  let session: LanguageModelSession | null = null;
  try {
    session = await LanguageModel!.create({ initialPrompts: [{ role: 'system', content: SYSTEM }], temperature: 0.3, topK: 3 });
    const raw = await session.prompt(evidence(members, byId), { responseConstraint: SCHEMA });
    const parsed = JSON.parse(raw) as { name?: unknown; color?: unknown };
    const name = typeof parsed.name === 'string' ? clampName(parsed.name) : '';
    if (!name) return null;
    const color = (GROUP_COLORS as readonly string[]).includes(parsed.color as string) ? (parsed.color as GroupColor) : fallbackColor;
    return { name, color, tier: 'nano' };
  } catch {
    return null;
  } finally {
    session?.destroy();
  }
}

/** The name for a community: Nano if it can, the heuristic otherwise. Always returns something. */
export async function nameGroup(community: Community, byId: Map<string, TabTrace>, corpus: TabTrace[]): Promise<GroupName & { description: Description }> {
  const members = community.traceIds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
  const description = describe(community, byId, corpus);
  const heuristic = heuristicName(members, description);
  const nano = await nanoName(members, byId, heuristic.color);
  // Colour always comes from the stable hash so a project keeps it across sweeps; the model only
  // gets a say when the hash colour is unavailable.
  return { ...(nano ?? heuristic), color: heuristic.color, description };
}
