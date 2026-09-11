# Tab Amnesty — project brief and build plan

You are the engineer on a new Chrome extension. This message is the whole project: what it is, why
it exists, the four phases, and the rules that do not bend. Read all of it before doing anything.

---

## 0. First thing you do — before any code

This brief is longer than a context window will politely hold across a multi-day build, so
**persist it into the repo first.** On your very first turn:

1. `git init` a new repo called `tab-amnesty`.
2. Write these files, drawn from this brief:
   - `CLAUDE.md` — the compressed always-loaded context: the thesis in a paragraph, the six
     platform non-negotiables in §5, the eleven human rules in §6, and the current phase. Keep it
     under 200 lines; it gets read on every session.
   - `docs/PROJECT.md` — this brief in full.
   - `docs/PHASES.md` — §7, with a checkbox per deliverable and the gate for each phase.
   - `docs/DECISIONS.md` — empty except a header. Every time you make a judgement call I did not
     specify, append a dated three-line entry: decision, alternative rejected, why.
3. Commit. Then **stop and show me the file tree and `CLAUDE.md`.** Do not start Phase 0 until I
   say go.

From then on: re-read `CLAUDE.md` at the start of each session, and update `docs/PHASES.md` as you
complete things. If we ever disagree with this brief, the repo docs win and you update them.

---

## 1. The product, in one paragraph

**Tab Amnesty is a browser memory, not a tab manager.** It quietly records what each open tab was
about, groups the open tabs by the *project* they belong to, and lets someone archive-and-close an
entire project in one action — with the content kept, searchable, and restorable. It never deletes
anything. The pitch is: **close it, you'll still have it.**

---

## 2. Why it exists — and why the obvious version of it would fail

Do not build the obvious version. Chrome has shipped an AI "Organize tabs" feature since M121 that
clusters open tabs by topic, and at least six extensions do the same. A 2026 round-up of AI tab
managers found **none of them summarise page content and none recommend what to close.** So topic
clustering is the floor, not the product.

The real finding is about behaviour. The CMU tab-overload study (Chang et al., CHI 2021) found that
people do not keep 137 tabs because they are disorganised. They keep them because closing one feels
like deleting information — Aniket Kittur called it the **"blackhole effect"**: the belief that the
moment something leaves the tab strip it is gone. Participants described tabs as external memory,
as nagging reminders, and as sunk effort they refused to write off.

Two consequences shape everything below:

- **"Recommend what to delete" is the wrong verb.** A list of deletion recommendations is a list of
  loss events, and it triggers exactly the anxiety that produced the 137 tabs. The word *delete*
  does not appear in this product.
- **The summary is not a feature, it is the mechanism.** It is what makes closing survivable. If a
  tab's substance is captured and findable, closing stops being loss and becomes filing.

And one more, which is the hardest-won: **an archive that never gives anything back is a DOOM box** —
*Didn't Organize, Only Moved*, the box or drawer that ADHD folks already invent by hand. It works
for a week, then becomes its own source of dread, because it accumulates and never returns anything.
Storage alone makes the problem worse. The return path is the product.

---

## 3. The thesis the build has to prove

> **A project is not a topic.** It is a burst of tabs opened from one another, in one sitting, that
> the person then switches between.

Every part of that is observable from Chrome's APIs without reading a word of page text. This is
why Chrome's organiser splits one piece of work across Figma, GitHub, Notion and Jira into four
groups — it sees four subjects. We see one burst of linked, co-activated tabs.

Phase 0 exists solely to test whether that thesis is true. If it is false, we stop.

---

## 4. Architecture

```
ALWAYS ON, PASSIVE, LOCAL                         ONE CLICK
open tabs -> digest capture -> page memory  ->  cluster engine -> tab groups
            (on load/visible)   (IndexedDB)                     -> archive cards
                                                                       |
                                                          (phase 3)    v
                                                    local MCP server -> Claude
```

The load-bearing decision: **collect passively, act instantly.** A content script writes a compact
digest as each page loads; the one-click sweep then reads local records, never live tabs. That makes
it work on discarded tabs, work offline, and return in under a second. Everything else follows from
this.

---

## 5. Platform non-negotiables

