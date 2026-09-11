/**
 * Deterministic Louvain, identical to analysis/tabamnesty/louvain.py — same node order, same
 * tie-break rule, same summation order, so both sides produce the same partition bit for bit.
 * Library Louvains (graphology, networkx) shuffle node order and diverge on dense near-uniform
 * graphs; the parity contract needs one algorithm. See the Python file for the full rationale.
 */

const EPS = 1e-12;

export type Edge = [a: string, b: string, w: number];

export function louvain(nodes: string[], edges: Edge[], resolution = 1): string[][] {
  const n = nodes.length;
  const index = new Map(nodes.map((v, i) => [v, i]));
  // canonical edge order: by (min index, max index), so the graph library's order is irrelevant
  const canon = edges
    .map(([a, b, w]) => {
      const i = index.get(a)!;
      const j = index.get(b)!;
      return [Math.min(i, j), Math.max(i, j), w] as [number, number, number];
    })
    .sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  let adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const [i, j, w] of canon) {
    adj[i]!.set(j, (adj[i]!.get(j) ?? 0) + w);
    adj[j]!.set(i, (adj[j]!.get(i) ?? 0) + w);
  }

  let membership = Array.from({ length: n }, (_, i) => i);
  let curNodes = n;
  for (;;) {
    const { moved, com } = oneLevel(adj, resolution);
    const renum = new Map<number, number>();
    for (const c of com) if (!renum.has(c)) renum.set(c, renum.size);
    const comOf = com.map((c) => renum.get(c)!);
    membership = membership.map((m) => comOf[m]!);
    if (!moved || renum.size === curNodes) break;
    curNodes = renum.size;
    const next: Map<number, number>[] = Array.from({ length: curNodes }, () => new Map());
    for (let i = 0; i < adj.length; i++) {
      const ci = comOf[i]!;
      for (const [j, w] of adj[i]!) {
        const cj = comOf[j]!;
        next[ci]!.set(cj, (next[ci]!.get(cj) ?? 0) + w);
      }
    }
    adj = next;
  }

  const groups = new Map<number, string[]>();
  membership.forEach((c, i) => {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(nodes[i]!);
  });
  return [...groups.values()];
}

function oneLevel(adj: Map<number, number>[], resolution: number): { moved: boolean; com: number[] } {
  const n = adj.length;
  const k = adj.map((nbrs) => {
    let s = 0;
    for (const w of nbrs.values()) s += w;
    return s;
  });
  let m2 = 0;
  for (const x of k) m2 += x;
  const com = Array.from({ length: n }, (_, i) => i);
  if (m2 === 0) return { moved: false, com };
  const tot = [...k];
  let movedAny = false;
  for (;;) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const ci = com[i]!;
      const ki = k[i]!;
      const wTo = new Map<number, number>();
      for (const [j, w] of adj[i]!) {
        if (j === i) continue;
        const cj = com[j]!;
        wTo.set(cj, (wTo.get(cj) ?? 0) + w);
      }
      tot[ci]! -= ki;
      let bestC = ci;
      let bestGain = (wTo.get(ci) ?? 0) - (resolution * ki * tot[ci]!) / m2;
      for (const [c, w] of wTo) {
        if (c === ci) continue;
        const gain = w - (resolution * ki * tot[c]!) / m2;
        if (gain > bestGain + EPS) {
          bestGain = gain;
          bestC = c;
        }
      }
      tot[bestC]! += ki;
      if (bestC !== ci) {
        com[i] = bestC;
        moved = movedAny = true;
      }
    }
    if (!moved) break;
  }
  return { moved: movedAny, com };
}
