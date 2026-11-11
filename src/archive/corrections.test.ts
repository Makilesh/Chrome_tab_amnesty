import { describe, expect, it } from 'vitest';
import type { Partition } from '../cluster/types';
import { applyCorrections, CORRECTIONS_MAX, type Corrections, joinGroups, NO_CORRECTIONS, putBack, separate, takeOut } from './corrections';

/** The clusterer's answer for these tests: two groups and one tab on its own. */
const base: Partition = {
  communities: [
    { id: 0, traceIds: ['a1', 'a2', 'a3'] },
    { id: 1, traceIds: ['b1', 'b2'] },
  ],
  looseEnds: ['x'],
};

const ids = (p: Partition) => p.communities.map((c) => c.traceIds);

describe('corrections', () => {
  it('changes nothing when the person corrected nothing', () => {
    const out = applyCorrections(base, NO_CORRECTIONS);
    expect(ids(out)).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2']]);
    expect(out.looseEnds).toEqual(['x']);
    expect(out.joined).toEqual([]);
    expect(out.takenOut).toEqual([]);
  });

  it('a tab taken out is on its own, and says so; put back, it returns to its group', () => {
    const c = takeOut(NO_CORRECTIONS, 'a2');
    const out = applyCorrections(base, c);
    expect(ids(out)).toEqual([['a1', 'a3'], ['b1', 'b2']]);
    expect(out.looseEnds).toEqual(['x', 'a2']);
    expect(out.takenOut).toEqual(['a2']);
    const back = applyCorrections(base, putBack(c, 'a2'));
    expect(ids(back)).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2']]);
    expect(back.takenOut).toEqual([]);
  });

  it('a group left with one tab is not a group: that tab is on its own too', () => {
    const out = applyCorrections(base, takeOut(NO_CORRECTIONS, 'b1'));
    expect(ids(out)).toEqual([['a1', 'a2', 'a3']]);
    expect(out.looseEnds).toEqual(['x', 'b1', 'b2']);
    expect(out.takenOut).toEqual(['b1']); // only b1 gets "Put back": b2 was not taken out
  });

  it('two groups put together are one group, in the order they stood, and marked as the person’s', () => {
    const c = joinGroups(NO_CORRECTIONS, ['b1', 'b2'], ['a1', 'a2', 'a3'], 'k1');
    const out = applyCorrections(base, c);
    expect(ids(out)).toEqual([['a1', 'a2', 'a3', 'b1', 'b2']]);
    expect(out.joined).toEqual([0]);
    expect(out.looseEnds).toEqual(['x']);
  });

  it('separating them again gives back the grouping as it was', () => {
    const c = joinGroups(NO_CORRECTIONS, ['b1', 'b2'], ['a1', 'a2', 'a3'], 'k1');
    const out = applyCorrections(base, separate(c, ['a1', 'a2', 'a3', 'b1', 'b2']));
    expect(ids(out)).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2']]);
    expect(out.joined).toEqual([]);
  });

  it('joining a third group keeps the key the first two already share', () => {
    const three: Partition = { communities: [...base.communities, { id: 2, traceIds: ['c1', 'c2'] }], looseEnds: [] };
    let c = joinGroups(NO_CORRECTIONS, ['b1', 'b2'], ['a1', 'a2', 'a3'], 'k1');
    c = joinGroups(c, ['c1', 'c2'], ['a1', 'a2', 'a3', 'b1', 'b2'], 'k2');
    expect(new Set(Object.values(c.together))).toEqual(new Set(['k1']));
    expect(ids(applyCorrections(three, c))).toEqual([['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2']]);
  });

  it('a tab opened later into one of the joined groups follows them', () => {
    const c = joinGroups(NO_CORRECTIONS, ['b1', 'b2'], ['a1', 'a2', 'a3'], 'k1');
    const later: Partition = { communities: [{ id: 0, traceIds: ['a1', 'a2', 'a3', 'new'] }, { id: 1, traceIds: ['b1', 'b2'] }], looseEnds: [] };
    expect(ids(applyCorrections(later, c))).toEqual([['a1', 'a2', 'a3', 'new', 'b1', 'b2']]);
  });

  it('one joined tab regrouped among many strangers does not pull them all in', () => {
    const c = joinGroups(NO_CORRECTIONS, ['b1', 'b2'], ['a1', 'a2', 'a3'], 'k1');
    const shifted: Partition = {
      communities: [
        { id: 0, traceIds: ['a1', 'a2', 'a3'] },
        { id: 1, traceIds: ['b1', 's1', 's2', 's3'] },
        { id: 2, traceIds: ['b2', 't1'] },
      ],
      looseEnds: [],
    };
    const out = applyCorrections(shifted, c);
    // b1 leaves the strangers (three of them, one of it); b2's pair is half the person's, so t1 follows.
    expect(ids(out)).toEqual([['a1', 'a2', 'a3', 'b1', 'b2', 't1'], ['s1', 's2', 's3']]);
    expect(out.joined).toEqual([0]);
  });

  it('a tab on its own can be among those put together', () => {
    const c = joinGroups(NO_CORRECTIONS, ['x'], ['b1', 'b2'], 'k1');
    const out = applyCorrections(base, c);
    expect(ids(out)).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'x']]);
    expect(out.looseEnds).toEqual([]);
  });

  it('taking a tab out of a joined group takes it out of the joining too', () => {
    let c: Corrections = joinGroups(NO_CORRECTIONS, ['b1', 'b2'], ['a1', 'a2', 'a3'], 'k1');
    c = takeOut(c, 'b1');
    expect(c.together.b1).toBeUndefined();
    const out = applyCorrections(base, c);
    expect(ids(out)).toEqual([['a1', 'a2', 'a3', 'b2']]);
    expect(out.looseEnds).toEqual(['x', 'b1']);
  });

  it('putting a taken-out tab together with a group puts it back in play', () => {
    let c = takeOut(NO_CORRECTIONS, 'a2');
    c = joinGroups(c, ['a2'], ['b1', 'b2'], 'k1');
    expect(c.apart).toEqual([]);
    expect(ids(applyCorrections(base, c))).toEqual([['a2', 'b1', 'b2'], ['a1', 'a3']]);
  });

  it('ignores corrections about tabs that are not open, and never invents a tab', () => {
    const c: Corrections = { together: { gone1: 'k', gone2: 'k', a1: 'k' }, apart: ['gone3'] };
    const out = applyCorrections(base, c);
    // a1's companions are closed: one tab is not a group, so it stays where the grouping has it.
    expect(ids(out)).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2']]);
    expect(out.looseEnds).toEqual(['x']);
    expect(out.joined).toEqual([]);
    expect(out.takenOut).toEqual([]);
  });

  it('tabs the person joined that the grouping now keeps together anyway change nothing', () => {
    const c: Corrections = { together: { a1: 'k', a2: 'k' }, apart: [] };
    const out = applyCorrections({ communities: [{ id: 0, traceIds: ['a1', 'a2', 'u1', 'u2', 'u3'] }], looseEnds: [] }, c);
    expect(ids(out)).toEqual([['a1', 'a2', 'u1', 'u2', 'u3']]);
    expect(out.joined).toEqual([]);
  });

  it('a tab taken out that the grouping leaves on its own anyway has nothing to be put back into', () => {
    expect(applyCorrections(base, takeOut(NO_CORRECTIONS, 'x')).takenOut).toEqual([]);
  });

  it('every open tab is in exactly one place, whatever the corrections', () => {
    let c = joinGroups(NO_CORRECTIONS, ['b1'], ['a1'], 'k1');
    c = takeOut(c, 'a3');
    c = joinGroups(c, ['x'], ['b2'], 'k2');
    const out = applyCorrections(base, c);
    const all = out.communities.flatMap((g) => g.traceIds).concat(out.looseEnds);
    expect(all.sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'x']);
    expect(new Set(all).size).toBe(all.length);
    expect(out.communities.every((g) => g.traceIds.length >= 2)).toBe(true);
    expect(out.communities.map((g) => g.id)).toEqual(out.communities.map((_, i) => i));
  });

  it('keeps only the newest corrections once there are very many', () => {
    let c = NO_CORRECTIONS;
    for (let i = 0; i < CORRECTIONS_MAX + 10; i++) c = takeOut(c, `t${i}`);
    expect(c.apart.length).toBe(CORRECTIONS_MAX);
    expect(c.apart[0]).toBe('t10');
    const many = Array.from({ length: CORRECTIONS_MAX + 5 }, (_, i) => `m${i}`);
    const j = joinGroups(NO_CORRECTIONS, many, ['z'], 'k');
    expect(Object.keys(j.together).length).toBe(CORRECTIONS_MAX);
    expect(j.together.z).toBe('k'); // the newest are kept
  });

  it('does not change what it was given', () => {
    const c = joinGroups(NO_CORRECTIONS, ['b1', 'b2'], ['a1'], 'k1');
    const frozen = JSON.stringify(c);
    takeOut(c, 'b1');
    separate(c, ['a1']);
    putBack(c, 'b1');
    applyCorrections(base, c);
    expect(JSON.stringify(c)).toBe(frozen);
    expect(NO_CORRECTIONS).toEqual({ together: {}, apart: [] });
  });
});
