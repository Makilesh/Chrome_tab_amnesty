/**
 * TS cluster CLI — the shipped clusterer, run in Node against a fixture.
 *
 *   npx tsx tools/cluster-cli.ts <name> [--betas file] [--out file] [--edges file] [--ablate dir]
 *
 * Writes fixtures/<name>.partition.json (source: "ts"). --edges dumps every pair's signal
 * vector and weight (for parity and refit). --ablate writes one partition per beta config.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { affinity, eligible } from '../src/cluster/affinity';
import { ablationBetas, cluster, pairSignals } from '../src/cluster/cluster';
import { type Betas, BETAS, SIGNALS } from '../src/cluster/params';
import { SCHEMA_VERSION, type TabTrace, type TraceFixture } from '../src/cluster/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadFixture(path: string): TabTrace[] {
  const data = JSON.parse(readFileSync(path, 'utf8')) as TraceFixture | TabTrace[];
  if (Array.isArray(data)) return data;
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${path}: schemaVersion ${data.schemaVersion} != ${SCHEMA_VERSION}; re-export the fixture`);
  }
  return data.traces;
}

function loadBetas(path?: string): Betas {
  if (!path) return BETAS;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
  const out = {} as Betas;
  for (const s of SIGNALS) {
    if (typeof raw[s] !== 'number') throw new Error(`${path} missing ${s}`);
    out[s] = raw[s]!;
  }
  return out;
}

function partitionJson(name: string, traces: TabTrace[], betas: Betas, vecs: ReturnType<typeof pairSignals>['vecs']) {
  const p = cluster(traces, { betas, vecs });
  return {
    schemaVersion: 1,
    source: 'ts',
    name,
    betas,
    resolution: p.resolution,
    communities: p.communities,
    looseEnds: p.looseEnds,
    excluded: p.excluded,
  };
}

function main(): void {
  const name = process.argv[2];
  if (!name || name.startsWith('--')) throw new Error('usage: cluster-cli <name> [--betas f] [--out f] [--edges f] [--ablate dir]');
  const traces = loadFixture(`fixtures/${name}.json`);
  const betas = loadBetas(arg('--betas'));
  const { kept } = eligible(traces);
  const { vecs } = pairSignals(kept);

  const out = arg('--out') ?? `fixtures/${name}.partition.json`;
  const p = partitionJson(name, traces, betas, vecs);
  writeFileSync(out, JSON.stringify(p, null, 2));
  console.log(`${name}: ${p.communities.length} communities, ${p.looseEnds.length} loose ends, ${p.excluded.length} excluded, resolution ${p.resolution.toFixed(3)} -> ${out}`);

  const edges = arg('--edges');
  if (edges) {
    const rows = [...vecs].map(([key, vec]) => {
      const [a, b] = key.split('|');
      return { a, b, w: affinity(vec, betas), ...vec };
    });
    writeFileSync(edges, JSON.stringify(rows));
  }

  const ablate = arg('--ablate');
  if (ablate) {
    mkdirSync(ablate, { recursive: true });
    for (const [run, b] of Object.entries(ablationBetas(betas))) {
      writeFileSync(join(ablate, `${name}.${run}.partition.json`), JSON.stringify(partitionJson(name, traces, b, vecs)));
    }
    console.log(`ablation partitions -> ${ablate}/`);
  }
}

main();
