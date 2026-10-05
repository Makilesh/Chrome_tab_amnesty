# Decisions

Judgement calls the brief did not specify. Three lines each: decision, alternative rejected, why.
Append; never rewrite history.

---

## 2026-09-11 — Reuse the existing `Chrome_tab_amnesty` repo instead of `git init tab-amnesty`
- **Decision:** Keep the already-initialised repo (one prior commit) in `D:\GEN AI\Chrome_tab_amnesty`.
- **Rejected:** Creating a fresh sibling repo named `tab-amnesty` as §0 literally says.
- **Why:** The user had already created and opened this repo; a second repo would split history and the working directory for no benefit. The package name will still be `tab-amnesty`.

## 2026-09-11 — Original brief stays in git-ignored `info_docs/`; canonical copy is `docs/PROJECT.md`
- **Decision:** `docs/PROJECT.md` is a verbatim copy of `info_docs/p.md` and is the tracked source of truth.
- **Rejected:** Un-ignoring `info_docs/` and referencing it directly.
- **Why:** The brief says the repo docs win on any disagreement, so the tracked copy must be the canonical one; `info_docs/` was already ignored by the user.

## 2026-09-11 — `TabTrace` gains `url` and `Transition` gains `'unknown'`
- **Decision:** Store the full `url` on every trace; use `transition: 'unknown'` when no history visit matches `openedAt`.
- **Rejected:** Deriving the URL from host+path at re-bind time; defaulting unmatched transitions to `link`.
- **Why:** §5.3 re-bind is keyed on (url, windowId), so the exact URL must be stored. An unmatched visit is not evidence of continuation, and `segment()` treats `link` as continuation — conflating them would hide session boundaries.

## 2026-09-11 — eTLD+1 via a trimmed suffix data file biased toward the PSL private section
- **Decision:** `src/collector/suffixes.json` holds a curated list: PSL private suffixes first (`github.io`, `gitlab.io`, `pages.dev`, `workers.dev`, `r2.dev`, `vercel.app`, `netlify.app`, `web.app`, `firebaseapp.com`, `herokuapp.com`, `notion.site`, `substack.com`, `blogspot.com`, `wordpress.com`, ...), then the `co.uk` / `com.au` / `co.jp` / `co.in` / `com.br` tier. Fallback is last-two-labels; ambiguity errs toward splitting.
- **Rejected:** Bundling the full ~250 KB Public Suffix List; inlining the list in code.
- **Why:** S5 is the weakest positive signal (beta 0.8). Splitting one domain loses a weak signal; collapsing unrelated sites (forty `github.io` projects) inflates S5 across unrelated projects and corrupts clustering. Data file so it grows without a code change.

