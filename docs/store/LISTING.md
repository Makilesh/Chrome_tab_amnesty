# Chrome Web Store listing — Tab Amnesty

Everything the Developer Dashboard asks for, ready to paste. Submitting is the owner's: the
developer account, its one-time registration fee and the publisher name are theirs.

**Upload:** `npm run package` → `release/tab-amnesty-<version>.zip` (the store build — no study
tools; see "Before submitting").

## Store listing

**Name:** Tab Amnesty

**Summary** (127 of 132 characters):

> Groups your tabs by what you were doing. Put a whole project away in one click and find it again. Nothing leaves your computer.

**Description:**

> Close it, you'll still have it.
>
> Tab Amnesty is a memory for your browser. It notices which tabs belong together — the ones you
> opened from one another, in one sitting, and switched between — and shows them as groups named
> after what you were doing: "Lisbon", "asyncio", "Job search".
>
> Each group has one button: Archive & close. It writes everything down first — every page, its
> title, what it said — and only then closes the tabs. Changed your mind? Bring back puts the
> whole group back on your tab strip, in its order, for a day, even after a restart. After that,
> Open all brings it back whenever you like.
>
> Find anything you put away by any word from a page's title, its text, its site, or the day.
>
> Keep a copy: save everything you put away as one file that opens in any browser, and bring it
> back in on another computer.
>
> Made for people who keep a lot of tabs open:
> • Nothing closes unless you press Archive & close on that group.
> • A tab holding a half-written message stays open.
> • No counts, no streaks, no reminders.
> • Forget this on every group and every page, and a list of sites it never remembers.
>
> Private by design:
> • Everything stays on your computer. No account, no server, no analytics, no network requests.
> • Names and summaries come from Chrome's built-in on-device model when your Chrome has it,
>   and from the pages' own titles when it does not.
> • It never runs in incognito windows.
> • Open source: https://github.com/Makilesh/Chrome_tab_amnesty

**Category:** Productivity → Workflow & Planning · **Language:** English

**Graphics:** icon `public/icons/icon-128.png` (128×128); screenshots `docs/images/sweep-light.png`
and `docs/images/search-light.png` (1280×800 — the public build on made-up browsing); small promo
tile `docs/store/promo-440x280.png`.

**Homepage:** https://github.com/Makilesh/Chrome_tab_amnesty ·
**Support:** https://github.com/Makilesh/Chrome_tab_amnesty/issues

## Privacy practices

**Single purpose:**

> Tab Amnesty groups the user's open tabs by the project they belong to, so the user can put a
> whole group away (archive and close) in one click and find and reopen it later.

**Permission justifications:**

| Permission | Justification |
|---|---|
| tabs | To see which tabs are open and which tab opened which (the grouping), and to close a group's tabs and reopen them when the user presses Archive & close, Bring back or Open all. |
| tabGroups | To show the groups on the tab strip when the user asks, and to reopen a put-away group as a named tab group. |
| history | To read how a visit to an open tab's page started (link, typed, bookmark) and, for tabs open before installation, when they were visited — timing the grouping uses. Only the open tabs' own addresses are looked up. |
| Host permissions (http, https) | A content script reads each page's title, description, headings and opening text, to name groups and make put-away pages searchable, and notices whether a text box holds unsent typing (yes/no only) so such a tab is never closed. Also needed to start that script in tabs already open at installation. |
| scripting | To start the content script in tabs that were already open when the extension was installed or updated. |
| alarms | Background work on a schedule: summaries of put-away pages with Chrome's on-device model, and keeping records in step after a window closes. |
| offscreen | Chrome's on-device Summarizer runs in an offscreen document, outside the service worker. |
| unlimitedStorage | Everything put away is kept until the user forgets it; without this Chrome may evict the extension's storage under pressure. |

**Remote code:** No, I am not using remote code.

**Data usage** — all of it is stored and processed on the user's computer only, never transmitted:

- [x] **Web browsing activity** — addresses of open tabs, which tab opened which, when tabs were
  switched to and for how long; visit types from Chrome's history.
- [x] **Website content** — page titles, descriptions, headings and opening text; summaries made
  on-device.
- [x] **User activity** — only whether a text box the user typed into is empty (yes/no; never
  the text, never keystrokes).
- [ ] Personally identifiable information, health, financial and payment, authentication,
  personal communications, location: not collected as such. Mail, chat, calendar and
  search-results tabs keep no title or page text (DECISIONS 2026-10-17). Any other page's
  title and opening text are kept as website content, whatever the page shows; the user can
  list a site under "Sites never remembered" to keep nothing about it. The owner should read
  this item against the dashboard's own definitions when submitting.

**Certify:** not sold to third parties; not used or transferred for purposes unrelated to the
item's single purpose; not used or transferred to determine creditworthiness or for lending.

**Privacy policy:** https://github.com/Makilesh/Chrome_tab_amnesty/blob/main/PRIVACY.md

## Distribution

Public (or Unlisted for a quiet first week) · all regions.

## Before submitting

- [ ] **The Phase 0 gate.** CLAUDE.md says the Phase 0 gate must be read before any store
      submission. It is still unmeasured. The owner decides whether that rule still holds.
- [ ] **A license** for the repository (the listing links to it as open source).
- [ ] **The owner's own browsing in `fixtures/`** — the repository is public. Decide whether
      those files and their history stay.
- [ ] `npm run check` passes on the commit being packaged; load the zip unpacked once and press
      Archive & close and Bring back by hand.