Verified against Chrome's docs and the chromium-extensions list. Get these wrong and you silently
destroy the data the whole project depends on, and nobody notices for weeks. **Ask me before
deviating from any of them.**

1. **`tab.openerTabId` evaporates.** It exists only while the opener tab is alive in the same
   window, and is not persisted across restart. Capture it in `chrome.tabs.onCreated` and store your
   own `openerTraceId`. Reading it at sweep time yields nothing.
2. **`tab.lastAccessed` goes undefined on discarded tabs** — precisely the stale tabs that matter
   most for ranking. Maintain your own `lastActiveAt` from `chrome.tabs.onActivated`.
3. **`tab.id` is not an identity.** Ids are reassigned across restarts. Mint a UUID `traceId` on
   creation; key every record on traceId, never tabId. Re-bind on startup by (url, windowId).
4. **Memory Saver discards background tabs.** No event fires; there is no DOM to inject into.
   **Never reload a tab in order to read it.** Work from stored records only.
5. **MV3 service workers die at 30 s idle, 5 min max per request.** Never assume the worker
   survives. State goes to IndexedDB immediately; nothing of consequence lives in a global. Long
   work is a persisted queue driven by `chrome.alarms` plus an offscreen document.
6. **`chrome.tabGroups.update()` throws "Saved groups are not editable"** on synced groups, and
   extensions still cannot move tabs out of them. Catch it, keep the clustering, tell the user that
   group is locked. The colour enum is fixed: `grey, blue, red, yellow, green, pink, purple, cyan,
   orange`.

One more that is policy, not API: the Chrome Web Store's updated privacy rules took effect
**1 August 2026** — collected data must be strictly necessary to a single disclosed purpose, with
prominent disclosure. An extension reading every page you visit is the highest-scrutiny profile
there is. **On-device processing, nothing leaving the machine, is both the design and the
store-approval strategy.** Do not add a network call without asking me.

---

## 6. Human design rules — hard requirements, all phases

Most target users have ADHD, and the barrier to opening a tab-cleanup tool is built from every
previous cleanup that failed — what ADHD coach Brendan Mahan calls the "wall of awful," where shame
is the mortar. These are spec. Each one has a visible failure you can check for.

1. **Never show the tab count as a problem.** No "137 tabs", no GB figure, no red badge, no streak,
   no "you haven't tidied in 12 days." Every diagnostic number is a brick in that wall.
   *Broken if:* any such number appears anywhere.
2. **Never use the words** delete, clean up, declutter, tidy, or messy in the UI.
3. **Show value before asking for a decision.** The first thing on screen is something the person
   recognises and made — *the Tuesday morning you spent on the pricing page* — not a diagnosis of
   their mess. Recognition first, action second, always.
   *Broken if:* the first screen asks the user to choose something.
4. **At most five decisions visible at once.** One button per group, never per tab.
   *Broken if:* any per-tab checklist exists.
5. **Label by event, not date.** "The afternoon you were fixing the deploy" beats "23 August."
   Grounded: memory retrieval uses event boundaries as access points, and higher ADHD traits
   correlate with encoding *fewer* boundaries (r = −0.26) and worse temporal-order memory *across*
   them (r = −0.36), while within-event memory is intact. The session segmentation in §7 Phase 0 is
   what supplies these boundaries — the same computation serves clustering and recall. Date is
   secondary metadata, never the primary label.
6. **Never characterise the user's browsing.** No "you spent 3 hours on Reddit." Report neutrally or
   not at all. A lot of what is open came from a 2am hyperfocus session; handle it without comment.
7. **The user never names anything.** Naming is an executive-function task. The model proposes;
   the user only corrects, which is far cheaper.
   *Broken if:* an empty "name this group" field exists.
8. **Undo survives a restart** and stays reachable 24 hours. Regret arrives later than the toast.
9. **Nothing closes without an explicit per-group action.** No auto-close, no scheduled cleanup, no
   "smart" anything, ever. The first time this closes something someone needed, it is uninstalled.
10. **Forgetting is first-class.** A visible *forget this* on every record, a per-domain
    never-remember list, incognito never touched. People's browsing includes medical, legal and
    job-hunting tabs, on shared machines.
11. **The archive volunteers.** It hands things back unprompted or it is a doom box with better
    indexing.

