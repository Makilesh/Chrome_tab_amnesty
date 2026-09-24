# Tab Amnesty

A browser memory, not a tab manager. **Close it, you'll still have it.**

Phase 0 — the X-ray — is a measurement, not a product: does clustering open tabs by *behaviour*
(which tab opened which, when, what gets switched between) recover someone's real projects better
than Chrome's built-in "Organize tabs", which clusters by topic? Full brief in `docs/PROJECT.md`;
checklist and gates in `docs/PHASES.md`.

## Pass condition (Phase 0 gate)

On **five real browsers with 80+ open tabs**, hand-labelled by their owners:

1. Our partition's **Adjusted Rand Index** against the labels beats Chrome's organiser by
   **≥ 0.15 absolute on at least 4 of the 5**, and
2. zeroing the behavioural signals S1 (opener lineage), S2 (temporal proximity) and S8
   (co-activation) together **drops our ARI by ≥ 0.10**.

Scoring convention, applied identically to both partitions: **each ungrouped / loose-end tab is
its own singleton cluster.** Nothing is excluded from scoring and nothing is lumped into a junk
bucket. ARI is reported on the full labelled set and separately on the subset both partitions
placed in a group, so a win from "placed more tabs" is visible as such.

Known limits, reported not hidden:

- Co-activation and dwell only accrue after days of collection, so this gate mostly tests S1–S7
  with history-backfilled timing. A marginal pass is more encouraging than it looks; a clear fail
  is fatal. A failed gate is a real outcome.
- The "zero S1/S2/S8" run leaves S3 (same session) standing, and S3 is cut from the same
  timestamps S2 decays over — so that run under-states how much timing contributes.
- On projects that interleave in time, the contemporaneity signals (S2, S4) can actively mislead:
  on the lineage positive control, zeroing S2 *raises* ARI from 0.27 to 1.0. Weights were not
  tuned on synthetic data; `npm run refit` on labelled real pairs is the intended fix, and only
  its leave-one-browser-out column counts (weights fit on the gate browsers and scored on them
  would be a harness tuned to pass).
- After a browser restart, two tabs on the same URL can swap identities (the re-bind has nothing
  stronger than URL to go on), so some lineage lands on the wrong twin.

## Layout

```
src/collector/   service worker + content script (records; never closes or groups anything)
src/cluster/     the shipped clusterer — pure TS, zero chrome.*, runs in Node
src/ui/xray/     the read-only page from the extension icon
analysis/        Python research bench (networkx, sklearn, pandas) — where signals get changed
tools/           cluster CLI, integration check, thin npm wrappers around Python
fixtures/        exported traces, hand labels, Chrome baselines (see fixtures/README.md)
docs/            PROJECT.md (brief), PHASES.md (checklist), DECISIONS.md (judgement calls)
```

The clusterer exists twice on purpose: Python is where signals are iterated; TS is what ships,
and **the gate is measured on the TS partition** — `npm run score|ablate|report` run
`tools/cluster-cli.ts` and print the parity result in every header. `npm run parity` fails if the
two drift (every pair's signal must match to 1e-9; partitions must agree at ARI ≥ 0.98 — both run
the same deterministic Louvain, so the observed value is 1.0). `--python` clusters in the bench
instead, for experiments; its output is labelled as not a gate number.

## Running it

Extension (no Python needed):

```
npm install
npm run build            # dist/ — load unpacked in chrome://extensions
npm test                 # vitest: url features + clusterer
npm run check:setup      # once: Chrome for Testing into ./chrome (branded Chrome ignores --load-extension)
npm run check            # drives a real Chrome, prints what the collector recorded, restarts,
                         # re-binds, audits the x-ray page, then runs parity (needs Python)
```

Measurement (Python 3.11+):

```
uv pip install --python .venv/Scripts/python.exe -e "analysis[dev]"     # or: pip install -e analysis[dev]
npm run pytest
npm run synth            # synthetic fixtures for mechanics only — never count toward the gate:
                         #   synthetic (easy) + synthetic_{lineage,coactive,temporal} (positive
                         #   controls: projects separable by exactly one behavioural signal) +
                         #   synthetic_multilingual (four scripts; only page text separates them)
npm run cluster <name>   # TS clusterer -> fixtures/<name>.partition.json
npm run score <name>     # ARI / pairwise P-R-F1, ours (TS) vs Chrome vs labels, parity in header
npm run ablate <name>    # ARI delta with each signal zeroed, plus S1+S2+S8 together (TS partitions)
npm run report a b c d e # per-browser chart -> fixtures/report.png
npm run refit a b c d e  # learn P(same project) from the signals, each browser held out in turn
                         #   -> fixtures/refit.betas.json (a candidate; src/cluster/betas.json is never written)
npm run parity [name...] # TS vs Python agreement; no args = every fixture. Also part of npm run check
```

## Getting a real fixture

1. Install the unpacked extension and browse normally for a few days.
2. Click the icon → "For the study" → **Export traces** (shareable by default: no full URLs, no
   query values, no page text). Save as `fixtures/<name>.json`.
3. Run Chrome's **Organize tabs**, accept its groups, then **Capture Chrome's grouping**. Save as
   `fixtures/<name>.chrome.json`. The groups are undone afterwards; saved groups may refuse and
   the page says so.
4. Label your own tabs: `fixtures/<name>.labels.json`, `traceId → project name` (`null` = no
   project). See `fixtures/README.md`.
5. `npm run score <name>` and `npm run ablate <name>`.

## Rules that do not bend

Six platform non-negotiables and eleven human design rules — see `CLAUDE.md`. In short: never
delete anything, never auto-close, never show a tab count as a problem, never make the user name
anything, nothing leaves the machine.
