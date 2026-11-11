# Chrome Web Store and Edge Add-ons listing — Tab Amnesty

Everything the Developer Dashboard asks for, ready to paste, then what differs on Microsoft Edge
Add-ons and what reviewers are likely to ask. Submitting is the owner's: the developer accounts,
the Chrome Web Store's one-time registration fee and the publisher name are theirs. Checked
against the stores' own pages on 10 November 2026 (sources at the end).

**Upload:** a zip with `manifest.json` at its top level. Chrome: "place the manifest file in the
root directory, not in a folder". `npm run package` builds the store version (no study tools)
into `release/tab-amnesty-<version>/`, but the zip it makes wraps that folder. That suits Load
unpacked, but the stores won't take it. Zip the folder's contents instead. No rebuild is needed:

```text
Git Bash:    cd release/tab-amnesty-<version> && /c/Windows/System32/tar.exe -a -c -f ../tab-amnesty-<version>-store.zip *
PowerShell:  & "$env:SystemRoot\System32\tar.exe" -a -c -f release\tab-amnesty-<version>-store.zip -C release\tab-amnesty-<version> manifest.json service-worker-loader.js assets icons src
```

Both put `manifest.json` at the top (checked on the 0.1.0 build; if a build gains another
top-level folder, add it to the PowerShell list). The same zip goes to both stores.

## Store listing

**Name:** Tab Amnesty (taken from the manifest).

**Summary.** Both dashboards show the manifest's `description` here, read-only: up to 132
characters, called "Short description" on Edge. Today it is:

```text
A browser memory. Close it, you'll still have it.
```

That is the line people see in search results and on category pages, and it says what Tab
Amnesty is like, not what it does. Suggested instead (127 of 132 characters). Put it in
`manifest.json` → `description` and package again:

```text
Groups your tabs by what you were doing. Put a whole project away in one click and find it again. Nothing leaves your computer.
```

**Description.** One line per paragraph; paste it as is. "What it keeps" is the disclosure the
Disclosure Requirements ask for before installing (see Privacy practices). Keep it near the top.

```text
Close it, you'll still have it.

Tab Amnesty is a memory for your browser. It notices which tabs belong together — the ones you opened from one another, in one sitting, and switched between — and shows them as groups named after what you were doing: "Lisbon", "asyncio", "Job search".

Each group has one button: Archive & close. It writes everything down first — every page, its title, what it said — and only then closes the tabs. Changed your mind? Bring back puts the whole group back on your tab strip, in its order, for a day, even after a restart. After that, Open all brings it back whenever you like.

What it keeps, and why — on your computer only, never sent anywhere, and nothing at all until you press Start on the page it opens when installed:
• For each tab in a normal window: its address, title and site; when it was opened, which page it was opened from, and when you switched to it and for how long. That is how it tells one project from another.
• How each visit started (a link, a typed address, a bookmark), as Chrome reports it when the page loads. It does not read your browsing history.
• A short digest of each page — its description, headings and opening lines — so a group can be named and a page found again.
• Whether a text box you typed into still holds unsent text: a yes or no, never the text.
• Mail, chat, calendar, search and message pages on its built-in list keep no title or text. Records of pages you close yourself go after 30 days; what you put away stays until you forget it.

Find anything you put away by a word from its title, headings, opening lines or summary, its site, or the day.

Keep a copy: save everything you put away as one file that opens in any browser, and bring it back in on another computer.

Made for people who keep a lot of tabs open:
• Nothing closes unless you press Archive & close on that group.
• A tab holding a half-written message stays open.
• No counts, no streaks, no reminders.
• Forget this on every group and every page, and a list of sites it never remembers.

Private by design:
• Everything stays on your computer. No account, no server, no analytics, no network requests.
• Names and summaries come from Chrome's built-in on-device model when your Chrome has it, and from the pages' own titles when it does not.
• It never runs in incognito windows.
• Open source: https://github.com/Makilesh/Chrome_tab_amnesty
```

Changed from the 17 Oct text: the "What it keeps" block is new, and search no longer promises
"any word from a page's text". Search reads the title, headings, description, the first 1,000
characters, the summary, the site and the day (`src/archive/search.ts`), not whole pages. About
2,300 characters; no keyword list, no superlatives, no testimonials (Listing Requirements).

**Category:** Productivity → Workflow & Planning · **Language:** English

