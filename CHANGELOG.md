# Changelog

All notable changes to Tab Amnesty. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-11-12

### Added
- Right after you press Start, a line under your groups says they get better as you browse: tabs
  that were already open can only be grouped by where they sit and what they say. It goes away on
  its own as you open new tabs. Anyone already using Tab Amnesty never sees it.

## [0.3.0] - 2026-11-10

### Added
- **Tab Amnesty asks first.** The page a first install opens says plainly what it notes and why,
  and nothing is recorded until you press **Start grouping my tabs**. If you were already using
  it, it carries on as before without asking.

### Privacy
- **No more "browsing history" permission.** How a visit started now comes from the page as it
  loads (`webNavigation`), so Chrome's install prompt drops from three warnings to two. Tabs that
  were open before you started group a little more loosely: when they were opened isn't known.

### Changed
- **A new look.** Tab Amnesty's page follows Notion's calm page style more closely: white cards on
  a warm grey desk, a deeper shelf for what you put away, a small tab in each group's Chrome
  tab-group colour, and line icons beside the buttons' words. Dark mode follows your system.
- **Site icons** beside every page, from Chrome's own copy on your computer; nothing is fetched
  from the sites (new permission: favicon, which adds no install warning).
- **Search marks the words it found** in titles, summaries and names.
- **Archive & close shows where things go:** the group's card travels down onto the "Put away"
  shelf. Lists open smoothly, and nothing moves when your computer is set to reduce motion.
- The copy saved by Keep a copy has the same look.
- Adding a site to Sites never remembered asks once first, because it forgets what was kept about
  the site, and says so plainly when what was typed is not one site.
- A search that finds nothing offers to clear it, and the search box has a visible label.
- "Put away" shows two groups at a time, with "Show more put away" for the rest, so no more than
  five choices are on screen at once.
- Messages name your browser's own pages (`edge://extensions` in Edge, `brave://extensions` in
  Brave) and say "your browser" rather than Chrome.
- When something fails, it says so in plain words, with a "Copy error details" button for bug
  reports instead of Chrome's own message.

### For contributors
- `npm run preview` shows the real page in any browser, on made-up tabs, without loading the extension.

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