## 2026-09-11 — Export runs from the x-ray page via blob + `<a download>`; two modes, `shareable` is the default
- **Decision:** No `downloads` permission. File header carries `schemaVersion`, capture window (min/max `openedAt`) and trace count. `full` mode = everything (owner's machine only). `shareable` (default) = query values stripped (keys kept for S6), `digest.leadText` dropped, titles kept (S7), URLs reduced to host + path. A one-line consent summary is shown before writing a shareable file.
- **Rejected:** `chrome.downloads`; a single unredacted export; a Node CLI reading IndexedDB (impossible).
- **Why:** Smallest-possible permission set for store review. Old fixtures must fail loudly on a schema change. §6.10 applies to our tooling: four testers hand over every open URL, including medical/legal/job-hunting tabs.

## 2026-09-11 — Chrome baseline is captured from real tab groups, not transcribed
- **Decision:** A "capture Chrome baseline" button reads `chrome.tabGroups.query()` + `chrome.tabs.query({groupId})` after the user accepts Organize tabs, then `chrome.tabs.ungroup()` to restore the strip. Warn before; if ungroup throws the §5.6 saved-group error, say so instead of silently leaving tabs grouped. Hand transcription remains the fallback. Format: `{ method: "captured"|"transcribed", capturedAt, groups: [{name, color, traceIds}], ungrouped: [] }` — groups are positional, never keyed on name (Chrome emits duplicates and blanks).
- **Rejected:** Hand-transcribing 100+ tabs per browser.
- **Why:** Transcription error would land in the one number the project turns on. Reading groups is a Phase 0 exception to "no `chrome.tabGroups` calls" — it is read + ungroup on Chrome's own groups, never creating or editing ours.

## 2026-09-11 — Ungrouped convention: each ungrouped / loose-end tab is its own singleton cluster
- **Decision:** Chrome's ungrouped tabs and our `looseEnds` are both scored as singletons. Printed in the score output header and the README. ARI is reported on the full tab set and separately on the subset both partitions placed.
- **Rejected:** Excluding unplaced tabs from scoring; lumping all unplaced tabs into one cluster.
- **Why:** Any asymmetric treatment rigs the comparison. Singletons penalise both sides equally for failing to place a tab; one junk cluster rewards whichever side dumps more. The placed-subset ARI separates "better clustering" from "placed more tabs".

## 2026-09-11 — Analysis side is Python; clustering stays TS as the single source of truth
- **Decision:** `analysis/` (own `pyproject.toml`) holds `score.py`, `ablate.py`, `report.py`, later `refit.py`. TS clusters and writes partition JSON; Python only reads JSON and does maths using `sklearn.metrics.adjusted_rand_score` and `pair_confusion_matrix`. Ablation clustering runs TS-side via a beta-override flag; Python tabulates. `npm run score` / `npm run ablate` are thin wrappers that shell out. `src/cluster/metrics.ts` and its ARI tests are dropped. Hard constraint: the extension builds and runs with zero Python installed.
- **Rejected:** Hand-rolled ARI in TS with unit tests against known values; reimplementing any signal in Python.
- **Why:** sklearn is the reference implementation, deleting a task outright. Two implementations of a signal drift and we end up benchmarking the one we don't ship. Python is for the gate, not the product.

## 2026-09-11 — `TabTrace` gains `closedAt` and `backfilled`
- **Decision:** A closed tab's trace is kept with `closedAt` set; open-tab views filter on `closedAt === null`. Traces adopted at install or unmatched on startup get `openedAt`/`transition` from the most recent history visit and `backfilled: true`; `openerTraceId` is never backfilled.
- **Rejected:** Deleting traces on `onRemoved`; giving adopted tabs `openedAt = now` and `transition = 'unknown'`.
- **Why:** "Never deletes anything" should hold in the collector too, and a closed opener still anchors lineage. The brief already anticipates "history-backfilled timing" for Phase 0; flagging it keeps the report honest about which signals were event-time.

## 2026-09-11 — Startup re-bind: exact (url, windowId) first, then url-only
- **Decision:** On startup, match open tabs to stored traces by exact (url, windowId); unmatched tabs then match by url alone (windowIds are reassigned across restarts too); still-unmatched tabs become backfilled traces; unmatched stored traces get `closedAt`.
- **Rejected:** (url, windowId) only, as the brief literally says.
- **Why:** Chrome reassigns window ids across restarts, so a strict match would orphan every trace after every restart and the collector would never accumulate the S8 signal it exists to test.

## 2026-09-11 — One trace per tab; in-tab navigation updates the trace
- **Decision:** A tab keeps its `traceId` for its lifetime. When its URL changes, url features/title are refreshed and the digest reset; `openedAt`, `transition` and lineage stay as they were at creation.
- **Rejected:** Minting a new trace on every top-level navigation.
- **Why:** The thesis is about tabs opened from one another in a sitting; a tab is the unit the user sees on the strip and the unit Chrome's organiser groups. Per-navigation traces would inflate counts and break the (url, windowId) re-bind.

## 2026-09-11 — `"incognito": "not_allowed"` in the manifest
- **Decision:** The extension cannot be enabled in incognito at all.
- **Rejected:** `"spanning"` with runtime `tab.incognito` checks.
- **Why:** §6.10 says incognito is never touched; making it impossible at the manifest level is stronger than a check that every handler must remember.

## 2026-09-11 — Per-tab serial lanes in the service worker
- **Decision:** All handlers for a tab run through a per-tab promise chain (`serial(tabId, fn)`); activity handlers that touch shared meta share one lane. The map holds only in-flight work — nothing persistent.
- **Rejected:** Independent async handlers with idb transactions as the only guard.
- **Why:** `onUpdated` fires within milliseconds of `onCreated`; the integration check showed it adopting the tab as a backfilled duplicate before the event-time trace was written. §5.5 forbids state in globals, not coordination of work that is in flight while the worker is alive.

## 2026-09-11 — Window-close removals are deferred; only individual tab closes set `closedAt` immediately
- **Decision:** `onRemoved` with `isWindowClosing` schedules a 1-minute `chrome.alarms` reconcile instead of setting `closedAt`. Reconcile == `rebindAll`: bind live tabs to orphaned traces by url, then close whatever is bound to no live tab. `onStartup` runs the same routine.
- **Rejected:** Setting `closedAt` on every removal; a `closedByWindow` flag with a grace window at startup.
- **Why:** A window closing and the browser shutting down are indistinguishable in the event, and the check showed shutdown closing every trace so session restore had nothing to re-bind to (0 of 3 kept). With the deferral, 3 of 3 traces survived a restart on new tab ids.

## 2026-09-11 — Adoption re-binds orphans itself, so re-bind does not depend on event order
- **Decision:** Any tab with no live trace first looks for an open trace with the same url whose tabId is no longer live (prefer same windowId, then nearest index) and re-binds to it; only then is a fresh backfilled trace minted. `rebindAll` is a loop over this.
- **Rejected:** A single startup pass that assumes it runs before `onUpdated` for restored tabs.
- **Why:** Chrome fires `onUpdated` for restored tabs before or during `onStartup`; the first attempt lost the race and duplicated every tab.

## 2026-09-11 — Integration check drives Chrome for Testing with puppeteer-core against a local HTTP server
- **Decision:** `npm run check` builds, launches Chrome for Testing (`npx @puppeteer/browsers install chrome@stable`, git-ignored `chrome/`) with the unpacked extension, serves test pages from `127.0.0.1`, opens tabs by typed navigation and real link clicks, restarts with session restore, and prints the traces. `puppeteer-core` is a devDependency; nothing is bundled into the extension.
- **Rejected:** Asking the user to load the extension by hand and read the dev page; using the installed branded Chrome; hitting public sites.
- **Why:** The brief wants proof shown, not asserted, and repeatable. Branded Chrome ≥137 ignores `--load-extension`. A local server keeps the check hermetic and off the network.

## 2026-09-11 — Raw-trace diagnostics live on a separate unlinked dev page, not the x-ray page
- **Decision:** `src/ui/dev/` shows raw `TabTrace` rows (counts, ids, dwell) and is reachable only by URL. The x-ray page from the icon is the only user-facing surface and obeys §6.
- **Rejected:** A "diagnostics" section on the x-ray page.
- **Why:** §6.1 forbids showing tab counts as a problem anywhere the user is meant to look; a developer table full of counts cannot sit on that page.

## 2026-09-11 — SUPERSEDES "Python never reimplements the clustering": Python is the research bench, TS ships, parity test between them
- **Decision:** The clusterer is built first in Python (`analysis/tabamnesty/`: segment, signals, graph, Louvain, partition-to-target, score, ablate, refit) and the Phase 0 gate is run there. The same algorithm is ported to `src/cluster/` in TS for the extension. `npm run parity` feeds both the same fixture and fails if edge weights differ (exact, to 1e-9) or the partitions disagree (ARI between them < 0.9). Signals change in Python first; TS follows.
- **Rejected:** Python-only (the extension cannot run it, and Phase 0d needs clusters in the browser); TS-only with Python as scorer (the earlier decision — the user wants to iterate on the graph in Python).
- **Why:** User request. Iterating on signals is faster with networkx/pandas/sklearn, and the gate is a research question. The parity test is what keeps two implementations from drifting, which was the original objection.

## 2026-09-11 — Python scope beyond the clusterer: beta refit, lexical experiments, Phase 3 MCP server
- **Decision:** `analysis/refit.py` (sklearn logistic regression → `betas.json` read by TS), lexical/TF-IDF experiments in Python (findings ported, nothing ships from there), and the Phase 3 MCP server in Python (mcp SDK, `.mcpb`). Phase 1 group naming stays in the browser — Gemini Nano is a browser API.
- **Rejected:** Moving Phase 1 naming to Python.
- **Why:** User request, bounded by what can physically run where.

## 2026-09-11 — networkx's built-in Louvain, one venv at the repo root
- **Decision:** `networkx.community.louvain_communities` (resolution + seed) rather than a separate louvain package; `analysis/pyproject.toml` installs into the existing root `.venv` via `uv pip install -e analysis`.
- **Rejected:** `python-louvain`; a second venv under `analysis/`.
- **Why:** Fewer dependencies; the user already created the root venv.

## 2026-09-11 — Signal details the brief left open (Python is canonical; TS must match)
- **Decision:** S8 = (coActive[a][b] + coActive[b][a]) / (2 * min(activationCount)) clipped to 1. S5 sibling = same leftmost label of eTLD+1 under a different suffix, label ≥ 4 chars (github.com / github.io). S6 features = path tokens ∪ "key=value" query pairs (values blank in shareable exports, so effectively keys). S7 tokens = title + digest description/headings/leadText + path tokens; tf = 1+ln(count), idf = ln((N+1)/(df+1))+1, L2 cosine, small stop list, no pure numbers. N1 = different windows AND S1 == 0. `w_min = 1.0`. Excluded (not down-weighted): pinned, ambient, non-http, closed. Louvain seed 0; resolution binary-searched on a log scale in [0.02, 20]; count target counts communities of size ≥ 2 only.
- **Rejected:** sklearn TfidfVectorizer for S7 (would make exact TS parity impossible); normalising S8 by the global max pair count (one heavy pair would flatten everything else).
- **Why:** Each is the simplest reading of the brief that is portable to TS with identical arithmetic.

## 2026-09-11 — Synthetic fixture exists for mechanics only
- **Decision:** `analysis/tabamnesty/synth.py` writes `fixtures/synthetic.*` (flagged `_synthetic: true`) for unit tests and the parity check. Its "chrome" baseline is one group per eTLD+1.
- **Rejected:** Using it as one of the five gate browsers.
- **Why:** It encodes the thesis it would be testing; on it every signal is redundant (ablation deltas ≈ 0), which says nothing about real browsers.

## 2026-09-11 — Parity contract between the Python bench and the TS clusterer
- **Decision:** `npm run parity` runs `tools/cluster-cli.ts --edges` and `tabamnesty.parity` on the same fixture and fails if any pair's signal or affinity differs by more than 1e-9, or if the two partitions' mutual ARI is under 0.90. Both sides sum signals in the same order and use the same TF-IDF arithmetic; Louvain implementations may tie-break differently, hence ARI rather than equality for partitions.
- **Rejected:** Requiring identical communities (networkx and graphology Louvain are different code with different random orders); comparing only ARI against labels (would let a signal bug through as long as the score held).
- **Why:** This is the mechanism that keeps two implementations from drifting — the original objection to having two.

## 2026-09-11 — Python partitions must not depend on PYTHONHASHSEED
- **Decision:** Induced subgraphs for the >15 split are built explicitly in parent-graph node order (`_induced`), never via `g.subgraph(set)`; synthetic trace ids are seeded. A test spawns three interpreters with different hash seeds and requires identical partitions.
- **Rejected:** Sorting community members alphabetically before Louvain (would still be deterministic but would diverge from the TS side, which uses input order).
- **Why:** A networkx subgraph view over a small node set iterates the *set*, and Louvain's tie-breaking follows node order; the same fixture produced two different ARIs in two processes before this fix. A benchmark that changes between runs cannot gate anything.

## 2026-09-11 — X-ray group headings are heuristic (shared high-IDF tokens), not names
- **Decision:** `src/cluster/describe.ts` heads each card with up to three tokens shared by ≥40% of the group ranked by IDF over the whole corpus, falling back to the dominant host; a secondary line gives an event-shaped time ("Tuesday afternoon") and the group's hosts. No input field, nothing editable.
- **Rejected:** No heading at all; a date as the heading; a "name this" field.
- **Why:** Phase 0 forbids AI, §6.7 forbids user naming, §6.5 says date is never the primary label. Something recognisable still has to head the card (§6.3). This is also the Phase 1 heuristic fallback in embryo.

## 2026-09-11 — Study controls live on the x-ray page, collapsed, below the groups
- **Decision:** Export and baseline capture sit in a closed `<details>` under the clusters, with a plain-language line saying what a shareable export includes and leaves out.
- **Rejected:** A separate dev page for them; putting them above the fold.
- **Why:** Testers need to reach them from the icon without instructions, but §6.3 says the first thing on screen is what the person recognises, not a control.

## 2026-09-11 — `npm run check` also audits the x-ray page
- **Decision:** The integration check opens the x-ray page, screenshots it, greps the rendered text for §6.2 words and for "N tabs", and clicks Export to prove the shareable file downloads, loads, and is redacted (url reduced to host+path, query values blank, leadText empty).
- **Rejected:** Trusting the code review for §6 compliance.
- **Why:** The brief says each §6 rule has a visible failure you can check for; so check for it.

## 2026-09-12 — The gate is measured on the TS partition; Python clustering is opt-in
- **Decision:** `ta-score`, `ta-ablate` and `ta-report` run `tools/cluster-cli.ts` (the shipped code) and score what it produced. Ablation partitions come from the TS CLI's `--ablate` (one partition per beta config). Python-side clustering is behind `--python`, whose output is labelled "PYTHON BENCH … not a gate number". Every score/ablate/report header prints the parity result next to `partition source:`; a parity failure prints a do-not-report warning and exits 1.
- **Rejected:** The previous wiring, where score/ablate/report clustered in Python by default.
- **Why:** As wired before, Phase 0 would have passed or failed on numbers the extension never produced. Reviewer catch.

## 2026-09-12 — Parity threshold 0.98 (observed 1.0); parity runs inside `npm run check` and over every fixture
- **Decision:** `MIN_ARI = 0.98`; anything below is a bug to investigate. `npm run parity` with no args checks every `fixtures/<name>.json`; `npm run check` = build + integration check + parity.
- **Rejected:** 0.90 (a couple of whole groups on 137 tabs), and parity as an optional command.
- **Why:** Signals agree to 1e-15, so any partition divergence is algorithmic, not arithmetic, and should be reproducible rather than tolerated.

## 2026-09-12 — SUPERSEDES "graphology-communities-louvain" / "networkx louvain": one deterministic Louvain ported to both sides
- **Decision:** `src/cluster/louvain.ts` and `analysis/tabamnesty/louvain.py` implement standard two-phase Louvain with resolution, visiting nodes in input order, moving only on strictly positive gain (> 1e-12) with first-found tie-breaking, renumbering communities by first appearance, and summing aggregate weights in node order. `graphology` stays as the graph structure; `graphology-communities-louvain` is removed. This deviates from the §8 stack line naming that package — flagged to the user in the review response.
- **Rejected:** Keeping the two library Louvains and tolerating ARI ≥ 0.9 between them.
- **Why:** With the positive-control fixtures the two libraries, both seeded, agreed only at ARI 0.77–0.79 — signals identical to 1e-15, partitions differing purely by visiting order on a dense near-uniform graph. After the port, all four fixtures give partition ARI 1.0000 between TS and Python.

## 2026-09-12 — S8 co-activation normalised by the strongest partner, not by activation count
- **Decision:** S8 = c(a,b) / max(strongest(a), strongest(b), c(a,b)) where c is the pair's count summed over both sides and strongest(x) is x's heaviest pair. 1.0 = "the tab you switch to most".
- **Rejected:** c(a,b) / (2 · min(activationCount)) — the earlier choice.
- **Why:** The co-activation positive control showed the old normalisation flattening every pair in a well-connected project to ~1/k (within-project mean 0.10); zeroing S8 changed ARI by 0.004, i.e. the clusterer could not use it. With strongest-partner normalisation the same fixture goes from ARI 0.77 to 0.19 when S8 is zeroed.

## 2026-09-12 — Positive controls for the ablation: `synthetic_lineage`, `synthetic_coactive`, `synthetic_temporal`
- **Decision:** Four projects on the same host with the same vocabulary, interleaved in bursts of 1–4 tabs, distinguishable by exactly one behavioural signal. Tests assert: zeroing S1 drops ARI ≥ 0.10 on the lineage fixture (0.27 → 0.10); zeroing S8 drops ≥ 0.30 on the co-activation fixture (0.77 → 0.19); on the temporal fixture zeroing S2 alone changes nothing (S3, same session, encodes the same boundary) and zeroing S2+S3 craters (1.0 → 0.07). Mechanics only; never count toward the gate.
- **Rejected:** Strict one-tab round-robin interleaving. With the brief's weights it defeats lineage even at full S1 (ARI −0.07): every tab's nearest neighbours in time and on the strip belong to other projects, so S2+S3+S4 (≈4.5 combined) outvote S1 (≈0.9 mean, since 1/(1+d) decays fast inside a 10-tab tree).
- **Why:** Reviewer point: without a positive control a flat real-browser ablation is uninterpretable. Two findings to carry into the gate reading: (1) on interleaved work the contemporaneity signals actively mislead — on the lineage fixture zeroing S2 *raises* ARI from 0.27 to 1.0; (2) the gate's "zero S1/S2/S8" run leaves S3 standing, so it under-states how much timing contributes. Weights were not tuned on any of this — that is what `refit.py` on labelled real pairs is for.

## 2026-09-12 — Known limitation: startup re-bind can attach a trace to the wrong duplicate-URL tab
- **Decision:** Documented, not fixed. `findOrphanFor` matches open orphan traces by URL, preferring the same window and then the nearest strip index. Two tabs on the same URL (common: two copies of the same issue, doc or dashboard) can swap identities across a restart, carrying `openerTraceId`, `coActive` and activity with them.
- **Rejected:** Matching on (url, title, index) — title is identical too; using session-restore ordering — not exposed to extensions.
- **Why:** Window ids are reassigned on restart, so nothing stronger than URL is available. Relevant when interpreting S1's ablation delta on a fixture from a browser that has been restarted: some lineage will be attached to the wrong twin.

## 2026-09-12 — Lane ordering invariant is a comment, not a runtime check
- **Decision:** `background.ts` names the invariant (tab lanes may await the activity lane; the activity lane never awaits a tab lane) and lists the functions bound by it.
- **Rejected:** A module-level "inside activity lane" flag that throws on violation.
- **Why:** A flag set across an `await` is also seen by unrelated events that fire while the activity lane is waiting on IndexedDB, so it would throw on legitimate concurrent work; service workers have no AsyncLocalStorage to scope it properly.

## 2026-09-12 — Backfill prefers the latest non-reload visit (first real export exposed it)
- **Decision:** `lastVisit()` picks the most recent visit whose transition is not `reload`, falling back to the most recent of any kind; `onInstalled` re-derives `openedAt`/`transition` for already-backfilled traces.
- **Rejected:** Latest visit regardless of type (the first rule); earliest visit ever (a tab can be opened long after the first visit to its URL).
- **Why:** The first real export (22 tabs) had every transition = `reload` and every `openedAt` inside the five minutes after Chrome restored the session, because session restore writes a `reload` visit. That collapses S2/S3 to "one burst". Synthetic data could not have shown this.

## 2026-09-12 — First real fixture: `makilesh`, 12 http tabs, pipeline smoke test only
- **Decision:** Recorded as a real export but explicitly NOT a gate browser: 12 http tabs (gate wants 80+), all backfilled (no lineage, no co-activation), no digests (content scripts do not reach pre-install tabs). The TS clusterer put all 9 eligible tabs in one community with 13 excluded (chrome://, extension pages, local PDFs, Gmail, Google search).
- **Rejected:** Counting it toward the five.
- **Why:** The protocol note in PHASES.md: the gate is not restated to match what was got.

## 2026-09-12 — Chrome's "Organize tabs" is not offered on the first real browser
- **Decision:** `chrome://settings/ai` shows no Tab organizer toggle on the owner's profile (Chrome 153, Windows 11, India, en). Recorded as a protocol shortfall: a browser without the organiser can contribute to the ablation half of the gate (zero S1/S2/S8 ≥ 0.10 drop) but not to the "beats Chrome by ≥ 0.15" half. No proxy is scored as "Chrome" — the gate is not restated to match what was got.
- **Rejected:** Substituting an eTLD+1 topic grouping as the Chrome baseline (it is what `synth.chrome_like` does for synthetic data, and it is a caricature, not Chrome).
- **Why:** Chrome gates the feature by account sign-in, UI language (English US) and region. If it can be enabled it should be; if not, testers must be recruited on profiles that have it, and PHASES.md must say how many of the five had it.

## 2026-09-15 — Labels template is generated and merged by `npm run labels <name>`, not hand-written
- **Decision:** `tools/labels-template.ts` writes `fixtures/<name>.labels.json` from the export: open traces only, tab-strip order, `_<short id>` comment lines the scorer ignores, `""` = unfilled, `null` = no project (non-http tabs start there). Re-running keeps any non-`""` value verbatim, adds new traces unfilled, drops traces gone from the export and lists them with the label they had.
- **Rejected:** Hand-making the template per tester (the first one was, and it turned out to be from a different export than the tracked fixture: one trace missing, one stale); keeping labels for traces no longer in the export (the scorer's universe is the labels file, so stale ids would be scored as singletons that exist nowhere).
- **Why:** Every tester will export more than once (the backfill fix alone needs a re-export), and a labeller's work must survive that. Strip order is what the person sees next to the file.

## 2026-09-15 — AI assistants (chatgpt.com, claude.ai, gemini, perplexity) are not ambient
- **Decision:** Removed from `ambient.json`. They are clustered like any other http tab. Mail, calendar, messaging, music, search results and meetings stay excluded.
- **Rejected:** Keeping them excluded as "chat" (the earlier reading of the brief's list); down-weighting instead of excluding.
- **Why:** The first real export with lineage showed a ChatGPT tab ("AI/ML Engineer Pitch") opened from a LinkedIn tab and co-activated 7× with a careers page — it is an artefact of that project, with a project-specific title, and is exactly the kind of tab the archive must hand back. The brief's "chat" is messaging (Slack, Discord), which genuinely belongs to every project. Changed before any labels were scored on this fixture so it is a scope correction, not tuning.

## 2026-09-19 — Restore-time timestamps are not evidence: backfilled `reload`/`unknown` traces have unknown timing
- **Decision:** `timing_known(t) = !backfilled || transition ∉ {reload, unknown}`. S2 is 0 for any pair with a side of unknown timing; `segment()` leaves such traces out of the gap walk and gives each its own session (S3 = 0 with everyone); the x-ray card shows no time phrase for a group with no real timing. Python first, TS port, parity 1.0 on every fixture; one test each side.
- **Rejected:** Leaving it (every pre-install tab shares the session-restore timestamp to within seconds, so S2 ≈ 1 and S3 = 1 for all pairs among them — one blob no matter what S1/S8 say); repairing the timestamps from history (checked on the owner's profile after an extension reload: `refreshBackfilled` ran and history has no non-reload visit for any of the ten — Chrome keeps 90 days, so for a tab hoarder this is the normal case, not an edge case); a new schema field (`backfilled` + `transition` already say it exactly).
- **Why:** Decided in PHASES.md on 2026-09-15 before any score existed, as the branch to take if the reload+re-export test came back this way. It came back this way. Effect on the first real fixture, against DRAFT labels: ARI 0.345 → 0.322, and the S1+S2+S8 ablation flipped from −0.03 to **+0.09** — the pre-install tabs, no longer glued by fake timing, attach through real co-activation to tabs the draft labels put in other projects (the Buildathon notion page was switched with the AWS/First Commit tabs 6–11 times on 15 Sept; the LinkedIn jobs tab was opened *from* the WeMakeDevs page). Whether that is the clusterer being right about behaviour or the draft labels being wrong about projects is exactly the thesis question, and only the owner's own labels can answer it. Recorded as it is; nothing was tuned.

## 2026-09-19 — First Chrome baseline on file is not scored as the organiser's
- **Decision:** `fixtures/makilesh.chrome.json` (captured 2026-09-19: one group of one tab, "✅Job search automation command center", 31 ungrouped) is kept on disk and the score command reports it, but it is recorded as *not* an Organize-tabs baseline until the owner confirms how it was produced. Chrome's organiser does not make one-tab groups and the profile has no Tab organizer toggle.
- **Rejected:** Treating the +0.32 "delta vs chrome" the score prints as a gate reading.
- **Why:** A baseline of one hand-made group scores 0.0 by construction; beating it says nothing about Chrome. The gate is not restated to match what was got.

## 2026-09-19 — Phase 1 started on the owner's instruction with the Phase 0 gate UNMEASURED
- **Decision:** Branch `amnesty` off `xray_fixes` and build Phase 1. The Phase 0 gate has not passed: one real browser (28 http tabs, gate wants 80+), draft labels the owner has not confirmed, no organiser baseline, and against the draft labels the S1+S2+S8 ablation reads +0.09 (wrong direction). PHASES.md keeps the Phase 0 gate unticked; nothing here is a pass.
- **Rejected:** Refusing until five fixtures exist (raised; the owner said "let's resolve this later").
- **Why:** Owner's call after the concern was stated. Phase 1's own gate (testers press Archive & close of their own accord; tab count still lower a week later) does not depend on the clustering beating Chrome, and the sweep page will use whatever partition the clusterer gives. The X-ray gate still has to be read before any store submission.

## 2026-09-19 — Group colour always comes from the stable hash; the model's colour is ignored
- **Decision:** `colorFor()` hashes the dominant registrable domain into the eight non-grey colours. Nano is still asked for `{name, color}` under the schema the brief specifies, but only `name` is used.
- **Rejected:** Letting the model pick (it would change colour between sweeps); dropping `color` from the schema (the brief names it).
- **Why:** The brief asks for both "stable hash" and "model picks colour"; they conflict, and the brief's own reason for the hash — a project keeps its colour across sweeps, recognisability beats aesthetics — is the one that serves §6.3.

## 2026-09-19 — Never-remember sites are still grouped, but nothing about them is kept
- **Decision:** A trace on a listed site keeps only url, timing, lineage and activity (what grouping needs) — title blanked, no digest. When the tab closes the record is deleted instead of getting `closedAt`. Archive & close closes such tabs but leaves them off the card. Matching is on the host or any parent domain, normalised from whatever the person typed.
- **Rejected:** Not recording them at all (they would vanish from groups and the sweep would leave them stranded on the strip); keeping the record with `closedAt` (that is remembering).
- **Why:** §6.10 says forgetting is first-class; "never remember" has to mean nothing survives the tab, while the person still gets the one-action sweep for the group it sat in.

## 2026-09-19 — One "show on my tab strip" action for the whole sweep, not one per group
- **Decision:** Writing clusters to `chrome.tabGroups` is a single button above the groups; per group there is exactly one button, Archive & close. Saved-group refusals (§5.6) are counted and reported in the status line; the clustering and the card are unaffected.
- **Rejected:** A second button per group.
- **Why:** §6.4 — at most five decisions visible, one button per group. Grouping the strip is reversible and closes nothing, so one decision for all of it is proportionate.

## 2026-09-19 — Restore mints fresh traces; archived traces stay closed behind the card
- **Decision:** Bring back calls `chrome.tabs.create` per URL in card order and groups the new tabs; the collector records them as new tabs. The card is kept and marked `restoredAt`.
- **Rejected:** Re-binding the old traceIds to the new tabIds (two open traces per tab for a moment, racing the collector's onCreated).
- **Why:** The card is the memory; the live trace is a binding. Lineage from before the archive lives on the card, and the return path (Phase 2) reads cards, not traces.

## 2026-09-19 — BYO-key cloud naming tier not built
- **Decision:** Phase 1 ships two tiers, on-device Nano and heuristic. The optional cloud tier the brief lists is left out.
- **Rejected:** Adding it off by default.
- **Why:** It is a network call, and CLAUDE.md says do not add one without asking. Ask the owner; if wanted it is a third `NamingTier` behind the same `nameGroup()`.

## 2026-09-19 — Summarisation runs in an offscreen document with reason WORKERS
- **Decision:** The worker's alarm opens `src/offscreen/index.html`, which drains the `jobs` store with the Summarizer API (`tl;dr`, short, plain text) four at a time, writing each summary into its card as it lands, and marks every pending job `unavailable` when the API is not on this machine. The alarm is cleared when the queue is empty and re-armed by the next sweep.
- **Rejected:** Running the Summarizer inside the service worker (§5.5: 30 s idle kill, 5 min cap); an offscreen reason of DOM_PARSER.
- **Why:** The brief says alarms plus an offscreen document. WORKERS is the closest honest reason Chrome offers for "long-running on-device compute".

## 2026-09-23 — Heuristic names come from one word the titles share, in the casing the person saw
- **Decision:** `sharedTitleName()`: words of 3+ letters from tab *titles* only, minus stop words and platform names (GitHub, Notion, LinkedIn, Luma, Google…), ranked by (tabs in the group containing it) × IDF over all open titles, needing at least two tabs; one word, original casing. Fallbacks: the first word of the x-ray heading, then the dominant site.
- **Rejected:** The first version — the top three x-ray heading tokens title-cased and joined — which on the owner's browser gave "Builder Product First", "Makilesh Ideas Open", "Phinite Platform Every"; pairing a second title word, which picked up a coincidental "Center" from an unrelated PwC listing ("AWS · Center").
- **Why:** The brief says expect many users on the fallback and make it genuinely good. Titles are what the person sees on the strip, digest headings are page furniture. Same browser now reads "AWS", "Makilesh", "Phinite". `lexical.STOP` is exported for this; S7 arithmetic is unchanged (parity 1.0).

## 2026-09-23 — Sweep page shows heuristic names at once and upgrades them to on-device names in place
- **Decision:** `quickName()` (no model call) renders every group immediately; `betterName()` then asks Nano one group at a time and swaps the heading text when it answers. Colour never changes.
- **Rejected:** Awaiting every Nano prompt before rendering anything (the first version).
- **Why:** §6.3 — the first thing on screen is something the person recognises. Eight sequential prompts on a 100+ tab browser would have been several seconds of blank page.

## 2026-09-23 — The Phase 1 gate is measured from a local open-tab count and the archive cards, exported as times and numbers only
- **Decision:** The collector records `{at, open}` (http(s) tabs open) every 6 h, at install and on alarm, in `meta.openSnapshots` (capped at 60 days). The x-ray study section gains "Export study summary" → `<name>.study.json` with those snapshots and, per card, `{archivedAt, tabs, tier, restoredAt}` — no names, no URLs. `npm run phase1 <names…>` reads them: presses and press-days, brought back, median open count over the 48 h before the first press vs days 6–8 after, and "not readable until <date>" when there is not yet a day 7. It says in its header that "of their own accord" is the tester's report.
- **Rejected:** Deriving open counts from exported traces (closed traces are not exported, forgotten ones are gone, and it would mean shipping every URL for a number); asking testers to count their tabs (that is the §6.1 wall-of-awful move); showing any of this in the product.
- **Why:** Without it the Phase 1 gate could only be answered by anecdote. §6.1 forbids showing the tab count as a problem *to the person*; it does not forbid measuring whether the product works. The number exists only in a file the tester chooses to export and a CLI on the owner's machine, and the page that exports it says in plain words what is in the file.

## 2026-10-04 — A typed, searched or bookmarked tab roots a new lineage tree, whatever opener Chrome reports
- **Decision:** `lineage_parent(t)` / `lineageParent(t)` returns null when `t.transition ∈ NEW_INTENT` (typed, generated, auto_bookmark); S1's opener forest is built from it, and `segment()` now cuts on every NEW_INTENT visit instead of only those with no opener. The collector is unchanged — `openerTraceId` is still recorded raw at event time (§5.1); this is how the clusterer reads it. Python first, TS port, parity 1.0 on all six fixtures; one test each side replaces the old "typed with an opener does not cut" test.
- **Rejected:** Keeping the brief's rule (`NEW_INTENT && !openerTraceId`); dropping such tabs' children from the tree too (their links are genuine continuation of the new start).
- **Why:** Chrome reports the tab you were on as the opener of a tab opened with Ctrl+T and then typed into. Measured, not assumed: on both real exports 13 of 13 typed and 5 of 5 generated visits carried an opener, so the session cut never fired on real data and S1 chained unrelated projects together whenever a new tab was opened from another project's tab. This also retracts part of the 2026-09-19 reading: "the LinkedIn jobs tab was opened from the WeMakeDevs page" was this artifact (a typed visit), not behavioural evidence. Effect on `makilesh` against DRAFT labels: ARI 0.322 → 0.368; the S1+S2+S8 ablation +0.086 → +0.040, still the wrong direction for the gate. Found by `tools/walkthrough.ts` (Chrome for Testing reports the same opener for `newPage()`), confirmed on the owner's exports.

## 2026-10-04 — `npm run walkthrough`: the whole product on real websites, in a visible browser, at human pace
- **Decision:** `tools/walkthrough.ts` installs the build into a fresh Chrome for Testing profile and browses two interleaved projects on real sites (Python asyncio docs; a Lisbon trip on Wikivoyage/Wikipedia — both touch Wikipedia), then runs the sweep page, Show on strip, export, Archive & close, a restart, Bring back and the study export, and leaves the browser open. Ground-truth labels are known by construction and written next to the export as `fixtures/walkthrough.*`, flagged `_scripted`. About a minute of "reading" separates projects.
- **Rejected:** Driving the owner's own Chrome (Claude in Chrome was not connected, and it cannot open chrome-extension:// pages anyway); a one-second robot pace (the first run did that and every tab co-activated with every other inside S8's 60-second window, merging both projects — a harness artifact, not a finding).
- **Why:** The owner asked to try the entire thing together. A scripted browser can only check mechanics and must never count toward a gate; the `_scripted` flag and this entry say so.

## 2026-10-04 — SUPERSEDES "Restore mints fresh traces": Bring back reopens the archived traces so the collector re-binds them
- **Decision:** `bringBack()` sets `closedAt = null` on every trace on the card, then creates the tabs. The reopened traces' tabIds are dead, so they are orphans, and the collector's existing `onCreated` path (`findOrphanFor` -> `bindOrAdopt`, the same one session restore uses) binds each new tab to its own trace by url. Forgotten traces are absent and their tabs get fresh ones. `npm run check` now reports how many came back on their original trace (3 of 3).
- **Rejected:** Fresh traces (the 2026-09-19 decision); writing the new tabIds onto the old traces from the sweep page (races the collector's onCreated, two open traces per tab).
- **Why:** The walkthrough showed it: a brought-back "Travel" card returned as six brand-new tabs with no lineage, no co-activation and timing of "now", and the sweep page immediately fused them with the open Python tabs into one ten-tab group. For a person who puts things away and brings them back, losing the grouping on the way back undoes the product.

## 2026-10-05 — dist/ is the owner's live install: automated runs build elsewhere
- **Decision:** `npm run check` and `npm run walkthrough` build into `.check-build/` (`npm run build:check`) and load that; only an explicit `npm run build` writes `dist/`, and after it the owner must press Reload in chrome://extensions. Stated in CLAUDE.md so no session rebuilds `dist/` as a side effect again.
- **Rejected:** Keeping one output folder and relying on "reload after every rebuild" (the README already said so; it did not stop it, because `npm run check` builds too); `emptyOutDir: false` so stale hashed files survive (leaves a loaded extension on an unknowable mix of old and new code).
- **Why:** Read from the owner's own profile on 2026-10-05: Tab Amnesty in their Chrome recorded its last tab switch on 19 Sep 13:56 UTC — minutes after the Phase 1 build rewrote `dist/` — and its last anything on 20 Sep 06:47 UTC, while the profile's tab ids advanced by ~6,600 since. Its database has no `archive` store, so the Phase 1 build never ran there. The exact Chrome mechanism is not visible from outside, but the correlation with rebuilds of the folder it loads from is the only one in the data, and isolating the folders removes the hazard whatever the mechanism.

## 2026-10-05 — `tools/read-profile.ts`: read the owner's records from disk instead of asking for clicks
- **Decision:** Copies only `Default/IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb` from the real profile into a throwaway Chrome for Testing profile, loads `dist/` (same path → same id → same origin), reads every store from an extension page, writes `.real/<name>.raw.json` (git-ignored) and the shareable `fixtures/<name>.json`. The throwaway collector's startup re-bind marks every trace closed; those closed at or after the read are put back to open, and traces it minted itself are dropped. It reports when the real browser last recorded anything.
- **Rejected:** Driving the real Chrome through Claude in Chrome (it refuses chrome:// and chrome-extension:// pages and only sees its own tab group); an `externally_connectable` channel from web pages (opens the owner's browsing record to any page that asks); parsing the LevelDB/V8 format by hand or with a third-party reader.
- **Why:** The owner asked for the whole thing to be done and analysed without them. Chrome's own IndexedDB code reads its own files; nothing is written to the real profile; only this extension's folder is touched. Caveat recorded in the tool: the copy is opened by the current build, so its schema version says nothing about which build last ran in the real browser.

## 2026-10-05 — Shareable exports scrub email addresses; one redaction function everywhere
- **Decision:** `src/collector/redact.ts` (`redactTrace`, `scrubText`) is used by the x-ray export, `tools/read-profile.ts` and the labels-template comment lines. On top of the existing rules (host + path, query values blanked, no lead text) it replaces anything shaped like an email address in titles, descriptions and headings with `[email]`.
- **Rejected:** Dropping titles (S7 needs them); scrubbing only the owner's own address.
- **Why:** The repository is public, and the committed `makilesh` fixtures held the owner's address and a third party's (from a Gmail page heading). Gmail, calendars and shared-doc notices put addresses in titles routinely, and every tester's shareable file is meant to leave their machine. Already-committed history still contains both addresses; rewriting it needs a force-push and is the owner's decision.

## 2026-10-05 — The labels merge keeps file-level markers (`_status`, `_scripted`)
- **Decision:** `npm run labels` carries `_status` and `_scripted` through a re-merge.
- **Rejected:** Regenerating only `_comment`/`_how` (the previous behaviour).
- **Why:** A re-merge silently dropped `_status: DRAFT … NOT confirmed by the owner`, which would have let Claude-proposed labels pass for the owner's.

## 2026-10-05 — Shareable redaction also replaces ids, drops ambient and local-file content (security review)
- **Decision:** `redactTraces(traces, salt)` replaces identifier-looking runs in host and path — a digit and 4+ characters, a mixed-case slug of 12+, any run of 20+ — with stand-ins that are equal for equal values within one export (random salt per export, never written) and stay numeric when the id was numeric. Mail, chat, calendar and search tabs keep no title or digest; `file:` tabs keep nothing but "local file". Consent text on the x-ray page says all of this.
- **Rejected:** Dropping paths entirely (S6 and S7 need them); hashing whole path tokens (would change S7's token boundaries); leaving ambient tabs' text in (the clusterer excludes them; their headings are other people's subject lines).
- **Why:** A background security review of the previous commit flagged sensitive-data exposure in `redact.ts`; on inspection, "shareable" files kept download tokens (an `ilovepdf.com/download/<token>` link is in the public history), document and workspace ids, local file paths and search queries. On the owner's data the new file gives the identical partition to the previous one and no signal moves by more than 2.3e-4 (S7, where an id also appears in a title). Already-public history still contains the old files.

## 2026-10-05 — Stand-ins are random per export, not hashed (security review: weak pseudonymization)
- **Decision:** `redactTraces()` gives each distinct identifier a fresh random stand-in (`crypto.getRandomValues`; 12 random digits for numeric ids, `id` + 12 random hex otherwise), held in a table that is a local variable of one export and never written. Equal values still get equal stand-ins inside the file; nothing relates a stand-in to its value or to another export.
- **Rejected:** The previous version — FNV-1a over a random salt and the value. FNV is not a keyed PRF: the salt collapses to 32 bits of internal state, recoverable from a single known value/stand-in pair (a year in a path is enough), after which any guessed id can be checked. HMAC-SHA-256 with a per-export key was also rejected as unnecessary: nothing needs to recompute a stand-in later, so a random table is strictly stronger and simpler.
- **Why:** Background security review of 5b4f885. That commit's fixture used the weak stand-ins; it reveals nothing beyond the raw ids already in earlier public commits.

## 2026-10-05 — CORRECTION: "no `archive` store, so the Phase 1 build never ran" was not established
- **Decision:** Withdraw that claim (made in the "dist/ is the owner's live install" entry above and in PHASES). It came from searching the owner's LevelDB files for the store name; calibrating the search showed it cannot see store names at all — `traces`, which certainly exists, is not found either, because table files are compressed. What the data does establish: nothing was recorded between 20 Sep 06:47 UTC and the owner's reload at 05 Oct 09:25 UTC (14:55 IST), and no build from 23 Sep or later ran before that (it would have written open-tab snapshots; there were none). The rebuild of `dist/` remains the leading explanation for the outage; the fix stands either way.
- **Rejected:** Rewriting the earlier entry (this file is append-only).
- **Why:** A claim used to explain a two-week outage to the owner must rest on a method that works.

## 2026-10-05 — Baseline capture takes only groups made after the study page opened; the 19 Sep "baseline" was a Claude in Chrome group
- **Decision:** The x-ray page records the tab groups that exist when it opens. "Capture Chrome's grouping" saves and ungroups only groups made after that (Organize tabs), never the ones already there, and says how many it left alone. The file records `preexistingGroupsIgnored`. `npm run check` proves it: a pre-existing group survives, only the new one is captured.
- **Rejected:** Capturing and ungrouping every group (the previous behaviour); skipping groups by name pattern.
- **Why:** Claude in Chrome names its working tab groups "✅…" (its group in the owner's Chrome today is "✅Claude"). The owner's 19 Sep `makilesh.chrome.json` — one group, "✅Job search automation command center" — was such a group, captured as if it were Chrome's organiser and then ungrouped out from under it. Any tester with their own groups would have had them dissolved and scored as "Chrome". The fix ships with the next deliberate `npm run build` + reload; `dist/` was not rebuilt, because the owner had just reloaded.

## 2026-10-05 — S7 tokens are runs of letters, marks and digits in any script (was ASCII a-z0-9)
- **Decision:** A token is a maximal run of Unicode L*, M* and N* characters, at least two code points long; pure numbers in any script are dropped. Python (`unicodedata` categories) first, TS (`/[\p{L}\p{M}\p{N}]+/gu`, code-point length) second, one identical test each side; parity 1.0 on all seven fixtures. The heuristic namer's title words include marks too.
- **Rejected:** `[a-z0-9]{2,}` (the brief-era tokenizer); `\w`-based regexes (Python's and JS's differ, and neither keeps Indic vowel signs inside words); keeping Python's `isdigit()` next to JS's ASCII `\d` (they disagree on Devanagari digits, which would have broken parity the first time a Hindi page appeared).
- **Why:** User-compatibility review: a page titled in Hindi, Tamil, Kannada, Japanese... produced no S7 tokens at all, and an accented word split in two ("Belém" → "bel"). For an Indian user base that silently disables the content signal on part of the browser. On the existing English-dominated fixtures the scores are unchanged (makilesh 0.371, walkthrough 0.682).

## 2026-10-05 — User-compatibility review: protections added to the sweep
- **Decision:** (1) A tab holding text the person typed and has not sent is neither archived nor closed by Archive & close; the content script records only a yes/no (`TabTrace.typing`, cleared on navigation and on submit), and the message names the tab left open. (2) "Show these groups on my tab strip" leaves tabs that are already in a group where they are, and offers Undo, which ungroups exactly the groups it made. (3) The sweep page checks that its own tab was recorded within ~4 s; if not, it says plainly that Tab Amnesty isn't keeping up and that switching it off and on fixes it. (4) The "put away" message is a `role=status` live region; focus moves to the next actionable button after Archive & close; a failure to read tabs shows a calm sentence instead of a blank page; the lede says everything is kept on this computer.
- **Rejected:** Relying on Chrome's "Leave site?" prompt (`chrome.tabs.remove` closes without one); a per-tab checkbox to exclude tabs (§6.4); a modal warning before every archive; reading form contents (privacy: the boolean is enough).
- **Why:** Reviewed from a normal user's side. Closing a half-filled form loses the text and Bring back reopens it empty — the one way "close it, you'll still have it" could be false. Pulling tabs out of someone's own (or Claude in Chrome's) groups undid their organising with no way back. And the owner's two-week silent outage showed that a stopped recorder must be visible. All three are proven in `npm run check` (own group kept + Undo; typed tab left open, card holds the rest; health note hidden while recording).

## 2026-10-05 — Tester install without Node: `npm run package`; Chrome 116+ declared
- **Decision:** `npm run package` builds into `release/` (never `dist/`) and writes `release/tab-amnesty-<version>.zip` — one top-level folder, standard forward-slash paths (Windows' own bsdtar; GNU tar and Compress-Archive both produce files other systems mis-read). README gives four tester steps. `manifest.json` declares `minimum_chrome_version: "116"` (`chrome.runtime.getContexts`), so older browsers refuse the install with Chrome's own message instead of failing later.
- **Rejected:** Asking testers to clone and build (needs Node); publishing to the Chrome Web Store (the right path for general users, but publishing is the owner's decision — listing, privacy disclosure, developer account).
- **Why:** The user-compatibility review: installation was the first and highest barrier. Verified: the zip opens with .NET's zip reader and Windows' extractor, and the extracted manifest is intact.

## 2026-10-05 — Large browsers: vocabulary computed once per page; the study page refreshes only when watched
- **Decision:** `describe()` and the title namer cache document frequency per corpus array (WeakMap; still pure). The x-ray page re-groups when it becomes visible and at most once a minute while visible, instead of every 5 s.
- **Rejected:** Moving clustering to a worker (not needed at these sizes).
- **Why:** Timed on real tab shapes: naming at 1,000 tabs went 447 ms → 25 ms; grouping is 15 / 53 / 186 / 683 ms at 100 / 250 / 500 / 1,000 tabs. The 5-second refresh kept about a quarter of a CPU core busy on a 1,000-tab browser for as long as the study tab was open.
## 2026-09-24 — S7 tokens are Unicode words, CJK/Thai bigrams, percent-decoded path tokens
- **Decision:** `tokens()` (lexical.py first, lexical.ts to match) NFKC-normalises and lowercases, splits on maximal runs of Unicode letters/marks/numbers (≥ 2 code points), turns runs in scripts written without spaces (explicit code-point table: Thai, Lao, Myanmar, Khmer, kana, CJK) into overlapping character bigrams, drops all-number tokens by Unicode category, and percent-decodes path tokens with `decodeURIComponent` semantics (malformed escape or invalid UTF-8 → token kept as-is; Python mirrors the throw). `synthetic_multilingual` (Hindi / Tamil / Japanese / German projects on one host and one encoded path) joins the positive controls, so `npm run parity` now covers non-ASCII text (0/780 mismatches, partition ARI 1.0).
- **Rejected:** keeping `[a-z0-9]{2,}`; Python `\w` (misses combining marks, so Tamil and Devanagari words fall apart); the `regex` package or a script property (no identical table in both languages); dictionary word segmentation for CJK.
- **Why:** The old pattern dropped every Hindi, Tamil, Japanese and Chinese title outright and cut "Müller" to "ller", and a percent-encoded path like `/wiki/%E6%9D%B1…` turned into byte tokens (`e6`, `9d`) shared by every non-ASCII URL on a site. On the multilingual control, within/across-project S7 went from 0.84/0.70 (noise) to 0.39/0.11. ASCII input tokenises exactly as before, so every existing fixture's signals are unchanged. Caveat: Python 3.11 ships Unicode 14 and Node 22 ships 15.1, so a character assigned after Unicode 14 (e.g. CJK extension H/I) could tokenise differently; parity would flag it.

## 2026-09-24 — `npm run refit`: logistic regression on labelled pairs, leave-one-browser-out, never writes betas.json
- **Decision:** `analysis/tabamnesty/refit.py` fits sklearn `LogisticRegression` (L2, C = 1, unweighted classes so probabilities stay calibrated) on pairs from the TS `--edges` dump; a pair is positive when both tabs share a non-null hand label, and pairs with an unlabelled tab are skipped. Betas are the coefficients scaled by `W_MIN / -intercept`, so affinity ≥ W_MIN exactly where P(same project) ≥ 0.5 and W_MIN itself stays put. The headline table is leave-one-browser-out (held-out log loss and Brier against a base-rate predictor, and TS-partition ARI with held-out betas next to the shipped ones). Output goes to git-ignored `fixtures/refit.betas.json`. `src/cluster/betas.json` is only changed by the user, with its own entry here.
- **Rejected:** fitting on all five gate browsers and scoring on them (tuned to pass); writing `betas.json` directly; class re-weighting; fine-tuning a Laya-style encoder as the pairwise judge (see docs/research-jev-laya.md).
- **Why:** The brief anticipates refitting by logistic regression. Two measurements on the synthetic controls make it the next lever. First, an oracle S7 that knows the true project lifts the multilingual control only from ARI 0.20 to 0.27 at the brief's weight 1.0, and to 1.0 at weight 3.0: on interleaved work the weights, not the signal quality, are the bottleneck. Second, refit held out across the five synthetic fixtures loses 0.15 ARI on average, because each control depends on a different signal. Transfer between browsers has to be measured, not assumed.

## 2026-09-24 — Jev and Laya are not integrated; nothing in the extension changes
- **Decision:** No Jev (TypeSafe's hosted typed-decision API) or Laya (its open 322–421M-parameter counterpart) in any phase for now. Their useful idea (one fixed question answered with a calibrated probability from a proper scoring rule) is taken as `npm run refit` over our own nine signals instead. The full analysis is in docs/research-jev-laya.md.
- **Rejected:** Jev (network call carrying tab titles off the machine: §5 policy, and the Phase 1 cloud tier is for naming, which Jev cannot do because it never generates text); Laya in the extension (Phase 0 bans models, ONNX and WASM; ~290–440 MB of weights plus runtime memory on machines whose tabs are already being discarded for memory; zero-shot it sits below the majority-class baseline on typed decisions; it is strongest at topic classification, the axis the thesis says is not a project).
- **Why:** An oracle "same project" judge, better than any real model could be, adds +0.07 ARI at the current weight on the multilingual control. Revisit only after the gate, if refit has plateaued and real labelled data shows a content signal is what is missing.

## 2026-09-24 — SUPERSEDES "Jev and Laya are not integrated": Laya is a measured candidate for three background uses
- **Decision:** Following the user's request to judge Jev/Laya by user impact rather than prior rules, docs/research-jev-laya.md v2 plans Laya (on-device) as a background second opinion for (1) suggesting that two groups are one resumed project, (2) event labels on machines without Gemini Nano, and (3) a sensitive-tab guard for resurfacing. Stages have gates. Stage 1 is `npm run laya-probe` (opt-in `analysis[laya]` extra, research only), which measures hard-pair AUC against our free signals. Jev is only ever an opt-in cloud tier or a research teacher on consented exports. Phase 0 and the extension stay model-free; nothing ships before the stage 3 in-browser check and the user's OK on the weights download and CSP changes.
- **Rejected:** a tenth signal over all pairs (9,316 calls, about 82 min in-browser at 137 tabs, +0.02–0.05 ARI even at AUC 0.95–0.98); per-tab moves (hurt below AUC 0.98); grouping by the model alone (ARI 0.48 at AUC 0.9, still under behaviour at 0.98); Jev as a default (tab titles leave the machine).
- **Why:** `npm run judge-sim` on 12 generated browsers with leave-one-browser-out weights. 60–71% of wrongly grouped pairs are one project split across sittings. The free signals score AUC 0.91–0.93 overall but only 0.58 (install day) / 0.67 (warm) on the hard pairs, so that is where a content model can pay. Cheap group-level designs (~60–430 calls) keep most of the value. Real gains depend on Laya's hard-pair AUC, which the probe measures once huggingface.co is reachable and real labelled fixtures exist.

## 2026-10-05 — Research branch merged; its tokenizer replaces today's, redaction decodes before looking for ids
- **Decision:** `claude/jev-laya-integration-research-7wtckx` (24 Sep: refit, judge-sim, laya-probe, Unicode S7 with NFKC, character bigrams for unsegmented scripts, percent-decoded path tokens, multilingual positive control) is merged into `amnesty`. Its tokenizer is kept and the one written earlier today is dropped; the shared Python/TS test now pins its output. Shareable redaction decodes path segments before looking for ids and re-encodes after, so "/my%20notes" keeps its words and the invariance test (same partition before and after redaction) covers encoded paths. The branch also untracks the Windows cache files committed by accident on 11 Sep.
- **Rejected:** Keeping today's tokenizer (a strict subset of the branch's: no bigrams for CJK/Thai, so a Japanese title was one long token; no NFKC; no %-decoding).
- **Why:** Same intent, better implementation, already tested on both sides. Parity 1.0 on all eight fixtures after the merge, including `synthetic_multilingual`.

## 2026-10-05 — Laya vs Gemini Nano measured: Nano for names, neither for grouping, Laya parked
- **Decision:** Gemini Nano is the naming model (the extension's existing on-device tier). Grouping stays behavioural: neither model's "same project?" judgement is used. Laya stays research-only; revisit it only through the fine-tuning track with consented labelled tester data. Tooling kept: `npm run compare` (shared items, Laya runner, report) and `npm run nano` (Gemini Nano in its own Chrome profile; puppeteer's default flags disable the component updates the model arrives through). All downloads live in `D:\Installations\tab-amnesty-models`.
- **Rejected:** Integrating Laya now (zero-shot AUC 0.54–0.65 overall, 0.27–0.47 on hard pairs, both checkpoints; no gain when combined with the free signals); using Nano as a grouping signal (hard-pair AUC 0.44–1.00, helps one simulated browser, nothing on the owner's draft-labelled one); the heuristic as the long-term namer.
- **Why:** Same items to both judges on five browsers (owner's draft-labelled and current browser, the walkthrough, two simulated). Full tables in `docs/research-jev-laya.md` §9. Nano named the owner's groups "AWS Buildathon 2026", "GPU Setup & Billing", "Job Applications" where the heuristic said "AWS", "Billing", "Job" and Laya said "planning or managing work", "building or fixing software". Open: Nano only runs where Chrome already has the model; offering the download is the owner's decision.
