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
