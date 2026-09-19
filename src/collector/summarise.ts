/**
 * Service-worker side of the summarisation queue: an alarm and a kick message, both of which
 * just open the offscreen document and tell it to drain. The worker holds none of the work
 * itself (§5.5). The alarm is cleared when the queue is empty or the Summarizer is unavailable,
 * and re-armed whenever a sweep enqueues something.
 */
import { pendingJobs } from '../archive/store';

export const SUMMARISE_ALARM = 'summarise';
const OFFSCREEN_URL = 'src/offscreen/index.html';

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Summarise archived pages on-device with the Summarizer API; too long for the service worker.',
  });
}

/** Drain the queue via the offscreen document. Safe to call often; a no-op when nothing is pending. */
export async function runSummariser(): Promise<void> {
  if ((await pendingJobs(1)).length === 0) {
    await chrome.alarms.clear(SUMMARISE_ALARM);
    return;
  }
  await ensureOffscreen();
  const reply = (await chrome.runtime.sendMessage({ type: 'summarise-run' }).catch(() => null)) as { result?: string } | null;
  if (reply?.result === 'empty' || reply?.result === 'unavailable') {
    await chrome.alarms.clear(SUMMARISE_ALARM);
    await chrome.offscreen.closeDocument().catch(() => {});
  } else {
    // failed or interrupted: try again in a minute
    await chrome.alarms.create(SUMMARISE_ALARM, { delayInMinutes: 1 });
  }
}

/** Called when a sweep has queued work. */
export async function kickSummariser(): Promise<void> {
  await chrome.alarms.create(SUMMARISE_ALARM, { delayInMinutes: 0.1 });
}
