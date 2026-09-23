/**
 * Phase 1 study: every few hours, note how many http(s) tabs are open. That is all — no URLs, no
 * titles. It exists so the Phase 1 gate ("open-tab count still lower seven days later") can be
 * read from the study export; nothing in the product ever shows it (§6.1).
 */
import { appendSnapshot, SNAPSHOT_EVERY_MIN } from '../archive/study';
import { getMeta, setMeta } from './db';

export const STUDY_ALARM = 'study-snapshot';

export async function takeSnapshot(): Promise<void> {
  const open = (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url || t.pendingUrl || '')).length;
  await setMeta('openSnapshots', appendSnapshot((await getMeta('openSnapshots')) ?? [], { at: Date.now(), open }));
}

/** Idempotent: keeps an existing schedule, creates one if missing. */
export async function ensureStudyAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(STUDY_ALARM))) {
    await chrome.alarms.create(STUDY_ALARM, { delayInMinutes: 1, periodInMinutes: SNAPSHOT_EVERY_MIN });
  }
}
