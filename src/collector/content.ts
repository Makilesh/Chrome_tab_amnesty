/**
 * Content script: builds a compact digest of the page and sends it to the service worker.
 * Captures on readyState === 'complete' and on the first visibilitychange to visible; debounced;
 * the service worker enforces the never-re-capture-same-URL-within-10-minutes rule.
 *
 * Nothing here reads anything but the DOM, and nothing leaves the machine.
 */
import type { Digest } from '../cluster/types';

const MAX_LEAD_CHARS = 1000;
const MAX_HEADINGS = 20;
const MAX_HEADING_CHARS = 120;
const MIN_PARAGRAPH_CHARS = 40;
const DEBOUNCE_MS = 500;
const LOCAL_MIN_INTERVAL_MS = 10 * 60_000;

const SKIP_ANCESTORS = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function metaContent(selector: string): string {
  return document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? '';
}

function buildDigest(): Digest {
  const description =
    metaContent('meta[name="description"]') ||
    metaContent('meta[property="og:description"]') ||
    metaContent('meta[name="twitter:description"]');

  const headings: string[] = [];
  const seen = new Set<string>();
  for (const h of document.querySelectorAll('h1, h2, h3')) {
    if (h.closest(SKIP_ANCESTORS)) continue;
    const t = text(h).slice(0, MAX_HEADING_CHARS);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    headings.push(t);
    if (headings.length >= MAX_HEADINGS) break;
  }

  const root = document.querySelector('main, article, [role="main"]') ?? document.body;
  let leadText = '';
  for (const p of root.querySelectorAll('p, li, blockquote, pre')) {
    if (p.closest(SKIP_ANCESTORS)) continue;
    const t = text(p);
    if (t.length < MIN_PARAGRAPH_CHARS) continue;
    leadText += (leadText ? ' ' : '') + t;
    if (leadText.length >= MAX_LEAD_CHARS) break;
  }
  leadText = leadText.slice(0, MAX_LEAD_CHARS);

  return { description: description.slice(0, 500), headings, leadText };
}

type Reason = 'complete' | 'visible' | 'requested';

let timer: number | undefined;
let lastSent: { url: string; at: number } | null = null;
let firstVisibleSent = false;

function send(reason: Reason): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const url = location.href;
    const now = Date.now();
    const recent = lastSent && lastSent.url === url && now - lastSent.at < LOCAL_MIN_INTERVAL_MS;
    // 'visible' is allowed through once so the worker can replace a thin hidden-render digest.
    if (recent && reason !== 'visible') return;
    lastSent = { url, at: now };
    chrome.runtime
      .sendMessage({ type: 'digest', url, title: document.title, digest: buildDigest(), reason })
      .catch(() => {
        /* worker unreachable (e.g. extension reloaded); the next event will retry */
      });
  }, DEBOUNCE_MS);
}

if (document.readyState === 'complete') {
  send('complete');
} else {
  window.addEventListener('load', () => send('complete'), { once: true });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !firstVisibleSent) {
    firstVisibleSent = true;
    send('visible');
  }
});
if (document.visibilityState === 'visible') firstVisibleSent = true;

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if ((msg as { type?: string } | undefined)?.type === 'capture') send('requested');
});
