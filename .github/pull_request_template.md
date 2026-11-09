## What and why

<!-- One or two sentences. -->

## Checks

- [ ] `npx tsc --noEmit -p .` and `npx vitest run` pass
- [ ] `npm run check` passes, if this changes how the extension behaves
- [ ] The rules in `CLAUDE.md` §5 and §6 and `.ux-profile.md` still hold (no tab counts, none of the banned words, nothing closes on its own, nothing leaves the computer)
- [ ] No real browsing in tests, fixtures or screenshots
- [ ] A dated entry in `docs/DECISIONS.md` for any judgement call
