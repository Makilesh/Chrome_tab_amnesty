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
