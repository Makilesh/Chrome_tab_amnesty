/**
 * Tunables shared with the Python bench (analysis/tabamnesty/config.py). Same values, same
 * names. betas.json and ambient.json are the literal same files on both sides.
 */
import betasJson from './betas.json';
import ambientJson from './ambient.json';

export const SIGNALS = [
  'S1_lineage',
  'S2_temporal',
  'S8_coactive',
  'S3_session',
  'S6_path_query',
  'S4_strip',
  'S7_lexical',
  'S5_domain',
  'N1_cross_window',
] as const;
export type Signal = (typeof SIGNALS)[number];
export type Betas = Record<Signal, number>;
export type SignalVector = Record<Signal, number>;

function pickBetas(raw: Record<string, unknown>): Betas {
  const out = {} as Betas;
  for (const s of SIGNALS) {
    const v = raw[s];
    if (typeof v !== 'number') throw new Error(`betas.json missing ${s}`);
    out[s] = v;
  }
  return out;
}

/** The weights as shipped. Refit writes betas.json; nothing else should mutate this. */
export const BETAS: Betas = pickBetas(betasJson as Record<string, unknown>);

export const AMBIENT = {
  etld1: new Set<string>(ambientJson.etld1),
  hosts: new Set<string>(ambientJson.hosts),
  searchPaths: ambientJson.search_paths as string[],
};

export const GAP_MS = 25 * 60_000; // segment(): cut on a gap longer than this
export const TEMPORAL_TAU_MS = 8 * 60_000; // S2: exp(-dt / 8 min)
export const STRIP_TAU = 4; // S4: exp(-|dIndex| / 4)
export const W_MIN = 1.0; // prune edges below this affinity
export const TARGET_LO = 3;
export const TARGET_HI = 9;
export const MAX_COMMUNITY = 15; // split communities larger than this
export const RESOLUTION_ITERS = 8;
