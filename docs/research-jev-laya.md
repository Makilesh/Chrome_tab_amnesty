# Jev and Laya for Tab Amnesty — research note

*2026-09-24. Question asked: how could Jev / Laya help here, how would they be used, is their size
a plus or a minus for our users, and how good could they be. Decision logged in DECISIONS.md.*

## Verdict

**Take the idea, not the weights.** Jev and Laya answer one fixed question with a calibrated
probability. That is exactly the shape of our affinity function, which asks "are these two tabs
the same project?" and answers from nine behavioural signals. The measurements below say the
bottleneck today is the *weights* on those signals, not the quality of any one signal. So the
useful move is `npm run refit`: a ten-number logistic regression trained on labelled pairs and
judged leave-one-browser-out. A 322–421M-parameter model is not the useful move.

Neither model goes into the extension now:

- **Jev** is a hosted API. Every call would send tab titles and page digests to TypeSafe. That
  breaks the on-device rule (CLAUDE.md §5 policy), and it cannot fill the one slot where the brief
  allows an opt-in cloud tier, because that slot is for *naming* and Jev never generates text.
- **Laya** could run on-device, but Phase 0 bans models, ONNX and WASM. After Phase 0 its size
  lands on the one resource our users do not have spare, memory. Zero-shot, it scores below the
  majority-class baseline on typed decisions. Its strength is topic classification, which the
  thesis says is not what a project is.

The research did find a real bug of the kind Laya is built to avoid. Our lexical signal (S7) threw
away every Hindi, Tamil, Japanese and Chinese title, and cut "Müller" to "ller". That is fixed on
both sides, with a new parity fixture.

## 1. What they are

Both are "System One" decision models. The input is a *state* (text or JSON) plus typed questions:
`choice` (pick an option), `score` (a position on a rubric) or `noul` (P(true)). One forward pass
returns a probability distribution per question. There is no text generation, so nothing needs
parsing and nothing can be hallucinated, but nothing can be *written* either: no names, no
summaries.

| | Jev (TypeSafe) | Laya (ConvAI Innovations) |
|---|---|---|
| Access | Hosted API only, early access (`POST /v1/systemone`) | Apache 2.0 weights, `pip install laya`; community ONNX builds for the browser |
| Size | Undisclosed | `laya` 421M (ModernBERT-large + 2-layer head); `laya-multilingual` 322M (mmBERT-base) |
| Context | ~32k tokens (state + longest question) | 512 tokens on `laya`, ~320 of them left for the state; 1,024 on multilingual |
| Latency | ~100 ms claimed, 236–276 ms p50 measured by third parties | 33–40 ms on a T4 GPU; 193–464 ms on CPU (Python); ~340 ms per question in-browser (WASM), ~2.4 s at 512 tokens |
| Price | $0.042 per 1M input tokens, output free | $0 self-hosted |
| Typed-decisions benchmark | 0.727 | 0.362 zero-shot (majority class 0.461, random 0.318); 0.766 after fine-tuning on that benchmark |
| Where it is strong | High-cardinality choices (up to 255 options) | Topic and NLI tasks (AG News 0.947, XNLI-en 0.860); calibrated *after* temperature fitting |
| Known weak spots | Closed; per Laya's benchmarks, zero probability on the true label for 16% of DAIR Emotion examples | >20 options (Banking77 0.425); `noul` can follow its option labels instead of the input (#156); English checkpoint collapses on non-Latin scripts (Khmer 0.000 at 0.952 confidence) |

## 2. How they would be used here

Only three question shapes map onto Tab Amnesty. Costs are for the brief's reference browser of
137 tabs (9,316 pairs). "In-browser Laya" means the community int8 WASM build, multi-threaded, on a
page's main thread. The same build single-threaded, which is what an MV3 offscreen document gets
unless it is made cross-origin isolated, measured about 6× slower.