**Graphics:**
- Store icon: `public/icons/icon-128.png` (128×128 PNG with transparency). Chrome's guidance is
  96×96 artwork inside 16 px of transparent margin; ours fills the square, so it will look a
  little larger than its neighbours. Optional: a padded copy, for this upload field only.
- Screenshots, 1 to 5 at 1280×800, in this order: `docs/store/screenshots/1-groups.png`,
  `2-put-away.png`, `3-search.png`, `4-start.png`, `5-dark.png`. They show the public build on
  made-up browsing (`npm run preview`), with no counts.
- Small promo tile (optional; listings without one are shown after those that have one):
  `docs/store/promo-440x280.png`. Chrome's image guide says "Avoid text" on tiles; a name and
  tagline are common and not a rejection reason.
- Marquee 1400×560: optional, and only needed to be featured in the home-page carousel. Not
  needed to launch.

**Homepage:** https://github.com/Makilesh/Chrome_tab_amnesty ·
**Support:** https://github.com/Makilesh/Chrome_tab_amnesty/issues ·
**Official URL:** leave empty (it needs a site verified as yours; github.com can't be).

## Privacy practices

**Single purpose:**

> Tab Amnesty groups the user's open tabs by the project they belong to, so the user can put a
> whole group away (archive and close) in one click, and later find it — by its name, sites, day
> or the words of its pages — and reopen it. Everything it keeps stays on the user's computer.

**What the install prompt will say.** These are Chromium's own strings and rules, read from its
source on 10 Nov. Edge is built on the same code.

1. *Read and change all your data on all websites*: the http/https host permissions and the
   content script.
2. *View and manage your tab groups*: `tabGroups`.

`tabs` and `webNavigation` add no line of their own: their "Read your browsing history" is
absorbed by line 1. `scripting`, `alarms`, `offscreen`, `unlimitedStorage` and `favicon` show
nothing. Until 0.3.0 there was a third line, *Read and change your browsing history on all your
signed-in devices*, from `history`; the owner chose to drop it (DECISIONS 2026-11-10).

**Permission options.**
- `history` → `webNavigation`: done in 0.3.0 (DECISIONS 2026-11-10). `webNavigation.onCommitted`
  gives how each visit started as it happens, and its warning is absorbed by line 1. The cost:
  tabs open before installing (or before Start) have no known opening time, so the clusterer
  (`timingKnown`, `src/cluster/segment.ts`) groups them on position, text and switching only.
- `tabs`: dropping it changes nothing anyone sees. Keeping it keeps grouping working when someone
  limits Tab Amnesty's site access in their browser. Keep it.
- `tabGroups`: dropping it removes line 3, but groups on the strip and after Bring back would
  have no name or colour. Keep it.
- Host access and the content script: the digest and the unsent-typing check must already be in
  any tab that might be put away. `optional_host_permissions` or `activeTab` would mean asking
  on first use and leaving drafts unprotected in tabs opened before the grant. Keep them.

**Permission justifications.** They are browser-neutral, so the same text serves Edge.

| Permission | Justification |
|---|---|
| tabs | To read open tabs' addresses and titles and which tab opened which (that is the grouping), and to close a group's tabs and open them again when the user presses Archive & close, Bring back or Open all. It also keeps grouping working when the user limits the extension's site access. |
| tabGroups | To name and colour the tab-strip groups it makes when the user asks ("Show these groups on my tab strip", Bring back, Open all). Tabs already in a group — the user's own, or a saved group — are left where they are. |
| favicon | To show each page's site icon beside its title on the extension's own page, read from the browser's local favicon store, so a group is recognisable at a glance. No request is made to any site, and nothing is stored. |
| webNavigation | Reads, for each tab's own top frame as its page commits, how that visit started (a link, a typed address, a bookmark, a search): the signal that tells one task from the next when grouping. Only that one word is kept, on the tab's record. It does not read browsing history, never reads frames or prerendered pages, and never sends anything. |
| Host permissions (http, https) | A content script in every page builds a short digest — title, meta description, up to 20 headings, the first 1,000 characters of text — to name groups and make put-away pages searchable. It also checks whether a text box the user typed into still holds text (yes/no only), so Archive & close never closes a draft. It must already be in any tab that might be put away, and it runs in all frames because editors live in iframes. Everything is processed on the computer; nothing is sent. |
| scripting | Only when the extension starts fresh (install, update, or being switched back on): injects its own packaged content-script file into tabs that were already open, so they are described and their drafts protected too. It never injects a code string, and discarded tabs are not reloaded. |
| alarms | Background work on a schedule instead of continuously: on-device summaries of put-away pages, reconciling records a minute after a window closes, and once a day removing records of tabs closed more than 30 days ago. |
| offscreen | The browser's on-device Summarizer API runs in an offscreen document, because summarising several pages can outlast the service worker. |
| unlimitedStorage | What the user puts away is kept until they forget it. Without this the browser may evict the extension's IndexedDB and Cache Storage under storage pressure, losing what the user was told is kept. |

**Remote code:** No, I am not using remote code.

**Data usage.** The dashboard asks "What user data do you plan to collect from users now or in
the future?" Tick by the dashboard's own labels. Data kept only on the computer counts: the User
Data FAQ requires disclosure "even when data is processed or stored locally". The old draft's
"Web browsing activity" is called **Web history** in the form.

- [x] **Web history**: addresses and titles of open tabs; when each was opened, switched to and
  for how long; which tab opened which; how each visit started (as the browser reports it when
  the page loads). Nothing is recorded until the user presses Start. Records of tabs closed without being put away go after 30 days. Mail,
  chat, calendar, search and message pages on the built-in list keep only the site (or which
  page of it). Pages that are not web pages keep only what kind they were.
- [x] **Website content**: each page's meta description, up to 20 headings and first 1,000
  characters of text, plus summaries written on the device. What is put away is kept until the
  user forgets it.
- [x] **User activity**: which tab is in front and for how long, and whether a text box the user
  typed into is empty (yes/no; never the text, never keystrokes).
- [ ] Personally identifiable information, Health information, Financial and payment
  information, Authentication information, Personal communications, Location: not collected as
  such. Mail, chat, calendar, search and message tabs on the built-in list keep no title or page
  text (DECISIONS 2026-10-17, 2026-11-10). Any other page's title and opening text are kept as
  website content, whatever the page shows; the user can list a site under "Sites never
  remembered" to keep nothing about it. The owner should read this item against the dashboard's
  own definitions when submitting.

**Certify** (all three): I do not sell or transfer user data to third parties, outside of the
approved use cases · I do not use or transfer user data for purposes that are unrelated to my
item's single purpose · I do not use or transfer user data to determine creditworthiness or for
lending purposes.

**Privacy policy:** https://github.com/Makilesh/Chrome_tab_amnesty/blob/main/PRIVACY.md. The form,
the policy and the extension's behaviour must agree. A contradiction is grounds for removal
(Listing Requirements §3), so update PRIVACY.md whenever this section changes.

**Limited Use statement.** It must be "on your project's homepage" or "on a page one click away
from the homepage; for example, in your privacy policy" (User Data FAQ). It is in both places:
README.md, "Private by design" (the homepage above), and PRIVACY.md, "Store policies".
Keep both when editing either.

**Prominent disclosure** (Disclosure Requirements, enforced since 1 Aug 2026). "Prior to
installation" the extension must "prominently disclose what user data will be collected and how
it will be used" and obtain "affirmative and informed consent". The 1 Aug update applies this to
all collection, "regardless of whether the data is closely related to the extension's single
purpose". Before installing, the description's "What it keeps" block, the privacy section on the
listing and the install prompt do that. The older User Data FAQ asks for more: a disclosure
"within the Product's user interface" that the user agrees to "in a manner that requires them to
take a specific action", and it says the store description does "not satisfy this requirement".
Until 0.3.0 Tab Amnesty recorded from the moment it was installed, which a reviewer applying the
FAQ could reject ("Purple Nickel — User consent is not obtained before data collection"). **Since
0.3.0 it asks first:** the page a first install opens lists what it notes and why, and nothing is
recorded until the person presses *Start grouping my tabs* — the specific action the FAQ asks for
(`src/collector/consent.ts`; DECISIONS 2026-11-10).

## Distribution

Public (or Unlisted for a quiet first week) · all regions. To choose the day yourself, untick
automatic publishing in the submit dialog: an approved version then waits up to 30 days for you
to press Publish.

## Before submitting

- [x] **The Phase 0 gate.** Waived for the store by the owner on 10 Nov (DECISIONS 2026-11-10).
      The measurement goes on alongside, and the README says grouping quality is still measured.
- [ ] **Upload `release/tab-amnesty-0.3.0-store-upload.zip`** (manifest.json at its top).
      `npm run package` makes it from the commit you are on, and the v0.3.0 GitHub release carries
      it. Older zips are not this listing.
- [x] **Summary:** the manifest description is the 127-character summary.
- [x] **In-product disclosure:** the Start notice, in 0.3.0 (the owner chose it; DECISIONS
      2026-11-10). Nothing is recorded before the button is pressed.
- [x] `npm run check` passes on 0.3.0 (exit 0), and the store folder itself, loaded unpacked in
      Chrome for Testing 153 (11 Nov): the Start notice on first install; three linked pages grouped
      as "Sourdough"; Archive & close closed all three and Bring back reopened them; no page errors.
- [x] **The install prompt,** read from Chrome itself (`chrome.management.getPermissionWarningsByManifest`
      on the 0.3.0 store build, 11 Nov): exactly "Read and change all your data on all websites"
      and "View and manage your tab groups".
- [ ] **Account steps only the owner can take:** register and pay the one-time fee, verify the
      contact email, and choose the publisher name. Also declare trader or non-trader (EU Digital
      Services Act): a trader's legal name, address and phone number are shown on the listing,
      and Google says the classification is the developer's own legal call.
- [x] **PRIVACY.md** names the tester copy `npm run package -- --study`.
- [x] **A license:** MIT, in `LICENSE`.
- [x] **The owner's own browsing in `fixtures/`:** out of the tree (59e4e4d), and no commit on any
      branch holds a `makilesh*` file (checked 10 Nov). A few old commit messages still name one.
- After publishing: a later version that keeps something new must say so inside the extension
  before it starts ("prominently disclose data practice changes"). A new permission with a new
  warning disables the extension for existing users until they accept it.

## Edge Add-ons

The same package; a different account and form, in Microsoft Partner Center.

**Account:** Partner Center → Microsoft Edge program. There is no registration fee. Sign in with
a Microsoft account (or with GitHub, which makes one). Choose an Individual account. The
publisher display name is up to 50 characters and is shown on the listing. The account's
country can't be changed later.

**Package:** the same root-level zip. There is no `update_url` to remove, and every API Tab
Amnesty uses (tabs, tabGroups, webNavigation, alarms, offscreen, scripting, windows, action, runtime)
is on Edge's supported list. The name and short description come from the manifest and are
read-only.

**Availability:** Public (or Hidden: reachable by its link only) · all markets.

**Properties:** Category **Productivity** · Website https://github.com/Makilesh/Chrome_tab_amnesty
· Support contact https://github.com/Makilesh/Chrome_tab_amnesty/issues · Mature content: no.

**Privacy:** the same five sections as Chrome. Paste the single purpose, the permission table,
"No, I am not using remote code", the same three data boxes and the same certifications. For the
privacy policy URL, see the first item under "Before submitting to Edge".

**Store listing (English).** Edge requires that an extension "must not reference other browsers",
so this description names none. 250 to 10,000 characters; one line per paragraph:

```text
Close it, you'll still have it.

Tab Amnesty is a memory for your browser. It notices which tabs belong together — the ones you opened from one another, in one sitting, and switched between — and shows them as groups named after what you were doing: "Lisbon", "asyncio", "Job search".

Each group has one button: Archive & close. It writes everything down first — every page, its title, what it said — and only then closes the tabs. Changed your mind? Bring back puts the whole group back on your tab strip, in its order, for a day, even after a restart. After that, Open all brings it back whenever you like.

What it keeps, and why — on your computer only, never sent anywhere, and nothing at all until you press Start on the page it opens when installed:
• For each tab in a normal window: its address, title and site; when it was opened, which page it was opened from, and when you switched to it and for how long. That is how it tells one project from another.
• How each visit started (a link, a typed address, a bookmark), as the browser reports it when the page loads. It does not read your browsing history.
• A short digest of each page — its description, headings and opening lines — so a group can be named and a page found again.
• Whether a text box you typed into still holds unsent text: a yes or no, never the text.
• Mail, chat, calendar, search and message pages on its built-in list keep no title or text. Records of pages you close yourself go after 30 days; what you put away stays until you forget it.

Find anything you put away by a word from its title, headings, opening lines or summary, its site, or the day.

Keep a copy: save everything you put away as one file that opens in any browser, and bring it back in on another computer.

Made for people who keep a lot of tabs open:
• Nothing closes unless you press Archive & close on that group.
• A tab holding a half-written message stays open.
• No counts, no streaks, no reminders.
• Forget this on every group and every page, and a list of sites it never remembers.

Private by design:
• Everything stays on your computer. No account, no server, no analytics, no network requests.
• Group names come from the pages' own titles. Where the browser has a built-in on-device language model (in Microsoft Edge still a preview), it names groups and writes short summaries, on your computer.
• It never runs in InPrivate windows.
• Open source: https://github.com/Makilesh/Chrome_tab_amnesty
```

- **Extension logo:** 1:1, 300×300 recommended, 128×128 minimum. Render `public/icons/icon.svg`
  at 300; the 128 PNG meets the minimum.
- **Small promotional tile** 440×280: `docs/store/promo-440x280.png`. Large tile 1400×560:
  optional.
- **Screenshots,** up to 6, at 640×480 or 1280×800: the five in `docs/store/screenshots/`.
- **Search terms,** up to 7, at most 30 characters each and 21 words in all, never shown to users:
  `tab manager` · `tab groups` · `save tabs` · `archive tabs` · `restore tabs` · `search tabs` ·
  `browser memory`.

**Notes for certification.** The same text suits Chrome's Test instructions tab, which is
optional and meant mainly for logins:

```text
No account, sign-in or server: everything runs on the computer, and the extension makes no network requests.
1. Install. Open a page and three or four of its links in new tabs (for example a docs.python.org page). Then type an unrelated address and open a few of its links.
2. Click the Tab Amnesty toolbar icon. The extension's own page opens in a tab and shows the open tabs grouped by what they were for, each group with one Archive & close button. Tabs that belong to no group are under "On their own".
3. Press Archive & close on a group. Its tabs close and a card appears under "Put away". Bring back, on the card or in the message, reopens them as a named tab group.
4. Type a word from one of those pages into the search box under "Put away".
5. Type into a text box on some page without sending it, then press Archive & close on that page's group: that tab stays open.
6. "Keep a copy" saves everything put away as one HTML file where downloads go; "Bring in a copy…" reads one back.
Tabs open before installation are covered too. Names and summaries from the browser's on-device model appear only where the browser offers one; otherwise names come from page titles.
```

Certification takes up to seven business days.

**Before submitting to Edge:**
- [x] **A privacy policy that speaks of Edge** (done 11 Nov: browser-neutral, Chrome and Edge named
      where they differ, Edge's developer policies beside the Chrome Web Store's). Edge's policy says the privacy policy "should
      primarily refer to the Microsoft Edge browser and not other browsers". PRIVACY.md is about
      Chrome throughout (Gemini Nano, "your Chrome profile", Chrome sync, the
      Chrome Web Store section). The simplest fix is to make it browser-neutral, with a line where
      the two differ. On Edge the on-device model is Microsoft's (Phi-4-mini, a preview there),
      and Edge downloads it from Microsoft. Add Edge's developer policies beside the Chrome Web
      Store statement. One URL then serves both stores.
- [x] **"Chrome" in the extension's own words** (done 11 Nov: "your browser", and the health notes
      name `edge://extensions` or `brave://extensions` where that is the browser). Four sentences on the sweep page name Chrome:
      the two health notes in `src/ui/sweep/index.html` (with `chrome://extensions`) and two
      tab-strip messages in `sweep.ts`. They show only in rare states, but on Edge they are wrong
      as well as against the rule. "Your browser" fixes both.
