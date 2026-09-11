# Tab Amnesty — always-loaded context

Re-read this at the start of every session. Full brief: `docs/PROJECT.md`. Phase checklist and
gates: `docs/PHASES.md`. Judgement calls: `docs/DECISIONS.md` (append a dated three-line entry —
decision, alternative rejected, why — every time you decide something the brief did not specify).
If the repo docs and the original brief disagree, the repo docs win.

## Current phase

**Phase 0 — The X-ray.** Question: does clustering by behavioural signals (opener lineage, timing,
co-activation) beat Chrome's built-in "Organize tabs" at recovering someone's real projects?
Gate: ARI beats Chrome by ≥ 0.15 absolute on 4 of 5 real 80+ tab browsers, AND zeroing S1/S2/S8
drops ARI by ≥ 0.10. Do not start Phase 1 until the user confirms the gate passed.

Phase 0 anti-scope (building any of these is a failure, not initiative): `chrome.tabGroups` calls,
closing or archiving, any AI/LLM call, embeddings / transformers.js / ONNX / WASM, settings screen,
onboarding, sync, accounts, any network request whatsoever.

## Thesis

Tab Amnesty is a browser memory, not a tab manager. People keep 137 tabs not because they are
disorganised but because closing feels like deleting (the "blackhole effect", Chang et al. CHI 2021).
So: record what each tab was about passively, group open tabs by the *project* they belong to, let
the person archive-and-close a whole project in one action with everything kept, searchable and
restorable. Never delete anything. Pitch: **close it, you'll still have it.** The summary is the
mechanism that makes closing survivable; the return path (search, restore, resurfacing) is what
keeps the archive from becoming a DOOM box (Didn't Organize, Only Moved). Core claim to prove:
**a project is not a topic** — it is a burst of tabs opened from one another, in one sitting, that
the person switches between — and every part of that is observable from Chrome's APIs without
reading page text. Load-bearing architecture decision: **collect passively, act instantly** — a
content script writes a digest on load; the one-click sweep reads local records, never live tabs.

## Platform non-negotiables (§5) — ask before deviating from any

1. **`tab.openerTabId` evaporates.** Only exists while the opener is alive in the same window; not
   persisted across restart. Capture it in `chrome.tabs.onCreated` and store `openerTraceId`.
   Reading it at sweep time yields nothing.
2. **`tab.lastAccessed` is undefined on discarded tabs** — exactly the stale tabs that matter.
   Maintain our own `lastActiveAt` from `chrome.tabs.onActivated`.
3. **`tab.id` is not an identity.** Reassigned across restarts. Mint a UUID `traceId` on creation;
   key every record on traceId, never tabId. Re-bind on startup by (url, windowId).
4. **Memory Saver discards background tabs.** No event fires; no DOM to inject into. **Never reload
   a tab in order to read it.** Work from stored records only.
5. **MV3 service workers die at 30 s idle, 5 min max per request.** State goes to IndexedDB
   immediately; nothing of consequence lives in a global. Long work is a persisted queue driven by
   `chrome.alarms` plus an offscreen document.
6. **`chrome.tabGroups.update()` throws "Saved groups are not editable"** on synced groups, and
   tabs cannot be moved out of them. Catch it, keep the clustering, tell the user the group is
   locked. Colour enum is fixed: `grey, blue, red, yellow, green, pink, purple, cyan, orange`.

Policy: Chrome Web Store privacy rules (effective 1 Aug 2026) — data must be strictly necessary to
one disclosed purpose. **On-device processing, nothing leaving the machine**, is both the design and
the store-approval strategy. Do not add a network call without asking.

## Human design rules (§6) — hard requirements, all phases

Target users mostly have ADHD; every failed past cleanup is a brick in the "wall of awful".

1. **Never show the tab count as a problem.** No "137 tabs", no GB figure, no red badge, no streak,
   no "you haven't tidied in 12 days". *Broken if any such number appears anywhere.*
2. **Never use the words** delete, clean up, declutter, tidy, or messy in the UI.
3. **Show value before asking for a decision.** First thing on screen is something the person
   recognises and made, not a diagnosis. *Broken if the first screen asks the user to choose.*
4. **At most five decisions visible at once.** One button per group, never per tab.
   *Broken if any per-tab checklist exists.*
5. **Label by event, not date.** "The afternoon you were fixing the deploy" beats "23 August".
   Session segmentation supplies these boundaries; date is secondary metadata, never the label.
6. **Never characterise the user's browsing.** No "you spent 3 hours on Reddit". Neutral or nothing.
7. **The user never names anything.** The model proposes; the user only corrects.
   *Broken if an empty "name this group" field exists.*
8. **Undo survives a restart** and stays reachable 24 hours.
9. **Nothing closes without an explicit per-group action.** No auto-close, no schedule, no "smart".
10. **Forgetting is first-class.** Visible *forget this* on every record, per-domain never-remember
    list, incognito never touched.
11. **The archive volunteers.** It hands things back unprompted or it is a doom box.

Follow W3C COGA where it applies: reversible actions, short critical paths, no reliance on memory,
clear literal language.

## Stack and layout

TypeScript · Vite + `@crxjs/vite-plugin` · `idb` · `graphology` (graph structure; Louvain is our own
deterministic port in `src/cluster/louvain.ts`) · Vitest · plain DOM (no UI framework unless a page
genuinely needs one).

```
src/collector/   service worker + content script. chrome.* lives here.
src/cluster/     pure functions. ZERO chrome.* imports. fully unit-tested.
src/archive/     phase 1+. storage, undo, forget.
src/ui/          xray page (p0), sweep page (p1), newtab (p2)
src/mcp/         phase 3
tools/           TS cluster CLI (partition JSON, beta overrides) + thin npm wrappers
analysis/        Python research bench (own pyproject): a mirror of the clusterer where signals are
                 changed first, plus score/ablate/report/parity via sklearn.
fixtures/        exported traces, hand labels, chrome baselines
docs/            PROJECT.md, PHASES.md, DECISIONS.md
```

The `cluster/` purity rule is absolute — it is what makes the thesis testable in Node. The
clusterer exists twice on purpose: signals change in Python first, TS follows, and `npm run parity`
fails on any drift (signals to 1e-9, partitions at ARI ≥ 0.98 — observed 1.0). **The gate is
measured on the TS partition**: `npm run score|ablate|report` run `tools/cluster-cli.ts` and print
the parity result in the header; `--python` is for experiments only. The extension must build and
run with zero Python installed. Ungrouped convention for scoring: each ungrouped / loose-end tab is
its own singleton cluster, applied identically to both partitions.

## Working rules (§9)

- Ask before deviating from §5 or §6. Checkpoint at each phase gate; never roll into the next.
- Log judgement calls in `docs/DECISIONS.md`. Commit per meaningful step. Update `docs/PHASES.md`
  as deliverables complete.
- When a measurement comes out badly, say so plainly. A harness tuned to pass is worse than none.
- Prefer deleting scope to adding it.
