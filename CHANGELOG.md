# Changelog

All notable changes to Tab Amnesty. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-10

### Added
- **Alt+Shift+K** opens Tab Amnesty (change it at `chrome://extensions/shortcuts`).
- **Search from the address bar:** type `ta`, a space and a few words to find something you put
  away; Enter opens it, or shows every match on Tab Amnesty's page.
- A first install opens Tab Amnesty's page once, so you see your tabs grouped straight away.

### Privacy and security
- Sites can no longer detect that Tab Amnesty is installed: nothing in it is web-accessible.
- Pages that are not web pages (local files, blank pages, files opened in a tab) keep no title or
  text, only what kind of page they were.
- Mail, chat, search and message pages on the built-in list keep only the site, or which page of
  it — never a search's words or a message's id; the list now covers regional search engines,
  Kagi, Yandex, YouTube results, and LinkedIn, Facebook, X and Instagram messages.
- A page can no longer make its tab look like it holds unsent typing, nor send oversized text.
- "Never remember" refuses whole endings like "com" or "co.uk", which would have forgotten every
  address under them in one click, and finishes an interrupted purge when the site is added again.
- A crafted "copy" file can no longer freeze the page; copies are capped at 200 MB and 500 lines a group.

### Fixed
- Forgetting a group no longer removes records that another put-away group or an open tab still uses.
- Group names learned from a site go when the site is never remembered.

### Accessibility
- "Forget this" asks once before forgetting for good.
- Messages, search results and Bring back are announced to screen readers; focus stays where you
  were after every action; every button says which group or page it belongs to.
- Text and field borders meet WCAG AA contrast in light and dark; lines wrap on narrow screens.
- The page opens on your groups; "Show these groups on my tab strip" sits below them.

### For contributors
- Continuous integration: typecheck, unit tests and the public build on every push and pull request.
- `CONTRIBUTING.md`, `SECURITY.md`, issue and pull-request templates.

## [0.1.0] - 2026-11-09

The first public release.

### Added
- Groups open tabs by the project they belong to — tabs opened from one another, in one sitting,
  and switched between — named by Chrome's on-device model when available, from the pages' own
  titles otherwise.
- **Archive & close**: one button per group; every page is written down before anything closes,
  and a tab holding a half-written message stays open.
- **Bring back** a whole group for a day, even after a restart; **Open all** any time after.
- **Search** everything put away by a word from a page's title, its text, its site or the day,
  including Japanese, Chinese and Thai text.
- **Keep a copy**: everything put away as one file that opens in any browser and can be brought
  back in, adding only what is missing.
- **Forget this** on every group and page, and a list of sites never remembered.
- A public build without the research study (`npm run package`); the study build for testers
  (`npm run package -- --study`).

### Privacy
- Nothing leaves the computer: no network requests, no account, no analytics.
- Mail, chat, calendar and search-results tabs keep no title, page text, search words or message ids.
- Records of tabs closed without being put away are removed after 30 days.

[Unreleased]: https://github.com/Makilesh/Chrome_tab_amnesty/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Makilesh/Chrome_tab_amnesty/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Makilesh/Chrome_tab_amnesty/releases/tag/v0.1.0
