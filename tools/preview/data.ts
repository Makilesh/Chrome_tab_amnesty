/**
 * Made-up tabs for the design preview: four projects open, two pages on their own, and a few
 * projects put away earlier. Every address, title and summary here is invented for the preview.
 */
import type { ArchiveCard, ArchivedTab, GroupColor } from '../../src/archive/types';
import type { RememberedName } from '../../src/archive/naming';
import type { TabTrace } from '../../src/cluster/types';

const MIN = 60_000;
const HOUR = 60 * MIN;

interface Page {
  url: string;
  title: string;
  summary?: string;
}

function host(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function trace(id: string, p: Page, at: number, index: number, opener: string | null, coActive: Record<string, number>): TabTrace {
  const u = new URL(p.url);
  return {
    traceId: id,
    tabId: 1000 + index,
    windowId: 1,
    index,
    openerTraceId: opener,
    openedAt: at,
    transition: opener ? 'link' : 'typed',
    backfilled: false,
    lastActiveAt: at + 4 * MIN,
    activationCount: 3,
    dwellMs: 90_000,
    coActive,
    url: p.url,
    host: host(p.url),
    eTLD1: host(p.url).split('.').slice(-2).join('.'),
    pathTokens: u.pathname.split('/').filter(Boolean),
    queryKeys: {},
    title: p.title,
    digest: { description: p.summary ?? '', headings: [p.title], leadText: '' },
    digestAt: at + MIN,
    pinned: false,
    discarded: false,
    closedAt: null,
  };
}

interface Project {
  name: string;
  hoursAgo: number;
  pages: Page[];
}

const OPEN: Project[] = [
  {
    name: 'asyncio',
    hoursAgo: 2,
    pages: [
      { url: 'https://docs.python.org/3/library/asyncio.html', title: 'asyncio — Asynchronous I/O — Python 3.13 documentation' },
      { url: 'https://docs.python.org/3/library/asyncio-task.html', title: 'Coroutines and Tasks — Python 3.13 documentation' },
      { url: 'https://docs.python.org/3/library/asyncio-queue.html', title: 'Queues — Python 3.13 documentation' },
      { url: 'https://peps.python.org/pep-3156/', title: 'PEP 3156 – Asynchronous IO Support Rebooted: the “asyncio” Module' },
      { url: 'https://stackoverflow.com/questions/56052748/cancel-asyncio-task', title: 'python - How to cancel an asyncio task cleanly? - Stack Overflow' },
    ],
  },
  {
    name: 'kubectl rollout',
    hoursAgo: 5,
    pages: [
      { url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/', title: 'kubectl rollout undo | Kubernetes' },
      { url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/', title: 'kubectl rollout status | Kubernetes' },
      { url: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/', title: 'Deployments | Kubernetes' },
      { url: 'https://github.com/example/deploy-tools/issues/412', title: 'Rollback hangs when the readiness probe never passes · Issue #412' },
    ],
  },
  {
    name: 'Sourdough',
    hoursAgo: 26,
    pages: [
      { url: 'https://www.kingarthurbaking.com/recipes/sourdough-starter-recipe', title: 'Sourdough starter recipe | King Arthur Baking' },
      { url: 'https://www.theperfectloaf.com/beginners-sourdough-bread/', title: 'Beginner’s sourdough bread | The Perfect Loaf' },
      { url: 'https://en.wikipedia.org/wiki/Baker_percentage', title: 'Baker percentage - Wikipedia' },
    ],
  },
  {
    name: 'Flat in Lisbon',
    hoursAgo: 50,
    pages: [
      { url: 'https://www.idealista.pt/en/arrendar-casas/lisboa/alfama/', title: 'Flats to rent in Alfama, Lisbon — idealista' },
      { url: 'https://www.idealista.pt/en/imovel/33219876/', title: 'Two-bedroom flat, Rua dos Remédios — idealista' },
      { url: 'https://www.google.com/maps/place/Alfama', title: 'Alfama · Lisbon — Google Maps' },
    ],
  },
];

const LOOSE: Page[] = [
  { url: 'https://www.theverge.com/2026/11/9/keyboards', title: 'The best mechanical keyboards for programmers' },
  { url: 'https://news.ycombinator.com/item?id=42001234', title: 'Show HN: A tiny SQLite browser in one HTML file' },
];

const PUT_AWAY: (Project & { color: GroupColor; minutesAgo?: number })[] = [
  {
    name: 'Rust lifetimes',
    color: 'red',
    hoursAgo: 1,
    minutesAgo: 20,
    pages: [
      { url: 'https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html', title: 'Validating References with Lifetimes - The Rust Programming Language', summary: 'Lifetime annotations describe how the lifetimes of several references relate, so the borrow checker can tell a returned reference is still valid.' },
      { url: 'https://doc.rust-lang.org/nomicon/lifetimes.html', title: 'Lifetimes - The Rustonomicon' },
      { url: 'https://blog.example.dev/rust-elision', title: 'Lifetime elision, explained with pictures' },
    ],
  },
  {
    name: 'Lisbon',
    color: 'blue',
    hoursAgo: 52,
    pages: [
      { url: 'https://en.wikivoyage.org/wiki/Lisbon', title: 'Lisbon – Travel guide at Wikivoyage', summary: 'Neighbourhoods, getting around by tram and metro, and day trips to Sintra and Cascais.' },
      { url: 'https://en.wikipedia.org/wiki/Alfama', title: 'Alfama - Wikipedia', summary: 'The oldest district of Lisbon, a maze of narrow streets between the castle and the river, known for its fado houses.' },
      { url: 'https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower', title: 'Belém Tower - Wikipedia' },
      { url: 'https://www.timeout.com/lisbon/music/best-fado-houses', title: 'The best fado houses in Lisbon | Time Out' },
    ],
  },
  {
    name: 'Postgres indexes',
    color: 'cyan',
    hoursAgo: 75,
    pages: [
      { url: 'https://www.postgresql.org/docs/current/indexes-multicolumn.html', title: 'PostgreSQL: Documentation: Multicolumn Indexes' },
      { url: 'https://use-the-index-luke.com/sql/where-clause/the-equals-operator/concatenated-keys', title: 'Concatenated (multi-column) indexes — Use The Index, Luke' },
    ],
  },
  {
    name: 'Running shoes',
    color: 'green',
    hoursAgo: 130,
    pages: [
      { url: 'https://www.runnersworld.com/gear/best-daily-trainers', title: 'The best daily trainers, tested' },
      { url: 'https://www.example-shop.com/trail-runner-4', title: 'Trail Runner 4 — Men’s and women’s sizes' },
    ],
  },
];

export interface PreviewData {
  traces: TabTrace[];
  cards: ArchiveCard[];
  names: RememberedName[];
  never: string[];
}

export function previewData(now = Date.now()): PreviewData {
  const traces: TabTrace[] = [];
  const names: RememberedName[] = [];
  let index = 0;
  OPEN.forEach((p, pi) => {
    const start = now - p.hoursAgo * HOUR;
    const ids = p.pages.map((_, i) => `open-${pi}-${i}`);
    p.pages.forEach((page, i) => {
      const co = Object.fromEntries(ids.filter((x) => x !== ids[i]).map((x) => [x, 3]));
      traces.push(trace(ids[i]!, page, start + i * 3 * MIN, index++, i === 0 ? null : ids[0]!, co));
    });
    names.push({ members: ids, name: p.name, at: now });
  });
  LOOSE.forEach((page, i) => traces.push(trace(`loose-${i}`, page, now - (9 + i * 30) * HOUR, index++, null, {})));

  const cards: ArchiveCard[] = PUT_AWAY.map((p, pi) => {
    const archivedAt = now - (p.minutesAgo ?? p.hoursAgo * 60) * MIN;
    const tabs: ArchivedTab[] = p.pages.map((page, i) => ({
      traceId: `card-${pi}-${i}`,
      url: page.url,
      title: page.title,
      host: host(page.url),
      order: i,
      digest: { description: page.summary ?? '', headings: [page.title], leadText: '' },
      summary: page.summary ?? null,
      openedAt: archivedAt - 40 * MIN,
    }));
    return {
      cardId: `00000000-0000-4000-8000-00000000000${pi}`,
      name: p.name,
      color: p.color,
      tier: 'nano',
      when: '',
      whenAt: archivedAt - 30 * MIN,
      hosts: [...new Set(tabs.map((t) => t.host))],
      archivedAt,
      undoUntil: archivedAt + 24 * HOUR,
      tabs,
      restoredAt: null,
      sourceCommunity: pi,
    };
  });
  return { traces, cards, names, never: ['mail.google.com', 'web.whatsapp.com'] };
}