| Question | Calls per sweep | In-browser Laya | Jev | What leaves the machine |
|---|---|---|---|---|
| `choice` per group: pick the best heading among heuristic candidates (lineage-root title, top digest heading, top IDF tokens, dominant host) | ~8 | ~3 s (≈15–20 s in a worker) | ~1–2 s | Jev: every title in every group |
| `noul` per tab: "is this a tool used across every project?" (a learned version of `ambient.json`) | 137 | ~2–5 min | seconds in parallel, ~$0.002 | Jev: every title + digest |
| `noul` per pair: "are these the same piece of work?" (a new signal S9) | 9,316 | ~6 h | ≥ 7.8 min at the 1,200 req/min limit, ~$0.23 | Jev: every pair of tabs |
| *For comparison: the shipped clusterer, all pairs, all nine signals* | — | **52 ms for 144 tabs, no model** | — | nothing |

The brief's load-bearing rule is **collect passively, act instantly**: the sweep reads stored
records and returns in under a second. The per-tab question could only fit that rule if it were
answered once, when the digest is captured, in the `chrome.alarms` + offscreen queue that §5.5
already requires, and stored on the trace like the digest itself. The per-pair question cannot be
made to fit. The per-group question only fits as background precompute, because group membership
changes with every sweep.

## 3. Size: plus or minus for *our* user?

**A plus against LLMs, a minus against the job.**

Plus:
- 322–421M is small for a model, and Laya needs no GPU. That is a lower hardware bar than Gemini
  Nano, the Phase 1 default, which needs 22 GB free disk and 16 GB RAM or more than 4 GB VRAM.
  Laya would reach users Nano cannot.
- It runs offline, it is Apache 2.0 so it could ship, and a typed answer cannot come back malformed.

Minus (these decide it):
- **Memory is the scarce resource for exactly this user.** Tab Amnesty is for people with 80–137+
  tabs, whose browser is already discarding background tabs to save memory (§5.4 exists because of
  that). Loading at least 440 MB of int8 weights (290 MB int4, which traded away accuracy: max
  Δp 0.347), plus the runtime, into that browser costs the one thing it lacks.
- **Payload.** The whole built extension today is ~110 KB (525 KB with source maps). Bundling
  Laya makes it ~4,000× larger. Downloading it on first use instead is a network request
  (banned in Phase 0, needs asking after), and the first sweep would wait on it.
