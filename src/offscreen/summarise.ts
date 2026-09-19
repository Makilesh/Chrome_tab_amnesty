/**
 * Offscreen document: drains the summarisation queue with the on-device Summarizer API.
 *
 * The service worker cannot hold this work (§5.5: 30 s idle kill, 5 min max), so it opens this
 * document and says "run"; the document takes pending jobs a few at a time, writes each summary
 * into its archive card the moment it exists, and reports back when the queue is empty. If the
 * Summarizer is unavailable on this machine every pending job is marked so and nothing is retried
 * until something new is queued. Nothing leaves the machine.
 */
import { pendingJobs, putJob, updateCard } from '../archive/store';
import type { SummariseJob } from '../archive/types';

const BATCH = 4;
const MAX_ATTEMPTS = 2;
const MAX_INPUT_CHARS = 4000;

async function summariserAvailable(): Promise<boolean> {
  try {
    return typeof Summarizer !== 'undefined' && (await Summarizer.availability()) === 'available';
  } catch {
    return false;
  }
}

async function inputFor(job: SummariseJob): Promise<{ text: string; context: string } | null> {
  let found: { text: string; context: string } | null = null;
  await updateCard(job.cardId, (c) => {
    const t = c.tabs.find((x) => x.traceId === job.traceId);
    if (t?.digest) {
      const parts = [t.digest.description, t.digest.headings.join('. '), t.digest.leadText].filter(Boolean);
      found = { text: parts.join('\n').slice(0, MAX_INPUT_CHARS), context: `Page title: ${t.title}. Site: ${t.host}.` };
    }
    return null; // read only
  });
  return found;
}

async function writeSummary(job: SummariseJob, summary: string): Promise<void> {
  await updateCard(job.cardId, (c) => ({
    ...c,
    tabs: c.tabs.map((t) => (t.traceId === job.traceId ? { ...t, summary } : t)),
  }));
}

async function drain(): Promise<'empty' | 'unavailable'> {
  if (!(await summariserAvailable())) {
    for (const j of await pendingJobs(1000)) await putJob({ ...j, state: 'unavailable' });
    return 'unavailable';
  }
  const s = await Summarizer!.create({ type: 'tl;dr', format: 'plain-text', length: 'short' });
  try {
    for (;;) {
      const batch = await pendingJobs(BATCH);
      if (batch.length === 0) return 'empty';
      for (const job of batch) {
        const input = await inputFor(job);
        if (!input || !input.text.trim()) {
          await putJob({ ...job, state: 'done' });
          continue;
        }
        try {
          const summary = (await s.summarize(input.text, { context: input.context })).trim();
          await writeSummary(job, summary);
          await putJob({ ...job, state: 'done' });
        } catch {
          const attempts = job.attempts + 1;
          await putJob({ ...job, attempts, state: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' });
        }
      }
    }
  } finally {
    s.destroy();
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if ((msg as { type?: string })?.type !== 'summarise-run') return false;
  void drain().then((r) => sendResponse({ result: r }), (e: Error) => sendResponse({ result: 'error', message: e.message }));
  return true;
});
