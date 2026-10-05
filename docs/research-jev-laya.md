# Jev / Laya: impact study and plan

*v2, 2026-09-24. Supersedes v1 of this note (in git history), which ruled both models out from
the project rules before measuring anything. This version starts from what users would get, and
measures it.*

## Bottom line

- **A content model is worth adding as a background second opinion, not as the grouper.** It
  pays on three surfaces behaviour cannot reach:
  1. Joining up a project that was resumed on another day.
  2. Naming groups by what the person was doing, on machines without Gemini Nano.
  3. Spotting sensitive tabs (health, legal, money, job search) so resurfacing never shows them.

  It does not pay as a replacement for behavioural grouping, as a tenth signal over every pair of
  tabs, or for silently moving tabs between groups.
- **Laya is the candidate; Jev only as an opt-in.** Laya runs on the device. Jev would send every
  tab title to a third party, which is the one thing this product promises never to do.
- **The size is acceptable only off the critical path.** It means 524 MB downloaded on demand and
  about a minute and a half of background work on install day. It must never run on the sweep.
- **One number decides it, and one command measures it.** The number is Laya's accuracy on the
  *hard* pairs: same project on a different day, versus a different project on the same site. Our
  free signals score AUC 0.58 there on install day and 0.67 after days of use. `npm run
  laya-probe <name>` measures Laya's score once huggingface.co is reachable and real labelled
  browsers exist.

## 1. The multilingual fix from earlier, in one paragraph

That was a bug in *our* keyword signal (S7), not a Laya feature. It only recognised `a–z` and
`0–9`, so "Überweisung Gebühren" became "berweisung geb hren" and a Japanese title became nothing.
It also affects English sites: a URL path like `/my%20notes` became the tokens `my` and `20notes`,
and encoded characters became junk tokens shared across a whole site. You are right that most
tabs are English or European; the fix matters there too (accents, encoded URLs). And you are right
that language is not a blocker for Laya: it has a 100+ language checkpoint and a router that picks
by script. The plan below starts English-only and measures the non-English share first.

## 2. Where users would feel it

137 tabs is the brief's reference browser, with about 8 groups. Latency uses Laya's in-browser
int8 build: 122 ms + 4.5 ms per token on an M-series Mac with 8 threads (§4).