Follow the W3C COGA design guide where it applies: reversible actions and easy undo, short critical
paths, no reliance on memory, clear literal language.

---

## 7. The phases

Each phase answers one question and ends at a gate. **Do not start a phase before I confirm the
previous gate passed.** A failed gate is a real outcome — build the measurement honestly enough that
it can tell me the idea is wrong.

---

### Phase 0 — The X-ray · ~1 weekend

**Question:** Does clustering by behavioural signals beat Chrome's built-in "Organize tabs" at
recovering someone's real projects?

**Build:**

**a. Collector** (service worker + content script). Records, never touches UI. `TabTrace` in
IndexedDB via `idb`:

```
traceId, tabId, windowId, index
openerTraceId     <- from onCreated. EVENT-TIME ONLY.
openedAt          <- onCreated timestamp
transition        <- chrome.history.getVisits(), visit nearest openedAt
lastActiveAt, activationCount, dwellMs
coActive: Record<traceId, number>   <- pairs foregrounded within 60s
host, eTLD1, pathTokens[], queryKeys{}
title, digest { description, headings[], leadText (max 1000 chars) }
pinned, discarded, digestAt
```

`transition` needs the `"history"` permission. `typed` / `generated` / `auto_bookmark` mean a
deliberate new start; `link` / `form_submit` mean continuation. This is the best task-boundary
signal available and no competitor uses it. Digest captures on `readyState === 'complete'` and on
first `visibilitychange` to visible; debounced; never re-capture the same URL within 10 minutes.

**b. Clusterer** — `src/cluster/`, **zero `chrome.*` imports**, runs in plain Node against fixtures.

- `segment(traces, gapMs = 25*60_000)` — sort by `openedAt`, cut on a gap > gapMs OR on
  `NEW_INTENT.has(transition) && !openerTraceId` where `NEW_INTENT = {typed, generated, auto_bookmark}`.
- `affinity(a, b)` — weighted sum; weights in one exported const so they can be refit later by
  logistic regression on labelled pairs:

  ```
  S1 opener lineage     1/(1+treeDistance)                 beta  3.0
  S2 temporal proximity exp(-dt / 8min)                    beta  2.0
  S8 co-activation      normalised pair count              beta  1.5
  S3 same session       1 or 0                             beta  1.5
  S6 path/query overlap Jaccard, segments + key values     beta  1.2
  S4 strip adjacency    exp(-|dIndex|/4), same window      beta  1.0
  S7 lexical similarity TF-IDF cosine, IDF on own corpus   beta  1.0
  S5 same eTLD+1        1, or 0.5 sibling domain           beta  0.8
  N1 cross-window, no lineage                              beta -0.5
  ```

  Exclude entirely, do not down-weight: pinned tabs and an ambient-host list (mail, calendar, chat,
  music, search-results). They belong to every project so they belong to none. Keep S5 low on
  purpose — forty GitHub tabs are not one project, and over-weighting domain is exactly how the
  incumbents produce a useless "GitHub" group.

- Build a weighted undirected graph, prune edges below `w_min`, run **Louvain**
  (`graphology-communities-louvain`). **Not** connected components, **not** single-link
  agglomerative — both chain, so one weak bridge edge merges two real projects into one blob.
  Louvain optimises modularity and a lone bridge does not survive that test.
- `partitionToTarget(graph, lo=3, hi=9)` — binary-search Louvain's `resolution` over ~8 iterations
  until the community count lands in range. **Group count is a product guarantee, not an algorithm
  output:** 137 tabs in 40 groups is the same overwhelm in a new costume.
- Split any community over ~15 tabs by re-running Louvain on its induced subgraph.
- Orphans go to a separate `looseEnds` array. **Never create a "Miscellaneous" group** — that is
  Chrome's documented failure and it turns a leftover into an object the user feels responsible for.

**c. Scoring harness** (Node CLI): `npm run export` dumps `TabTrace[]` to `fixtures/<name>.json`;
hand labels live in `fixtures/<name>.labels.json` (traceId → project name); Chrome's own proposal in
`fixtures/<name>.chrome.json`. `npm run score` prints **Adjusted Rand Index** (primary), pairwise
precision/recall/F1, and cluster count for both partitions against the labels. `npm run ablate`
re-runs with each beta zeroed and prints the ARI delta per signal. Implement ARI properly
(contingency table, corrected for chance) and unit-test it against known values.

