/**
 * What the person corrected about the groups (§6.7: the model proposes, the person only corrects).
 * Pure: no `chrome.*`, no storage — the sweep page keeps one of these in the meta store and lays it
 * over the clusterer's answer every time it draws.
 *
 * Two corrections exist, because two mistakes do. A project split across sittings is put back
 * together (`together`: a key shared by every tab the person said is one thing). A tab that does
 * not belong is taken out (`apart`): it is on its own until the person puts it back.
 *
 * This is deliberately not part of `src/cluster/`: the gate is measured on what the clusterer
 * proposes, never on what a person fixed afterwards.
 */
import type { Community, Partition } from '../cluster/types';

export interface Corrections {
  /** traceId -> the key of the group the person put it in. Oldest first (insertion order). */
  together: Record<string, string>;
  /** traceIds the person took out of a group. Oldest first. */
  apart: string[];
}

export const NO_CORRECTIONS: Corrections = Object.freeze({ together: Object.freeze({}), apart: Object.freeze([]) as unknown as string[] });

/** Only ids are kept, and only the newest this many of each: old ones are of tabs long closed. */
export const CORRECTIONS_MAX = 2000;

export interface Corrected extends Partition {
  /** Ids (in `communities`) of the groups the person put together: these can be separated again. */
  joined: number[];
  /** Tabs on their own because the person took them out of a group: these can be put back. */
  takenOut: string[];
}

function capped(c: Corrections): Corrections {
  const keys = Object.keys(c.together);
  const together = keys.length > CORRECTIONS_MAX ? Object.fromEntries(keys.slice(-CORRECTIONS_MAX).map((k) => [k, c.together[k]!])) : c.together;
  return { together, apart: c.apart.slice(-CORRECTIONS_MAX) };
}

/** Take one tab out of its group. It leaves any group the person had put it in, too. */
export function takeOut(c: Corrections, traceId: string): Corrections {
  const together = { ...c.together };
  delete together[traceId];
  return capped({ together, apart: [...c.apart.filter((id) => id !== traceId), traceId] });
}

/** Undo `takeOut`: the tab goes back wherever the grouping puts it. */
export function putBack(c: Corrections, traceId: string): Corrections {
  return { together: c.together, apart: c.apart.filter((id) => id !== traceId) };
}

/**
 * Put the tabs of one group (`joining`) together with another's (`into`). They share the key the
 * second group already has, else the first's, else `newKey` — so a third group joins the same one.
 */
export function joinGroups(c: Corrections, joining: readonly string[], into: readonly string[], newKey: string): Corrections {
  const commonest = (ids: readonly string[]): string | undefined => {
    const n = new Map<string, number>();
    for (const id of ids) {
      const k = c.together[id];
      if (k) n.set(k, (n.get(k) ?? 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const key = commonest(into) ?? commonest(joining) ?? newKey;
  const all = [...joining, ...into];
  const moved = new Set(all);
  const together = { ...c.together };
  for (const id of all) {
    delete together[id]; // so these are the newest
    together[id] = key;
  }
  return capped({ together, apart: c.apart.filter((id) => !moved.has(id)) });
}

/** Undo putting together, for these tabs: they go back wherever the grouping puts them. */
export function separate(c: Corrections, traceIds: readonly string[]): Corrections {
  const together = { ...c.together };
  for (const id of traceIds) delete together[id];
  return { together, apart: c.apart };
}

/**
 * The clusterer's groups with the person's corrections laid over them. Every open tab stays in
 * exactly one place; corrections about tabs that are no longer open do nothing.
 *
 * Tabs sharing a key are one group. A group of the clusterer's that holds some of them follows
 * them whole when they are at least half of it — a tab opened later into the project comes along —
 * and otherwise only the person's tabs leave it: one tab regrouped among strangers does not drag
 * them in. A key whose tabs the clusterer already keeps in one group changes nothing.
 */
export function applyCorrections(p: Partition, c: Corrections): Corrected {
  const order = new Map<string, number>();
  for (const com of p.communities) for (const id of com.traceIds) if (!order.has(id)) order.set(id, order.size);
  const grouped = new Set(order.keys());
  for (const id of p.looseEnds) if (!order.has(id)) order.set(id, order.size);
  const at = (id: string) => order.get(id) ?? Infinity;

  const apart = new Set(c.apart.filter((id) => order.has(id)));
  const open = Object.entries(c.together).filter(([id]) => order.has(id) && !apart.has(id));
  const size = new Map<string, number>();
  for (const [, k] of open) size.set(k, (size.get(k) ?? 0) + 1);
  const keyOf = new Map(open.filter(([, k]) => (size.get(k) ?? 0) >= 2)); // one tab is not a group

  const units: string[][] = [
    ...p.communities.map((com) => com.traceIds.filter((id) => !apart.has(id))),
    ...p.looseEnds.filter((id) => !apart.has(id)).map((id) => [id]),
  ];
  const unitsOf = new Map<string, Set<number>>();
  units.forEach((u, i) => {
    for (const id of u) {
      const k = keyOf.get(id);
      if (k) unitsOf.set(k, (unitsOf.get(k) ?? new Set()).add(i));
    }
  });
  const spans = (k: string | undefined): k is string => !!k && (unitsOf.get(k)?.size ?? 0) > 1;

  const merged = new Map<string, string[]>();
  const rest: string[][] = [];
  for (const u of units) {
    const byKey = new Map<string, string[]>();
    const free: string[] = [];
    for (const id of u) {
      const k = keyOf.get(id);
      if (spans(k)) byKey.set(k, [...(byKey.get(k) ?? []), id]);
      else free.push(id);
    }
    if (byKey.size === 0) {
      rest.push(u);
      continue;
    }
    let top = '';
    for (const [k, ids] of byKey) {
      if (!top || ids.length > byKey.get(top)!.length) top = k;
      merged.set(k, [...(merged.get(k) ?? []), ...ids]);
    }
    if (byKey.get(top)!.length >= free.length) merged.get(top)!.push(...free);
    else rest.push(free);
  }

  const groups = [
    ...[...merged.values()].map((ids) => ({ ids: ids.sort((a, b) => at(a) - at(b)), joined: true })),
    ...rest.map((ids) => ({ ids, joined: false })),
  ]
    .filter((g) => g.ids.length >= 2)
    .sort((a, b) => b.ids.length - a.ids.length || at(a.ids[0]!) - at(b.ids[0]!));
  const communities: Community[] = groups.map((g, id) => ({ id, traceIds: g.ids }));
  const placed = new Set(groups.flatMap((g) => g.ids));
  const wasLoose = new Set(p.looseEnds);
  const looseEnds = [...p.looseEnds.filter((id) => !placed.has(id)), ...[...order.keys()].filter((id) => !placed.has(id) && !wasLoose.has(id))];
  return {
    communities,
    looseEnds,
    joined: groups.flatMap((g, id) => (g.joined ? [id] : [])),
    // "Put back" only where it would do something: the grouping had the tab in a group.
    takenOut: looseEnds.filter((id) => apart.has(id) && grouped.has(id)),
  };
}
