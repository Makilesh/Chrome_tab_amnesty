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