**d. Minimal UI** — one page from the extension icon showing proposed clusters. Read-only. Nothing
on it changes the browser.

**Do NOT build in Phase 0:** any `chrome.tabGroups` call, any closing or archiving, any AI/LLM call,
embeddings or transformers.js or ONNX or WASM, a settings screen, an onboarding flow, sync,
accounts, or any network request whatsoever.

**Done when:** `npm run build` gives a loadable unpacked extension; an integration check *proves*
the collector records `openerTraceId` and `transition` for new tabs (don't assert it, show it);
`src/cluster/` has zero `chrome.*` and passes unit tests; `npm run score` runs end-to-end on a real
exported fixture; README states the pass condition.

**GATE:** ARI beats Chrome's organiser by **≥ 0.15 absolute on 4 of 5** real browsers with 80+ tabs,
**and** zeroing S1/S2/S8 drops ARI by **≥ 0.10**.

**Known limit — report it, don't hide it:** co-activation and dwell only accrue after days of
collection, so Phase 0 really tests S1–S7 with history-backfilled timing. The signal most likely to
be the long-term advantage is the one that cannot be validated at this gate. Read a marginal pass as
more encouraging than it looks; a clear fail as fatal.

---

### Phase 1 — Amnesty · ~2–3 weeks

**Question:** Will people actually press "Archive & close" — and does their tab count stay down a
week later?

**Build:**

- **Real grouping.** Write the Phase 0 clusters to `chrome.tabGroups`, handling the saved-group
  failure from §5.6 gracefully. Colour by stable hash of the group's dominant host so a project
  keeps its colour across sweeps; recognisability beats aesthetics.
- **Group naming — the only model call.** One `LanguageModel.prompt()` per community, not per tab
  (≈8 calls for 137 tabs). Use structured output: `responseConstraint` takes a JSON Schema (Chrome
  137+), constrain `{ name: string(≤24), color: enum of the nine }`. **Feed the model the evidence
  for the grouping, not just titles** — "these nine tabs opened within four minutes of each other,
  starting from a typed visit to jira.acme.com" produces a name a human recognises; a bare title
  list produces "Various Development Resources."
- **Three tiers, from day one.** Default: on-device Gemini Nano via the Prompt and Summarizer APIs
  (both stable for extensions since Chrome 138) — zero cost, nothing leaves the machine. Fallback
  when `availability()` is unavailable: heuristic names from the highest-IDF shared token or the
  dominant registrable domain — grouping still works, just unnamed by AI. Optional paid/BYO-key
  cloud tier, **never on by default**. The hardware bar for on-device is real: 22 GB free disk,
  >4 GB VRAM or 16 GB RAM with 4+ cores, desktop only. Expect a meaningful share of users on the
  fallback, and make the fallback genuinely good.
- **Archive & close.** One action per group. Writes an archive card (group name, event label, per-tab
  line, full digest, restore URLs) to IndexedDB, then closes those tabs. Never deletes. Never
  auto-runs.
- **Undo.** Persisted, survives restart, reachable 24 h, restores the whole group including order.
- **Forget.** Per-record forget control, per-domain never-remember list, incognito untouched.
- **Summarisation queue.** Chunked across `chrome.alarms` plus an offscreen document — the service
  worker cannot hold this (see §5.5).

**Do NOT build:** search (that's Phase 2), any MCP, any cloud default, any auto-close, any settings
beyond the never-remember list.

**Done when:** a real 100+ tab browser can be swept, grouped, named, and archived group-by-group;
undo restores correctly after a browser restart; the heuristic tier works with the AI APIs disabled.

**GATE:** testers actually press Archive & close of their own accord, **and** their open-tab count is
still lower seven days later. If they sweep once and never again, Phase 2 is what fixes it — but be
honest about which happened.

---

### Phase 2 — The return path · ~2 weeks

**Question:** Does the archive give things back — or did we build a doom box?

This is the retention phase. Without it Phase 1 is a one-time cleanup people forget about.

**Build:**

- **Search** across everything archived — full-text over titles, digests and URLs. Semantic search
  only if lexical proves insufficient; measure before adding weight.
- **Restore** — one tab, or a whole session, in one click, in original order.
- **Event-shaped browsing.** The archive is organised by *session* (the Phase 0 segmentation), not
  by date. Cards are headed by what the person was doing, date as small secondary metadata. See §6.5
  for why this is not a stylistic choice.
- **Resurfacing — the actual feature.** The archive volunteers things on a surface the user already
  looks at. **Put it on the new-tab page, not in a popup** — a popup you have to open is out of
  sight, which is the exact failure this product exists to fix. Examples of what it volunteers:
  *"you archived 43 tabs from the pricing work last Tuesday — three are open again, so you probably
  weren't finished"*; on a Monday, the two sessions still live when the week ended. Ambient, never a
  notification, never a nag.

**Done when:** someone can find a thing they archived three weeks ago without remembering when, and
the new-tab surface has shown them something useful they did not ask for.

**GATE — the doom-box test:** does anyone search or act on a resurfaced card in week two? If nobody
looks back, we automated the box and the "memory" pitch is false. This gate matters more than
Phase 1's.

---

### Phase 3 — The MCP bridge · ~1–2 weeks

**Question:** Can Claude answer things about your browsing that nothing else can?

**Only build this if Phase 2 passed.** An MCP server over an archive nobody reads is a demo, not a
product.

**Build:** a local MCP server over the archive, shipped as an `.mcpb` bundle for one-click install
into Claude Desktop, connected to the extension over WebSocket or native messaging. Tools: search
the archive, restore a session, summarise a time range, "what was I working on."

Two things to keep straight and not conflate: **MCP cannot run inside a Chrome extension** — it is a
local process an MCP client connects to, hence the bridge and the second install, which is a real
conversion cost and the reason this is last. And **WebMCP** (`navigator.modelContext`) is a
different thing entirely — it lets a *page* declare tools to an agent, is in W3C discussion, and sits
behind a flag in Chrome's 146 Canary line. It is not a route to controlling tabs. Also note Claude
in Chrome already exists, so "let an agent drive my browser" has an incumbent — our differentiator is
the persistent archive, not the driving.

**Done when:** a fresh Claude Desktop install can answer "what was I researching last Tuesday?" from
the local archive, with no cloud round-trip for the data itself.

**GATE:** does anyone use it twice?

---

## 8. Stack and layout

TypeScript. Vite with `@crxjs/vite-plugin`. `idb` for IndexedDB. `graphology` +
`graphology-communities-louvain`. Vitest. No UI framework unless a page genuinely needs one — plain
DOM keeps the bundle honest and the review surface small.

```
src/
  collector/     service worker + content script. chrome.* lives here.
  cluster/       pure functions. ZERO chrome.* imports. fully unit-tested.
  archive/       phase 1+. storage, undo, forget.
  ui/            xray page (p0), sweep page (p1), newtab (p2)
  mcp/           phase 3
tools/           export + score + ablate CLIs
fixtures/        exported traces, hand labels, chrome baselines
docs/            PROJECT.md, PHASES.md, DECISIONS.md
```

The `cluster/` purity rule is not style — it is what makes the thesis testable in Node without a
browser. Keep it absolute.

---

## 9. How to work with me

- **Ask before deviating** from anything in §5 or §6. Those are the two sections where a reasonable-
  looking shortcut quietly breaks the project.
- **Checkpoint at each phase gate.** Do not roll into the next phase on your own.
- **Log judgement calls** in `docs/DECISIONS.md` as you go — three lines each. Compaction will eat
  your reasoning otherwise.
- **Commit per meaningful step**, not per phase.
- **When a measurement comes out badly, say so plainly.** The gates exist to let this project die
  cheaply if the thesis is wrong. A harness tuned to pass is worse than no harness.
- **Prefer deleting scope to adding it.** Every phase has an explicit anti-scope list; treat building
  something on it as a failure of the task, not initiative.

---

## 10. Start here

Do §0: init the repo, write `CLAUDE.md`, `docs/PROJECT.md`, `docs/PHASES.md`, `docs/DECISIONS.md`,
commit, and show me the tree plus `CLAUDE.md`.

Then propose the `TabTrace` type and the Phase 0 file structure, and wait for my okay before
implementing the collector.