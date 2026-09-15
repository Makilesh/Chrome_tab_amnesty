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
- [x] `TabTrace` type and `idb` store keyed on `traceId` (UUID minted in `onCreated`, never tabId)
- [x] `openerTraceId` captured at event time in `chrome.tabs.onCreated`
- [x] `transition` from `chrome.history.getVisits()` (visit nearest `openedAt`; needs `"history"`)
- [x] `lastActiveAt`, `activationCount`, `dwellMs` maintained from `chrome.tabs.onActivated`
- [x] `coActive` pair counts — tabs foregrounded within 60 s of each other
- [x] `host`, `eTLD1`, `pathTokens[]`, `queryKeys{}` derived from URL; eTLD+1 via trimmed
      suffix data file biased to PSL private section, fallback errs toward splitting
- [x] Content-script digest `{ description, headings[], leadText ≤1000 chars }` on
      `readyState === 'complete'` and first `visibilitychange` → visible; debounced; never
      re-capture the same URL within 10 min
- [x] `pinned`, `discarded`, `digestAt` tracked
- [x] Re-bind traces to tabs on startup by (url, windowId)
- [x] Incognito never touched

**b. Clusterer** (`src/cluster/`, zero `chrome.*` imports, runs in plain Node)
- [x] `segment(traces, gapMs = 25*60_000)` — cut on gap > gapMs OR
      `NEW_INTENT.has(transition) && !openerTraceId`, `NEW_INTENT = {typed, generated, auto_bookmark}`
- [x] `affinity(a, b)` — weighted sum, weights in one exported const (S1 3.0, S2 2.0, S8 1.5,
      S3 1.5, S6 1.2, S4 1.0, S7 1.0, S5 0.8, N1 −0.5)
- [x] Exclusion (not down-weighting) of pinned tabs and ambient hosts (mail, calendar, chat,
      music, search results)
- [x] Weighted undirected graph, prune edges below `w_min`, Louvain (own deterministic port on
      both sides — see DECISIONS 2026-09-12; not connected components, not single-link)
- [x] `partitionToTarget(graph, lo=3, hi=9)` — binary-search resolution over ~8 iterations
- [x] Split communities over ~15 tabs by re-running Louvain on the induced subgraph
- [x] Orphans → `looseEnds` array; never a "Miscellaneous" group
- [x] Unit tests for all of the above (TS 17 + Python 24; `npm run parity` ties them)

**c. Scoring harness** (Node CLI)
- [x] Export from the x-ray page (blob + `<a download>`, no `downloads` permission) to
      `fixtures/<name>.json` with `schemaVersion`, capture window and count in the header
- [x] Export modes: `full` and `shareable` (default) — query values stripped, `leadText`
      dropped, URLs reduced to host+path; consent summary shown before writing
- [x] Hand labels in `fixtures/<name>.labels.json` (traceId → project name)
- [x] "Capture Chrome baseline" button reads real tab groups after Organize tabs, then
      ungroups; handles §5.6 saved-group failure loudly; hand transcription as fallback →
      `fixtures/<name>.chrome.json` `{ method, capturedAt, groups[], ungrouped[] }`
- [x] `npm run score` prints ARI (primary), pairwise precision/recall/F1, cluster count for both
      partitions against labels
- [x] Python bench (`analysis/tabamnesty`) is where signals change; TS port in `src/cluster/`
      ships; `npm run parity` fails on any drift (signals exact, partitions ARI ≥ 0.98; observed 1.0)
- [x] **Gate path scores the TS partition**: score/ablate/report run `tools/cluster-cli.ts` and
      print parity in the header; `--python` is opt-in and labelled as not a gate number
- [x] Ablation positive controls (`synthetic_lineage` / `_coactive` / `_temporal`) with tests
      that zeroing the one distinguishing signal drops ARI
- [x] ARI + pairwise P/R/F1 via `sklearn` in `analysis/score.py` (no hand-rolled ARI, no TS metrics)
- [x] Ungrouped convention printed in score header + README: each ungrouped / loose-end tab is
      its own singleton cluster, applied identically to both partitions
- [x] ARI reported on the full tab set AND on the subset both partitions placed
- [x] `npm run ablate` — TS cluster CLI emits one partition per beta-override config;
      `analysis/ablate.py` scores and tabulates ARI delta per signal
- [x] `npm run score` / `npm run ablate` are thin wrappers; extension builds with zero Python

**d. Minimal UI**
- [x] One read-only page from the extension icon showing proposed clusters. Nothing on it changes
      the browser. Obeys all §6 rules (no tab counts, no forbidden words).

### Anti-scope (do NOT build)
Any `chrome.tabGroups` call (sole exception: read + ungroup Chrome's own groups for baseline
capture) · closing or archiving · any AI/LLM call · embeddings, transformers.js,
ONNX, WASM · settings screen · onboarding · sync · accounts · any network request whatsoever.

### Done when
- [x] `npm run build` gives a loadable unpacked extension
- [x] Integration check *proves* the collector records `openerTraceId` and `transition` for new
      tabs (shown, not asserted)
- [x] `src/cluster/` has zero `chrome.*` and passes unit tests
- [x] `npm run score` runs end-to-end on a real exported fixture (2026-09-15, `makilesh`, draft labels)
- [x] README states the pass condition

### GATE
- [ ] ARI beats Chrome's organiser by **≥ 0.15 absolute on 4 of 5** real browsers with 80+ tabs
- [ ] Zeroing S1/S2/S8 drops ARI by **≥ 0.10**

**Known limits — report, don't hide:** co-activation and dwell only accrue after days of collection,
so Phase 0 really tests S1–S7 with history-backfilled timing. Read a marginal pass as more
encouraging than it looks; a clear fail as fatal. The "zero S1/S2/S8" run leaves S3 standing (same
timestamps as S2). On interleaved projects S2/S4 can mislead (see README). Duplicate-URL tabs can
swap identities across a restart.

**Protocol note:** if fewer than five browsers can be collected, the protocol is amended here
first and the shortfall is stated in the result — the gate is not restated to match what was got.
Chrome gates "Organize tabs" by sign-in, UI language and region; a browser without it counts for
the ablation half only, and the result must say how many of the five had it.

**Fixtures so far:** `makilesh` (re-exported 2026-09-15) — 28 http tabs, 22 event-time with
lineage / co-activation / digests, no Chrome organiser on the profile. Labels are a DRAFT proposed
from the traces, not yet confirmed by the owner. Pipeline smoke test; does not count toward the five.

**Finding 2026-09-15 (matters for every tester):** the 9 http tabs that pre-date the install all
carry `openedAt` within 14 s of each other (the session-restore `reload` visit) and so S2 = 0.99,
S3 = 1.0 for every pair among them — they form one blob whatever S1/S8 say, and zeroing S2 leaves
S3 holding it. On an 80+ tab browser most tabs pre-date the install, so if history backfill
collapses to the restore time the whole browser becomes one community and the gate cannot be
read. Either `refreshBackfilled` has not run on this profile since the fix (the deployed build
pre-dates 9cb171e, so it only runs on install/reload) or the history really has no non-reload
visit for those URLs. Next step: Reload the extension, re-export, and see which. If the latter,
backfilled-`reload` timestamps must stop counting as evidence of contemporaneity (signal change:
Python first, then TS, then parity).

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