- [x] **On-device AI on Edge.** Edge's Summarizer and Prompt APIs are previews (Canary and Dev
      from 138.0.3309.2; they need 20 GB free and 5.5 GB of video memory). Expect title-based
      names and no summaries for most Edge users. The Edge description says so.
- [ ] **The repository's address contains "Chrome".** That is unlikely to matter. If certification
      objects, renaming the repository on GitHub fixes every link at once, because GitHub
      redirects the old address.

## Likely reviewer questions

Short answers, for the review notes or a reply to a rejection.

**Why does a tab organiser read every website?** Two features need a script that is already in
any tab that might be put away. One is the page digest (title, meta description, up to 20
headings, the first 1,000 characters of text) that names groups and makes put-away pages
searchable. The other is the check that a text box the user typed into is not still holding a
draft, so Archive & close never closes it. Both run on the computer, and nothing is sent. A
per-site or on-click grant would leave most tabs undescribed and drafts unprotected.

**Does it read browsing history?** No. Since 0.3.0 there is no `history` permission: how a visit
started comes from `webNavigation.onCommitted` as the page commits, for the tab's own top frame,
and only that one word is kept on the tab's record. Nothing is recorded before Start.

**Why `tabs` as well as host access?** So that addresses and titles of open tabs are still
visible when the user limits the extension's site access; grouping keeps working then. It adds
no warning.

