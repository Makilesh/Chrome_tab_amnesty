# Changelog

All notable changes to Tab Amnesty. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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

[Unreleased]: https://github.com/Makilesh/Chrome_tab_amnesty/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Makilesh/Chrome_tab_amnesty/releases/tag/v0.1.0