| # | Use | What the user sees | Calls, 137 tabs | Laya time | Quality needed | If it is wrong | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Join a resumed project** | "This continues Tuesday's pricing work" as a suggestion on the card; one tap keeps them together | ~5–15 candidate group pairs | 12–36 s, background | High precision on hard pairs; the user confirms | One ignored suggestion | **Measure (stage 1)** |
| 2 | **Event labels without Nano** | "The afternoon you were planning a trip" instead of "lisbon · hotel · booking" (§6.5) | ~8 groups × one 10-way choice | ~11 s per re-cluster | Intent-classification level (Laya scores 0.78 on MASSIVE, a 20-intent English benchmark) | A mislabelled card; the user corrects it (§6.7) | **Measure (stage 1)** |
| 3 | **Sensitive-tab guard** | The new-tab page never volunteers a medical or legal tab; "forget" is offered first (§6.10) | 1 question per tab, once, when captured | ~70 s once at install, then ~0.5 s per new tab | High recall | A miss is today's behaviour; a false alarm means one tab is not resurfaced | **Measure (stage 1)** |
| 4 | "Looks finished" ordering | The first project offered for archive is the one with "order confirmed" or "application sent" | ~8 | ~11 s | Moderate; ordering only | A different card goes first | Phase 1–2 |
| 5 | Tool detection beyond `ambient.json` | Internal dashboards stop gluing projects together | 1 per tab, once | as #3 | Needs real misses first | — | After real fixtures |
| 6 | Tenth signal over all pairs | — | 9,316 | ~82 min | ≥ 0.95 AUC for +0.02–0.05 ARI | — | No |
| 7 | Move or eject tabs per tab | Tabs silently change group | 137 | ~70 s | Hurts below AUC 0.98 | Trust damage | No |
| 8 | Group by the model alone (Chrome's approach) | — | 9,316 | ~82 min | ARI 0.48 at AUC 0.9; still under behaviour at 0.98 | — | No |

Rows 1–3 share a pattern. Each question is small, answered once in the background, and stored
alongside the tab's other records, so the sweep still reads stored records and stays instant.
Each one either gives the user something they otherwise do not get at all (2, 3), or is a
suggestion the user confirms (1), so a wrong answer costs a tap and never a lost tab.

## 3. Measurements

Reproduce with `npm run judge-sim` (and `-- --rho 0` / `-- --resumed 0.2`).
`analysis/tabamnesty/judge_sim.py` generates realistic browsers:

- 9 projects of 3–20 tabs each; half of them are resumed on another day.
- Sittings that start close together interleave two projects.
- Topic twins: two trips, two backend incidents, on the same sites with shared vocabulary.
- 12% one-off tabs.
- Titles carry the project's words only some of the time.

Every browser is scored twice. **Warm** is after days of collection: opener lineage, switching
history and page digests. **Cold** is install day: no lineage, no switching history, titles only,
and 30% of open times replaced by a later revisit, which is what history backfill really gives.
A content judge is then **simulated** at a chosen pairwise AUC. Half of its error is systematic
per pair of projects, the way a topic model confuses two trips everywhere at once. The judge is
plugged into five designs. Every weight is a leave-one-browser-out refit over 12 browsers, so a
gain belongs to the judge, not to the refit.

**Where the clusterer is wrong** (share of wrongly grouped pairs):

| | split: same project, different sitting | merged: one-off absorbed | merged: topic twins | other |
|---|---|---|---|---|
| warm | **71%** | 10% | 8% | 11% |
| cold | **60%** | 16% | 10% | 14% |

**How well the free signals already answer "same project?"** (pairwise AUC):

| | all pairs | **hard pairs** (same project/different sitting vs different project/same site) |
|---|---|---|
| warm | 0.93 | **0.67** |
| cold | 0.91 | **0.58** |

**What a judge of a given quality adds** (ARI, mean of 12 browsers). Behaviour alone scores 0.72
cold and 0.78 warm with refit weights, 0.69 and 0.72 with the shipped ones. Adjacent rows differ
by up to ±0.03 from sampling noise.

| Judge AUC | tenth signal, all pairs | tenth signal, top-8 partners | merge groups (confident only) | move tabs | model alone |
|---|---|---|---|---|---|
| 0.80 | +0.02 cold / −0.00 warm | +0.02 / −0.00 | −0.02 / +0.01 | −0.10 / −0.11 | 0.22 |
| 0.90 | +0.01 / +0.02 | +0.02 / +0.02 | +0.01 / −0.00 | −0.04 / −0.07 | 0.48 |
| 0.95 | +0.05 / +0.02 | +0.03 / −0.01 | +0.02 / +0.06 | −0.02 / −0.04 | 0.63 |
| 0.98 | +0.05 / +0.03 | +0.05 / +0.05 | +0.06 / +0.04 | +0.01 / −0.00 | 0.70 |
| 1.00 | +0.26 / +0.19 | +0.11 / +0.07 | +0.08 / +0.13 | +0.27 / +0.21 | 1.00 |
| calls, ~90 tabs | ~4,050 | ~430 | ~60–75 | ~90 | ~4,050 |

What this says:

1. **The upside is concentrated.** Most mistakes are one project split across sittings, and
   install day is where behaviour is weakest (hard-pair AUC 0.58). That is where a content model
   earns its keep, and it is also the user's first impression (§6.3).
2. **Quality is everything.** At judge AUC ≤ 0.8 every grouping design is flat or worse. At
   0.95–0.98 it adds +0.02 to +0.06 ARI. A perfect judge adds +0.08 to +0.27.
3. **Cheap designs keep most of the value.** Merging groups (~60–75 calls) or top-8 partners
   (~430) gets close to all pairs (~4,050) at realistic quality.
4. **Chained merges and per-tab moves are traps.** Without a confidence gate, merging chains the
   browser into one blob (ARI 0.77 → 0.22 at AUC 0.9 in the first run). Moving tabs costs up to
   −0.19.
5. **The thesis holds in the simulation.** Grouping by the model alone stays below behaviour
   even at AUC 0.98.
6. **The same conclusions hold** with independent judge errors (`--rho 0`) and with fewer resumed
   projects (`--resumed 0.2`).

Caveats. The generator is ours, so real browsers decide. The simulated judge errs independently
of our keyword signal; a real content model errs where keyword similarity errs (twins), so real
gains are likely at or below these. What is robust is the *shape*: which errors exist, which
designs survive, and where the break-even sits.

## 4. Cost and size, for this user

Measured by the `nvkudva/laya-web` port (ORT-web 1.30, WebAssembly):

| | |
|---|---|
| Weights, int8 | **524 MB** (1,688 MB fp32), 100% argmax agreement, max Δp 0.016 |
| Latency, one question | 333 ms at 43 tokens, 974 ms at 195, 2,437 ms at 512 (M-series, 8 threads) |
| Threading | Threaded wasm runs only on a page's main thread; a single-threaded worker is ~6× slower (3 questions: 836 ms vs 5,056 ms) |
| WebGPU | Needs 4-bit, which drops agreement to 84.6%; not usable for calibrated answers |
| Memory while running | Not published; at least the 524 MB of weights. Measure in stage 3 |

For a 137-tab browser, rows 1–3 of §2 cost **about 1.7 minutes of background work on install
day** (M-series), then about 1 s per new tab and about 30 s per re-cluster. The offscreen document
that §5.5 already requires is the right host: blocking its main thread blocks nothing the user
sees. Typical Windows laptops are unmeasured; assume 1.5–3× slower until stage 3 says otherwise.

**Size: a plus against the alternatives, a minus against our users' memory.**
- *Plus:* Gemini Nano needs 22 GB free disk and 16 GB RAM or more than 4 GB VRAM. Laya runs on
  any CPU, so it reaches exactly the users the brief expects to fall back to heuristics.
- *Minus:* these users' browsers are already discarding tabs to save memory (§5.4). So the model
  must be downloaded on demand, loaded for a batch, then unloaded. It must never be resident and
  never on the sweep path. Bundling it would make the extension ~4,000× larger (~110 KB today).

**Engineering it needs, all to verify in stage 3:**
- The offscreen document, which §5.5 already requires.
- Cross-origin isolation for threaded wasm (manifest COOP/COEP keys).
- `wasm-unsafe-eval` in the extension CSP.
- Storage for 524 MB (Cache API with `unlimitedStorage`).
- A one-time weights download. That is a network request with no user data in it, and it still
  needs your OK under the §5 policy.

## 5. Jev vs Laya

| | Jev (TypeSafe) | Laya (ConvAI) |
|---|---|---|
| Where it runs | TypeSafe's servers; every title and URL leaves the machine | On the device |
| Zero-shot quality (typed-decisions benchmark) | 0.727 | 0.362, below the 0.461 majority baseline; 0.766 fine-tuned |
| Context per question | ~32k tokens: a whole group fits | 512 (~320 for the state): a pair, or a group's titles |
| Latency | ~100 ms claimed, 236–276 ms measured by third parties | 0.3–2.4 s in-browser (§4) |
| Cost | $0.042 per 1M input tokens: ~$0.001 per install-day pass | $0; 524 MB of disk and memory while running |
| Availability | Early access, launched 15 Sep 2026 | Apache 2.0, public weights |
| Fine-tuning | No | Yes: full RLCD notebook (2×T4, 4–5 h), or a small head on the frozen encoder from labelled rows |

**Laya is the default candidate.** Privacy is the product's promise and its store-approval
strategy, and Laya keeps it. Jev has two legitimate roles:

- An **opt-in** cloud tier for users who choose it. The brief already allows a BYO-key cloud tier
  that is never on by default.
- A **research teacher** that labels pairs on *consented study exports*, to fine-tune Laya if its
  zero-shot score falls short.

## 6. Languages

Start with the English checkpoint for Latin-script tabs. Skip the model on tabs in other scripts;
they keep the behavioural grouping, which is language-blind. Measure the non-English share on the
real fixtures. If it matters, add Laya's multilingual checkpoint (322M parameters, 100+ languages,
a second download) behind the same script check Laya's router uses. European languages in Latin
script go to whichever checkpoint scores better on them in stage 1.

