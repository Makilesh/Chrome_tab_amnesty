/**
 * Gemini Nano side of the Laya-vs-Nano comparison. Research only; nothing here ships.
 *
 *   npx tsx tools/judge-nano.ts status     what Chrome says about the on-device model in that profile
 *   npx tsx tools/judge-nano.ts download   start (or finish) the model download, with progress
 *   npx tsx tools/judge-nano.ts answer     answer .real/compare/items.json -> .real/compare/nano.json
 *   npx tsx tools/judge-nano.ts names      re-ask only the group names (keeps the pair answers; the
 *                                          previous names are kept as groups_before for a before/after)
 *
 * Runs the installed Chrome (CHROME_PATH overrides) on its own profile in
 * D:\Installations\tab-amnesty-models\chrome-nano-profile (NANO_PROFILE overrides), so the
 * multi-GB model lands on D: and the owner's everyday profile is never touched. Puppeteer's
 * default flags switch off component updates — the very channel Chrome downloads Gemini Nano
 * through — so this launches with a minimal, explicit flag set instead.
 *
 * Same items as Laya (tabamnesty.judge_compare): "same project?" per pair as {answer, confidence}
 * mapped to a score in [0, 1]; per group the same activity list, plus the name the extension would
 * show (its own system prompt, fed naming.evidence()), and the heuristic name for reference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { languagesToTry } from '../src/archive/language';
import { languageHints, NAME_SAMPLING, namePrompt, quickName } from '../src/archive/naming';
import type { Community, TabTrace } from '../src/cluster/types';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = process.env.NANO_PROFILE ?? 'D:/Installations/tab-amnesty-models/chrome-nano-profile';
const OUT = resolve('.real/compare');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><title>Nano judge</title>
<button id="go" style="font-size:24px;padding:12px">Download Gemini Nano</button><pre id="log"></pre>
<script>
window.__progress = null; window.__ready = false; window.__err = null;
document.getElementById('go').addEventListener('click', () => {
  LanguageModel.create({ monitor(m) { m.addEventListener('downloadprogress', (e) => { window.__progress = e.loaded; }); } })
    .then((s) => { window.__ready = true; s.destroy(); })
    .catch((e) => { window.__err = String(e && e.message || e); });
});
</script>`;

async function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer((_q, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`, close: () => server.close() };
}

async function launch(): Promise<Browser> {
  mkdirSync(PROFILE, { recursive: true });
  return puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    ignoreDefaultArgs: true, // keep component updates on: that is how the model arrives
    args: [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=900,700'],
    defaultViewport: null,
  });
}

/** Availability for what the extension asks: English text in and out (Chrome warns without it). */
async function availability(page: Page) {
  return page.evaluate(
    async (hints) => ({
      languageModel: typeof LanguageModel === 'undefined' ? 'API not exposed' : await LanguageModel.availability(hints),
      summarizer:
        typeof Summarizer === 'undefined' ? 'API not exposed' : await Summarizer.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' }),
      chrome: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? '?',
    }),
    languageHints('en'),
  );
}

interface Items {
  activities: string[];
  browsers: {
    name: string;
    labels: string;
    traces: TabTrace[];
    groups: { id: number; traceIds: string[] }[];
    pairs: { a: string; b: string; stratum: string; y: number; free: number; textA: string; textB: string }[];
  }[];
}

const PAIR_SYSTEM =
  'You judge whether two browser tabs belong to the same task or project for the person who opened them. ' +
  'Use only the titles and addresses given. A project is one thing the person was doing, not a topic.';
const PAIR_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string', enum: ['yes', 'no'] }, confidence: { type: 'integer', minimum: 0, maximum: 100 } },
  required: ['answer', 'confidence'],
  additionalProperties: false,
};
/**
 * One prompt in a fresh session (system prompt only), returning parsed JSON and milliseconds.
 * `sampling` is tried first and dropped if this Chrome refuses it, exactly as the extension does;
 * `hints` are the language hints (English unless given, as the extension asks on an English browser).
 */