**Why `scripting`?** Manifest content scripts reach only pages loaded after installation. On
install, update or being switched back on, the worker injects the same packaged file (`files`,
never a code string) into tabs that were already open, skipping discarded ones.

**Does it run remote code or talk to a server?** No. Everything is in the package, with no
`eval` and no `new Function`. The only `fetch` in the build is Vite's module-preload polyfill,
which loads the extension's own packaged scripts. `https://tab-amnesty.invalid/` is a Cache
Storage key and is never fetched. The code is minified, not obfuscated, and the full source is
on GitHub.

**Isn't that several purposes — grouping, putting away, search, summaries, a backup file?** It
is one: put away a whole project and get it back. Grouping decides what goes together. Search and
summaries are how a put-away project is found again. The copy file keeps what was put away safe
from a lost browser profile.

**How does the user agree to what it keeps?** Before installing, through the listing's "What it
keeps" block, the privacy section and the install prompt. Afterwards, the page says "Everything
is kept on this computer"; every group and page has Forget this; any site can be added to "Sites
never remembered"; and uninstalling removes everything. (If option (b) above is built, say so
here.)

**Why `offscreen` and `unlimitedStorage`?** Summarising several pages can outlast a service
worker, so the on-device Summarizer runs in an offscreen document. Put-away projects are kept
until the user forgets them; without `unlimitedStorage` the browser may evict them under storage
pressure.

