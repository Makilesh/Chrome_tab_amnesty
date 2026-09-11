# Phases

Each phase answers one question and ends at a gate. **Do not start a phase before the user confirms
the previous gate passed.** A failed gate is a real outcome — build the measurement honestly enough
that it can say the idea is wrong.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Phase 0 — The X-ray · ~1 weekend · **CURRENT**

**Question:** Does clustering by behavioural signals beat Chrome's built-in "Organize tabs" at
recovering someone's real projects?

### Deliverables

**a. Collector** (service worker + content script; records, never touches UI)
- [ ] `TabTrace` type and `idb` store keyed on `traceId` (UUID minted in `onCreated`, never tabId)
- [ ] `openerTraceId` captured at event time in `chrome.tabs.onCreated`
- [ ] `transition` from `chrome.history.getVisits()` (visit nearest `openedAt`; needs `"history"`)
- [ ] `lastActiveAt`, `activationCount`, `dwellMs` maintained from `chrome.tabs.onActivated`
- [ ] `coActive` pair counts — tabs foregrounded within 60 s of each other
- [ ] `host`, `eTLD1`, `pathTokens[]`, `queryKeys{}` derived from URL
- [ ] Content-script digest `{ description, headings[], leadText ≤1000 chars }` on
      `readyState === 'complete'` and first `visibilitychange` → visible; debounced; never
      re-capture the same URL within 10 min
- [ ] `pinned`, `discarded`, `digestAt` tracked
- [ ] Re-bind traces to tabs on startup by (url, windowId)
- [ ] Incognito never touched

**b. Clusterer** (`src/cluster/`, zero `chrome.*` imports, runs in plain Node)
- [ ] `segment(traces, gapMs = 25*60_000)` — cut on gap > gapMs OR
      `NEW_INTENT.has(transition) && !openerTraceId`, `NEW_INTENT = {typed, generated, auto_bookmark}`
- [ ] `affinity(a, b)` — weighted sum, weights in one exported const (S1 3.0, S2 2.0, S8 1.5,
      S3 1.5, S6 1.2, S4 1.0, S7 1.0, S5 0.8, N1 −0.5)
- [ ] Exclusion (not down-weighting) of pinned tabs and ambient hosts (mail, calendar, chat,
      music, search results)
- [ ] Weighted undirected graph, prune edges below `w_min`, Louvain via
      `graphology-communities-louvain` (not connected components, not single-link)
- [ ] `partitionToTarget(graph, lo=3, hi=9)` — binary-search resolution over ~8 iterations
- [ ] Split communities over ~15 tabs by re-running Louvain on the induced subgraph
- [ ] Orphans → `looseEnds` array; never a "Miscellaneous" group
- [ ] Unit tests for all of the above

**c. Scoring harness** (Node CLI)
- [ ] `npm run export` dumps `TabTrace[]` to `fixtures/<name>.json`
- [ ] Hand labels in `fixtures/<name>.labels.json` (traceId → project name)
- [ ] Chrome's proposal in `fixtures/<name>.chrome.json`
- [ ] `npm run score` prints ARI (primary), pairwise precision/recall/F1, cluster count for both
      partitions against labels
- [ ] ARI implemented properly (contingency table, chance-corrected) and unit-tested against
      known values
- [ ] `npm run ablate` re-runs with each beta zeroed and prints ARI delta per signal

**d. Minimal UI**
- [ ] One read-only page from the extension icon showing proposed clusters. Nothing on it changes
      the browser. Obeys all §6 rules (no tab counts, no forbidden words).

### Anti-scope (do NOT build)
Any `chrome.tabGroups` call · closing or archiving · any AI/LLM call · embeddings, transformers.js,
ONNX, WASM · settings screen · onboarding · sync · accounts · any network request whatsoever.

### Done when
- [ ] `npm run build` gives a loadable unpacked extension
- [ ] Integration check *proves* the collector records `openerTraceId` and `transition` for new
      tabs (shown, not asserted)
- [ ] `src/cluster/` has zero `chrome.*` and passes unit tests
- [ ] `npm run score` runs end-to-end on a real exported fixture
- [ ] README states the pass condition

### GATE
- [ ] ARI beats Chrome's organiser by **≥ 0.15 absolute on 4 of 5** real browsers with 80+ tabs
- [ ] Zeroing S1/S2/S8 drops ARI by **≥ 0.10**

**Known limit — report, don't hide:** co-activation and dwell only accrue after days of collection,
so Phase 0 really tests S1–S7 with history-backfilled timing. Read a marginal pass as more
encouraging than it looks; a clear fail as fatal.

---

## Phase 1 — Amnesty · ~2–3 weeks

**Question:** Will people actually press "Archive & close" — and does their tab count stay down a
week later?

### Deliverables
- [ ] Real grouping: write Phase 0 clusters to `chrome.tabGroups`; handle "Saved groups are not
      editable" gracefully; colour by stable hash of dominant host
- [ ] Group naming: one `LanguageModel.prompt()` per community, structured output via
      `responseConstraint` `{ name: string(≤24), color: enum of nine }`; feed the model the
      *evidence* for the grouping, not just titles
- [ ] Three tiers from day one: on-device Gemini Nano (Prompt + Summarizer APIs) default;
      heuristic fallback (highest-IDF shared token or dominant domain) when `availability()` is
      unavailable; optional BYO-key cloud tier never on by default
- [ ] Archive & close: one action per group; archive card (name, event label, per-tab line, full
      digest, restore URLs) to IndexedDB, then close. Never deletes. Never auto-runs.
- [ ] Undo: persisted, survives restart, reachable 24 h, restores whole group incl. order
- [ ] Forget: per-record control, per-domain never-remember list, incognito untouched
- [ ] Summarisation queue chunked across `chrome.alarms` + offscreen document

### Anti-scope
Search · any MCP · any cloud default · any auto-close · settings beyond the never-remember list.

### Done when
- [ ] A real 100+ tab browser can be swept, grouped, named, archived group-by-group
- [ ] Undo restores correctly after a browser restart
- [ ] Heuristic tier works with the AI APIs disabled

### GATE
- [ ] Testers press Archive & close of their own accord
- [ ] Their open-tab count is still lower seven days later

---

## Phase 2 — The return path · ~2 weeks

**Question:** Does the archive give things back — or did we build a doom box?

### Deliverables
- [ ] Search across everything archived — full-text over titles, digests, URLs (semantic only if
      lexical proves insufficient; measure first)
- [ ] Restore — one tab or a whole session, one click, original order
- [ ] Event-shaped browsing — archive organised by session, headed by what the person was doing,
      date as small secondary metadata
- [ ] Resurfacing on the **new-tab page** — ambient, never a notification, never a nag

### Done when
- [ ] Someone can find a thing archived three weeks ago without remembering when
- [ ] The new-tab surface has shown them something useful they did not ask for

### GATE — the doom-box test
- [ ] Someone searches or acts on a resurfaced card in week two

---

## Phase 3 — The MCP bridge · ~1–2 weeks

**Question:** Can Claude answer things about your browsing that nothing else can?
**Only build if Phase 2 passed.**

### Deliverables
- [ ] Local MCP server over the archive, shipped as `.mcpb` for Claude Desktop
- [ ] Bridge to the extension over WebSocket or native messaging
- [ ] Tools: search the archive, restore a session, summarise a time range, "what was I working on"

### Done when
- [ ] A fresh Claude Desktop install answers "what was I researching last Tuesday?" from the local
      archive with no cloud round-trip for the data

### GATE
- [ ] Does anyone use it twice?
