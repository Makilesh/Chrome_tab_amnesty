# Contributing

Thank you for helping. Tab Amnesty is a browser memory for people who keep a lot of tabs open —
most of them have ADHD — so how it behaves matters as much as what it does.

## Set up

```
npm ci
npx tsc --noEmit -p .       # typecheck
npx vitest run              # unit tests (the clusterer, naming, search, the worker's event handling)
npm run check:setup         # once: Chrome for Testing into ./chrome
npm run check               # drives a real Chrome through recording, grouping, putting away,
                            # a restart, bringing back, search and copies
```

`npm run build` writes `dist/`; load it at `chrome://extensions` → Developer mode → Load
unpacked, and press **Reload** there after every build. `npm run package` makes the public zip.

## Where things are

```
src/collector/   service worker + content script: what is recorded, as it happens
src/cluster/     the clusterer — pure functions, no chrome.*, fully unit-tested
src/archive/     cards, naming, search, Keep a copy, the sweep's actions
src/ui/sweep/    the page the toolbar icon opens
docs/            DECISIONS.md (judgement calls), PHASES.md, RESEARCH.md (the measurement side)
```

## The rules that do not bend

Read `CLAUDE.md` — sections §5 (Chrome's platform rules) and §6 (the human design rules) — and
`.ux-profile.md` (look, voice, accessibility) before changing behaviour or UI. In short: never
show a tab count as a problem, never use the words delete / clean up / declutter / tidy / messy,
never characterise someone's browsing, never ask people to name things, never close anything
without an explicit per-group action, keep forgetting first-class, and keep everything on the
computer — no network request without a discussion first.

## Privacy, for contributors

Never commit real browsing. Fixtures from real browsers stay on the machine they were made on
(git ignores `fixtures/*.json` except the made-up synthetic and walkthrough ones); tests and
screenshots use made-up pages.

## Pull requests

Keep them small and focused, with tests for behaviour changes. When you make a judgement call the
docs did not settle, add a dated three-line entry to `docs/DECISIONS.md` (decision, alternative
rejected, why).
