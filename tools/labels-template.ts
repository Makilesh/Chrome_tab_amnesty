/**
 * Labels template — writes or refreshes fixtures/<name>.labels.json from fixtures/<name>.json
 * without losing anything the owner has already filled in.
 *
 *   npx tsx tools/labels-template.ts <name>
 *
 * One line per open trace, in tab-strip order (window, then index), so the file can be read
 * next to the browser. Each traceId is followed by a `_<short id>` comment line ("host | title")
 * that the scorer ignores. `""` means "not labelled yet"; `null` means "not part of any project".
 * Non-http tabs (chrome://, extension pages, local files) start as null.
 *
 * Merge rules: a value that is not `""` is the owner's and is kept verbatim; traces no longer in
 * the export are dropped (listed on stderr with whatever label they had); new traces are added
 * unfilled. Ambient hosts (mail, calendar, search results) are excluded from OUR clustering but
 * are still scored against Chrome's, so they are left for the owner to label.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SCHEMA_VERSION, type TabTrace, type TraceFixture } from '../src/cluster/types';

const COMMENT_HEADER: Record<string, string> = {
  _comment:
    'Fill in a project name per tab, in your own words (what were you doing?). null = not part of any project. Non-http tabs (chrome://, extension pages, local files) are already null; leave them.',
  _how: 'Same project across different sites = same name. Different projects on the same site = different names.',
};

type Label = string | null;

function loadFixture(path: string): TabTrace[] {
  const data = JSON.parse(readFileSync(path, 'utf8')) as TraceFixture | TabTrace[];
  if (Array.isArray(data)) return data;
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${path}: schemaVersion ${data.schemaVersion} != ${SCHEMA_VERSION}; re-export the fixture`);
  }
  return data.traces;
}

function isHttp(t: TabTrace): boolean {
  return /^https?:\/\//i.test(t.url);
}

function readExisting(path: string): Record<string, Label> {
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const out: Record<string, Label> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    out[k] = v === null ? null : String(v);
  }
  return out;
}

/** Short id that stays unique within this fixture (8 chars, lengthened on collision). */
function shortIds(traces: TabTrace[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let len = 8; len <= 36; len++) {
    out.clear();
    const seen = new Set<string>();
    let clash = false;
    for (const t of traces) {
      const s = t.traceId.slice(0, len);
      if (seen.has(s)) { clash = true; break; }
      seen.add(s);
      out.set(t.traceId, s);
    }
    if (!clash) return out;
  }
  return out;
}

export function buildTemplate(traces: TabTrace[], existing: Record<string, Label>) {
  const open = traces
    .filter((t) => t.closedAt === null)
    .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  const ids = shortIds(open);

  const out: Record<string, Label> = { ...COMMENT_HEADER };
  let kept = 0;
  let added = 0;
  let toLabel = 0;
  for (const t of open) {
    const prior = existing[t.traceId];
    const http = isHttp(t);
    let value: Label;
    if (prior !== undefined && prior !== '') {
      value = prior;
      kept++;
    } else {
      value = http ? '' : null;
      if (prior === undefined) added++;
    }
    if (http && value === '') toLabel++;
    out[t.traceId] = value;
    const tag = http ? t.host : `(skip) ${t.host}`;
    out[`_${ids.get(t.traceId)}`] = `${tag}  |  ${t.title}`;
  }

  const present = new Set(open.map((t) => t.traceId));
  const dropped = Object.entries(existing).filter(([k]) => !present.has(k));
  return { out, stats: { open: open.length, kept, added, toLabel, dropped } };
}

function main(): void {
  const name = process.argv[2];
  if (!name || name.startsWith('--')) throw new Error('usage: labels-template <name>');
  const fixturePath = `fixtures/${name}.json`;
  const labelsPath = `fixtures/${name}.labels.json`;
  const traces = loadFixture(fixturePath);
  const existing = readExisting(labelsPath);
  const { out, stats } = buildTemplate(traces, existing);
  writeFileSync(labelsPath, JSON.stringify(out, null, 1) + '\n');
  console.log(
    `${labelsPath}: ${stats.open} open traces; ${stats.kept} labels kept, ${stats.added} new, ${stats.toLabel} http tabs still unlabelled`,
  );
  for (const [k, v] of stats.dropped) {
    console.error(`  dropped ${k.slice(0, 8)} (no longer in export) label=${JSON.stringify(v)}`);
  }
}

if (process.argv[1] && /labels-template\.[cm]?[jt]s$/.test(process.argv[1])) main();
