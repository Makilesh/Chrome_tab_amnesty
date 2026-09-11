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