async function ask(page: Page, system: string, text: string, schema: object, sampling?: object, hints: object = languageHints('en')): Promise<{ json: any; ms: number }> {
  return page.evaluate(
    async (system, text, schema, sampling, hints) => {
      const t0 = performance.now();
      const base = { initialPrompts: [{ role: 'system' as const, content: system }], ...hints };
      const s = await (sampling
        ? LanguageModel!.create({ ...base, ...sampling }).catch(() => LanguageModel!.create(base))
        : LanguageModel!.create(base));
      try {
        const raw = await s.prompt(text, { responseConstraint: schema });
        return { json: JSON.parse(raw), ms: performance.now() - t0 };
      } finally {
        s.destroy();
      }
    },
    system,
    text,
    schema,
    sampling ?? null,
    hints,
  );
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Names for one browser's groups, in order, the way the sweep page asks: each group is told the
 * names the model already gave the others, and a repeat falls back to the heuristic name.
 */
async function nameGroups(page: Page, b: Items['browsers'][number], byId: Map<string, TabTrace>, corpus: TabTrace[]) {
  const taken: string[] = [];
  const out: { name: string; shown: string; repeat: boolean; ms: number }[] = [];
  const hints = languageHints(languagesToTry(await page.evaluate(() => navigator.language))[0]!);
  for (const g of b.groups) {
    const members = g.traceIds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
    const heuristic = quickName({ id: g.id, traceIds: g.traceIds }, byId, corpus).name;
    const { system, text, schema } = namePrompt(members, byId, taken);
    const r = await ask(page, system, text, schema, NAME_SAMPLING, hints);
    const name = String(r.json.name ?? '').trim();
    const repeat = !name || taken.some((t) => same(t, name));
    if (!repeat) taken.push(name);
    out.push({ name, shown: repeat ? heuristic : name, repeat, ms: r.ms });
  }
  return out;
}

async function answer(page: Page): Promise<void> {
  const items = JSON.parse(readFileSync(join(OUT, 'items.json'), 'utf8')) as Items;
  const doingSchema = {
    type: 'object',
    properties: { activity: { type: 'string', enum: items.activities } },
    required: ['activity'],
    additionalProperties: false,
  };
  const out: { model: unknown; browsers: Record<string, unknown> } = { model: await availability(page), browsers: {} };
  for (const b of items.browsers) {
    // Heuristic names over the same corpus the sweep page uses, when the full fixture exists.
    const fixture = join('fixtures', `${b.name}.json`);
    const corpus: TabTrace[] = existsSync(fixture) ? JSON.parse(readFileSync(fixture, 'utf8')).traces : b.traces;
    const byId = new Map<string, TabTrace>(corpus.map((t) => [t.traceId, t]));
    for (const t of b.traces) if (!byId.has(t.traceId)) byId.set(t.traceId, t);
    const res: Record<string, unknown> = {};
    if (b.pairs.length) {
      const scores: number[] = [];
      let ms = 0;
      for (const [i, p] of b.pairs.entries()) {
        const text = `Are these two browser tabs part of the same task or project the person was working on?\nTab A: ${p.textA}\nTab B: ${p.textB}`;
        const r = await ask(page, PAIR_SYSTEM, text, PAIR_SCHEMA);
        const c = Math.max(0, Math.min(100, Number(r.json.confidence) || 0)) / 200;
        scores.push(r.json.answer === 'yes' ? 0.5 + c : 0.5 - c);
        ms += r.ms;
        if ((i + 1) % 25 === 0) console.log(`  ${b.name}: ${i + 1}/${b.pairs.length} pairs`);
      }
      res.pairs = scores;
      res.ms_per_pair = ms / b.pairs.length;
    }
    if (b.groups.length) {
      const groups: { activity: string; name: string }[] = [];
      const heuristic: string[] = [];
      let ms = 0;
      for (const g of b.groups) {
        const members = g.traceIds.map((id) => byId.get(id)).filter((t): t is TabTrace => !!t);
        const community: Community = { id: g.id, traceIds: g.traceIds };
        heuristic.push(quickName(community, byId, corpus).name);
        const titles = members.slice(0, 15).map((t) => `- ${t.title}`).join('\n');
        const act = await ask(page, 'You say what a person was doing with a set of browser tabs.', `What was the person doing with these tabs?\n${titles}`, doingSchema);
        groups.push({ activity: act.json.activity, name: '' });
        ms += act.ms;
      }
      for (const [i, n] of (await nameGroups(page, b, byId, corpus)).entries()) {
        groups[i]!.name = n.shown;
        ms += n.ms;
      }
      res.groups = groups;
      res.heuristic = heuristic;
      res.ms_per_group = ms / b.groups.length;
    }
    out.browsers[b.name] = res;
    console.log(`nano: ${b.name} done (${b.pairs.length} pairs, ${b.groups.length} groups)`);
  }
  writeFileSync(join(OUT, 'nano.json'), JSON.stringify(out, null, 1));
  console.log(`-> ${join(OUT, 'nano.json')}`);
}

/** Re-ask only the names; keep everything else in nano.json and remember the previous names. */
async function names(page: Page): Promise<void> {
  const items = JSON.parse(readFileSync(join(OUT, 'items.json'), 'utf8')) as Items;
  const prev = JSON.parse(readFileSync(join(OUT, 'nano.json'), 'utf8'));
  for (const b of items.browsers) {
    const res = prev.browsers[b.name];
    if (!res?.groups?.length) continue;
    const fixture = join('fixtures', `${b.name}.json`);
    const corpus: TabTrace[] = existsSync(fixture) ? JSON.parse(readFileSync(fixture, 'utf8')).traces : b.traces;
    const byId = new Map<string, TabTrace>(corpus.map((t) => [t.traceId, t]));
    for (const t of b.traces) if (!byId.has(t.traceId)) byId.set(t.traceId, t);
    res.groups_before = res.groups_before ?? res.groups.map((g: { name: string }) => g.name);
    const fresh = await nameGroups(page, b, byId, corpus);
    res.groups = res.groups.map((g: object, i: number) => ({ ...g, name: fresh[i]!.shown, repeat: fresh[i]!.repeat }));
    console.log(`nano names: ${b.name} — ${fresh.filter((f) => f.repeat).length} repeat(s) caught`);
  }
  writeFileSync(join(OUT, 'nano.json'), JSON.stringify(prev, null, 1));
  console.log(`-> ${join(OUT, 'nano.json')}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'status';
  const site = await serve();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(site.url);
    console.log(`chrome ${CHROME}\nprofile ${PROFILE}`);
    console.log('availability:', JSON.stringify(await availability(page)));
    if (mode === 'download') {
      await page.click('#go'); // the API needs a user gesture to start a download
      for (let i = 0; ; i++) {
        await sleep(10_000);
        const s = await page.evaluate(() => ({ p: (window as any).__progress, ready: (window as any).__ready, err: (window as any).__err }));
        const a = await availability(page);
        console.log(`  ${new Date().toLocaleTimeString()}  progress ${s.p == null ? '-' : `${Math.round(s.p * 100)}%`}  model ${a.languageModel}${s.err ? `  error: ${s.err}` : ''}`);
        if (s.ready || a.languageModel === 'available' || s.err || a.languageModel === 'unavailable') break;
        if (i > 360) throw new Error('no model after an hour');
      }
    } else if (mode === 'answer') {
      await answer(page);
    } else if (mode === 'names') {
      await names(page);
    }
  } finally {
    await browser.close();
    site.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