## 7. The plan

Each stage has a gate. Write the numbers down before running it.

| Stage | What | Needs | Gate |
|---|---|---|---|
| **0 — free fixes first** (now) | `npm run refit` (done). Next: **URL project keys** as a signal (GitHub owner/repo, Figma file, Google Doc id, Jira project key, Notion page). These target the 60–71% "split across sittings" class at zero cost | Nothing | Held-out ARI up on the real fixtures |
| **1 — measure Laya offline** | `npm run laya-probe <name>` on each labelled browser: hard-pair AUC next to the free signals, combined AUC, event labels per group, ms per question | huggingface.co reachable; the real labelled fixtures | Laya's hard-pair AUC beats the free signals' by ≥ 0.15, and combined beats free by ≥ 0.10, on ≥ 3 of 5 browsers; owners judge ≥ 70% of event labels right |
| **2 — offline integration** | Feed Laya's real answers into the merge and top-8 designs; leave-one-browser-out ARI | Stage 1 passed | ≥ +0.05 ARI on install day without losing it warm |
| **3 — in-browser feasibility** | Offscreen document + ORT-web threaded wasm + the laya-web int8 port, on three real laptops (8 GB Windows, 16 GB Windows, M-series) with Memory Saver on | Stage 2 passed; your OK for the CSP and download | Install-day backlog ≤ 3 min; peak memory measured and accepted; no UI jank |
| **4 — ship as optional** | Download on demand; background only; heuristics stay the fallback | Phase 1 gate passed | Phase 1–2 gates, with and without the model |
| *Fine-tuning track* | If stage 1 falls short: a head on the frozen encoder from consented study pairs, or the RLCD notebook | Consented study exports; optionally Jev as teacher | Stage 1's gate, held out |