**Does it use AI?** Only the browser's built-in on-device models, through the documented Prompt
and Summarizer APIs, to name groups and summarise pages the user put away. No AI service is
involved and nothing goes over the network. It does nothing to get around any model's
safeguards, the subject of the store's new 2026 rule on AI.

**The icon opens a tab. Is that a redirect?** No. It opens the extension's own page
(`chrome-extension://…/src/ui/sweep/index.html`), not a website.

**What is the "tester build" in the privacy policy?** A copy for a research study, built
separately. The store build has no study pages, and the packaging script refuses to finish if it
finds them.

**Does it change settings, the new tab page or search?** No. It overrides nothing. It reads tabs
and, when the user clicks, closes, groups and reopens them.

## Sources (checked 10 November 2026)

- Install-prompt strings and rules: [permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list),
  [permission warnings](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings),
  Chromium [`chrome_permission_message_rules.cc`](https://github.com/chromium/chromium/blob/main/chrome/common/extensions/permissions/chrome_permission_message_rules.cc)
  and [`generated_resources.grd`](https://github.com/chromium/chromium/blob/main/chrome/app/generated_resources.grd).
- Chrome Web Store policy: [2026 policy updates](https://developer.chrome.com/blog/cws-policy-updates-2026),
  [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements),
  [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use),
  [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
  [Privacy Policies](https://developer.chrome.com/docs/webstore/program-policies/privacy),
  [Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies),
  [Listing Requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements),
  [violation codes](https://developer.chrome.com/docs/webstore/troubleshooting),
  [trader declaration](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure).
- Chrome Web Store dashboard: [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
  [listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing),
  [best listing](https://developer.chrome.com/docs/webstore/best-listing),
  [images](https://developer.chrome.com/docs/webstore/images),
  [prepare](https://developer.chrome.com/docs/webstore/prepare),
  [review process](https://developer.chrome.com/docs/webstore/review-process),
  [test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions),
  [publish](https://developer.chrome.com/docs/webstore/publish),
  [update](https://developer.chrome.com/docs/webstore/update).
- Edge: [publish](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension),
  [developer account](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account),
  [porting](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension),
  [supported APIs](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support),
  [developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies),
  [Writing Assistance APIs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/writing-assistance-apis).