- **Cold start vs "act instantly".** Load-run-unload keeps memory transient, but every load is a
  multi-second cold start (Laya's own CPU reload median is 7.4 s in Python). That is fine for a
  background queue and never acceptable on the sweep path.
- **Store review surface.** WASM inference needs `wasm-unsafe-eval` in the extension CSP and an
  offscreen document. That adds scrutiny to the profile the 1 Aug 2026 Chrome Web Store rules
  already treat as highest-risk: an extension that reads every page.

The job itself is ranking and grouping ~100 records that already carry nine behavioural signals.
That takes 52 ms and ten numbers. Size would only be worth paying for if it bought accuracy the
signals cannot reach, and §4 shows it does not today.

## 4. How good could it be? The ceiling, measured

The best Laya could ever do as a pairwise judge is a perfect one. We can simulate that: replace S7
with an **oracle** that is 1 when two tabs share a hand label and 0 otherwise, then cluster with the
shipped code. The fixtures are the synthetic positive controls, where projects interleave in time
the way real work does. These are mechanics only, not evidence about real browsers.

| Fixture | Shipped | S7 zeroed | **Oracle S7, weight 1.0** | Oracle S7, weight 3.0 | Refit weights (in-sample) |
|---|---|---|---|---|---|
| `synthetic_multilingual` (4 scripts, one host, interleaved) | 0.196 | 0.160 | **0.270** | 1.000 | 1.000 |
| `synthetic_lineage` (projects differ only by opener tree) | 0.273 | 0.113 | **0.530** | 1.000 | — |
| `synthetic` (easy: separate sittings) | 0.880 | 0.880 | **0.880** | 0.880 | — |

(ARI against labels. "Refit" is `npm run refit synthetic_multilingual`, which gives S7 weight 2.41
without being told which signal matters.)

Read it this way. At the brief's weight, a perfect content judge adds +0.07 ARI on interleaved
multilingual work, because timing signals (S2 + S3 + S4 ≈ 4.5 combined) outvote anything weighted
1.0. Once the weight is learned, the same fixture goes to 1.0 without any model. Real zero-shot
Laya would sit well below the oracle: it scores 0.36 on typed decisions against a 0.46 majority
baseline. It is strongest at *topic* classification, and topic similarity is what TF-IDF S7
already approximates at zero cost. The thesis is that a project is not a topic.

Fine-tuning is where Laya's accuracy comes from (0.36 → 0.77). It needs thousands of labelled
decisions from many people. Our labelled data is the five gate browsers, and those cannot be both
training set and test set.

## 5. Fit, phase by phase

| Phase | Where it could plug in | Verdict |
|---|---|---|
| 0 — X-ray | Nowhere: models, ONNX, WASM and network are anti-scope | No |
| 1 — Amnesty | Naming: Jev/Laya cannot write a name, only choose among heuristic candidates. Ambient detection: per-tab `noul` computed passively | Naming: no (Nano or the heuristic tier). Ambient: maybe, only if real fixtures show `ambient.json` missing tools |
| 2 — Return path | Search: Laya is not a retrieval model; if lexical search fails, a small bi-encoder is the right tool (the brief says measure first). Resurfacing: rules on behaviour ("three tabs reopened") come first | No |
| 3 — MCP bridge | Laya ships an MCP server, but Claude is the client there and makes its own judgements | No |

## 6. What was done instead (this change)

1. **S7 tokens are Unicode-aware** (Python first, TS to match, parity 0/780 mismatches). Before:
   `[a-z0-9]{2,}` dropped Devanagari, Tamil, CJK and Thai titles entirely and cut accented Latin
   words apart. Percent-encoded paths such as `/wiki/%E6%9D%B1…` became byte tokens (`e6`, `9d`)
   shared by every non-ASCII URL on a site. That is the same failure Laya's router exists to catch
   in its English checkpoint. On the new `synthetic_multilingual` control, within/across-project
   S7 moved from 0.84/0.70 (noise) to 0.39/0.11.
2. **`npm run refit`**: logistic regression over the nine signals from the shipped clusterer.
   Betas are scaled so affinity ≥ W_MIN exactly where P(same project) ≥ 0.5. The only number that
   counts is the leave-one-browser-out column. On the synthetic controls it averages −0.15 ARI
   held out, because each control hinges on a different signal. Transfer between real browsers
   must be measured, not assumed. It writes a candidate file and never touches
   `src/cluster/betas.json`.

## 7. When to look again, and how

Revisit only if all three hold:

1. The gate has passed on the shipped weights.
2. Refit has run leave-one-browser-out on the real fixtures and plateaued.
3. The remaining held-out errors are mostly "same project, no behavioural evidence": work resumed
   in a later sitting with no opener chain, where the titles plainly relate.

Then run the experiment in `analysis/` (Python, `pip install laya`), never in the extension. Score
every labelled pair with a `noul` or neutral-label `choice` (see Laya #156), add it as a tenth
column, and compare refit held-out ARI with and without it. Write down the margin that would
justify ~440 MB before running it. Only if it clears that margin does an in-extension build come
up, and that needs asking first (CSP change, offscreen document, model download).

## Sources

- Laya package README and source, v0.3.20 (PyPI `laya`): architecture, checkpoints, benchmarks,
  honest limits, ONNX runtime. https://pypi.org/project/laya/
- Laya model card: https://huggingface.co/convaiinnovations/laya
- Browser ports: https://github.com/nvkudva/laya-web (q8e8 ~440 MB / q4e8 ~290 MB, WASM latency,
  WebGPU accuracy loss), https://github.com/vishalmysore/layaForWeb
- Jev: https://typesafe.ai/blog/introducing-system-one-models-and-jev,
  https://flaviocopes.com/jev/ (limits, pricing, rate limits),
  https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/
- Comparisons: https://www.orcarouter.ai/blog/jev-vs-laya,
  https://flowtivity.ai/blog/laya-open-source-jev-alternative/
- Internal measurements: `npm run refit`, the oracle run described in §4, and `cluster()` timing
  on a 144-tab synthetic browser (Node 22, this repo at the commit that adds this note).