## 8. Decisions that are yours

1. Laya enters research tooling now (`laya-probe` is opt-in, analysis-only) and the extension
   only after stage 3. Phase 0 stays model-free.
2. Allow `huggingface.co` in this cloud environment so stage 1 can run here (environment settings
   → Network access), or run `npm run laya-probe` locally.
3. Accept a one-time 524 MB weights download (no user data) and the CSP/isolation changes, or not.
4. Offer Jev as an opt-in cloud tier, or keep everything on-device.

## Sources

- Laya README and source v0.3.20 (PyPI `laya`): checkpoints, benchmarks, limits, answer format.
  https://pypi.org/project/laya/ · https://huggingface.co/convaiinnovations/laya
- In-browser measurements: https://github.com/nvkudva/laya-web (README and PLAN.md: 524 MB int8,
  latency by length, threading, WebGPU)
- Jev: https://typesafe.ai/blog/introducing-system-one-models-and-jev ·
  https://flaviocopes.com/jev/ (limits, pricing, rate limits) ·
  https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/
- Comparisons: https://www.orcarouter.ai/blog/jev-vs-laya ·
  https://flowtivity.ai/blog/laya-open-source-jev-alternative/
- Internal: `npm run judge-sim` (numbers in §3), `npm run laya-probe` (stage 1),
  `npm run refit`.
