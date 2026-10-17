/**
 * Content script: builds a compact digest of the page and sends it to the service worker, and
 * keeps track of unsent typing (a yes/no only, never the text).
 *
 * It runs in every frame, because editors live in iframes and shadow roots; the digest comes
 * from the top frame only. The manifest injects it as pages load, and the worker also injects it
 * into tabs that were already open when this version started (background.ts), so a tab open
 * across an install, a Reload or "switch off and on" is covered too.
 *
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
/** The top frame waits this long before saying "nothing unsent", so a frame with a draft answers first. */
const TOP_FRAME_GRACE_MS = 300;

const SKIP_ANCESTORS = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

const TOP = window === window.top;

// The newest copy in this frame wins. A copy injected by an older extension instance has dead
// APIs; one injected twice by this instance (manifest and worker racing) would double-report.
const SLOT = '__tabAmnestyContent';
const me = Symbol('tab-amnesty');
(globalThis as unknown as Record<string, symbol>)[SLOT] = me;
const current = () => (globalThis as unknown as Record<string, symbol>)[SLOT] === me;

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
    if (!current()) return;
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

if (TOP) {
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
}

// ---------------------------------------------------------------------------------------------
// Unsent typing — a yes/no only, never the text. See TabTrace.typing.
//
// Archive & close asks every frame at the moment of the click whether a field the person typed
// into still holds text ('unsent?'); the flag kept in the trace is only the fallback for a tab
// that cannot answer (discarded, or no live script). So nothing here has to guess when a draft
// was sent: a chat box the page emptied after sending reads as empty, a form whose submit the
// page cancelled still has its text.
// ---------------------------------------------------------------------------------------------

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
/** Fields the person typed into, inside shadow roots too. */
const touched = new Set<HTMLElement>();

function isTextField(target: EventTarget | null | undefined): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NOT_TEXT.has(target.type);
}

function hasText(el: HTMLElement): boolean {
  const v = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent ?? '';
  return v.trim().length > 0;
}

/**
 * A copy injected into a page that has been open a while (the worker injects into open tabs after
 * an install, Reload or off-and-on) never saw the typing done before it arrived. Text fields whose
 * value already differs from what the page loaded with count as typed. Not contenteditable: an
 * editor showing saved content looks the same as one holding a draft.
 */
function seedFromPage(root: Document | ShadowRoot = document): void {
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) seedFromPage(el.shadowRoot);
    const field = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NOT_TEXT.has(el.type)) ? el : null;
    if (field && field.value.trim() && field.value !== field.defaultValue) touched.add(field);
  }
}
if (performance.now() > 10_000) seedFromPage();

function unsent(): boolean {
  for (const f of touched) {
    if (!f.isConnected) {
      touched.delete(f);
      continue;
    }
    if (hasText(f)) return true;
  }
  return false;
}

/** What the worker was last told; null forces the next report through. */
let reported: boolean | null = null;

function report(): void {
  if (!current()) return;
  const value = unsent();
  if (value === reported) return;
  reported = value;
  chrome.runtime.sendMessage({ type: 'typing', typing: value }).catch(() => {});
}

/** Report again a moment after the URL changed under this document: the worker clears the flag on every URL change. */
function reportAfterUrlChange(): void {
  reported = null;
  window.setTimeout(report, 1000);
}

document.addEventListener(
  'input',
  (e) => {
    // composedPath()[0] is the field itself even inside a shadow root (e.target is its host).
    const field = e.composedPath()[0];
    if (!isTextField(field)) return;
    touched.add(field);
    report();
  },
  true,
);
// A page may empty a field after sending without an input event; look again shortly after.
for (const type of ['submit', 'focusout'] as const) document.addEventListener(type, () => window.setTimeout(report, 400), true);
document.addEventListener('keydown', (e) => e.key === 'Enter' && window.setTimeout(report, 400), true);
window.addEventListener('pageshow', (e) => e.persisted && reportAfterUrlChange());
window.addEventListener('hashchange', reportAfterUrlChange);
window.addEventListener('popstate', reportAfterUrlChange);
// pushState / replaceState fire no event of their own; the Navigation API reports them.
(window as unknown as { navigation?: EventTarget }).navigation?.addEventListener('currententrychange', reportAfterUrlChange);

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!current()) return false;
  const type = (msg as { type?: string } | undefined)?.type;
  if (type === 'capture' && TOP) {
    send('requested');
    return false;
  }
  if (type === 'unsent?') {
    // The first answer from any frame wins: a frame with a draft answers at once, the top frame
    // says "nothing" only after a grace period, and other frames stay silent.
    if (unsent()) {
      sendResponse({ unsent: true });
      return false;
    }
    if (!TOP) return false;
    window.setTimeout(() => sendResponse({ unsent: unsent() }), TOP_FRAME_GRACE_MS);
    return true;
  }
  return false;
});
