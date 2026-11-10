# Tab Amnesty — launch kit

For the owner. Researched 9–10 November 2026 from each product's own store listing, site or help
page wherever it would load; every claim links to where it came from. Nothing in this file has
been posted, submitted or created, and no account was made.

- **§0** is the plan on one page. **§1** is the honest landscape. **§2** is positioning you can
  paste. **§3** has the launch drafts, each with the venue's rules. **§4** is GitHub
  discoverability and the README changes, in exact text.
- Store submission (Chrome Web Store and Edge Add-ons) is in
  [docs/store/LISTING.md](../store/LISTING.md). This file does not repeat it.
- **Voice.** Every draft follows CLAUDE.md §6 and `.ux-profile.md`: no tab count presented as a
  problem, no streaks, nothing that characterises anyone's browsing, none of the five banned words,
  no exclamation marks, no health claims. The banned words appear in this file only inside a
  competitor's own feature name (Chrome's "tab declutter"), never in copy meant for the public. The
  one number of tabs in any draft is the measurement protocol's "80+ tabs", in the optional ask in
  §3.1.
- **What I could not read first-hand:** Reddit (it blocks the tools I have, both fetch and
  search), Arc's help centre (403) and Chrome's Tab organizer help page (it redirected to the
  help home). Those facts come from search-indexed copies and are marked where used.

---

## 0. The plan on one page

### The three highest-leverage actions

1. **Make it one click to install before any big post.** Today the only install is Developer
   mode → Load unpacked from a zip, with updates by hand. Most people arriving from Product Hunt or
   an ADHD community will stop there, and Show HN readers expect to try a thing in a minute.
   Publishing needs two decisions only you can make (LISTING.md, "Before submitting"): whether
   CLAUDE.md's rule — read the Phase 0 gate before any store submission — still holds, and how to
   handle in-product disclosure, (a) or (b). The Chrome Web Store costs a one-time
   [$5](https://developer.chrome.com/docs/webstore/register); review is "within a few days, but
   it can take up to a few weeks", longer for "broad host permissions"
   ([review process](https://developer.chrome.com/docs/webstore/review-process)). Edge Add-ons is
   [free](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
   and takes the same zip.
2. **Fix the front door.** Checked 10 November: the repository has no description, no topics, no
   website, GitHub's default social image, and 2 stars. Every link you post lands there. It takes
   fifteen minutes in Settings (§4.1–4.3), a 15-second GIF and an FAQ that answers Chrome's
   permission warning before anyone asks (§4.4–4.5).
3. **On Hacker News, lead with the idea and the honesty, not "a tab manager".** In the two
   Algolia searches I ran, Show HN tab tools since January 2025 topped out at 13 points, and two
   local-first, open-source Chrome tab managers posted in August and September 2026 got 1 point
   each (§3.1). What nobody else has posted: a claim that can be measured ("a project is not a
   topic"), the protocol that could prove it wrong, a result on your own browser that went against
   it, and the Chrome platform traps you hit. Write it by hand — HN's 2026 rule — and follow up a
   week or two later with a technical write-up as an ordinary link (§3.6).

### Before anything public (yours to do)

- [ ] **Publish the v0.1.1 release on GitHub.** Releases still offers only 0.1.0, whose content
      script is web-accessible: pages could tell it is installed. 0.1.1 fixes that (CHANGELOG).
      Put the GIF in the release notes.
- [ ] **Decide the two store blockers** in LISTING.md, then submit to the Chrome Web Store and Edge
      Add-ons. Untick automatic publishing, so you choose the day it goes live.
- [ ] **Repository settings** (§4.1–4.3): description, topics, website, social preview,
      Discussions on.
- [ ] **README changes** (§4.4) and **the demo GIF** (§4.5).
- [ ] **Pick a launch day** you can spend answering comments for six to eight hours.
- [ ] **Match the drafts to what ships.** They say 0.1.1; change it to the version you release. On
      10 November a change in progress (staged in the working tree, not committed) adds search
      from the address bar (`ta`, Tab, a word) and an Alt+Shift+K shortcut. If it ships, add one
      line to §3.2, §3.4 and post 4 of §3.5: "Or search from the address bar: type ta, press Tab,
      then a word."

### Order of launch

| When | What | Why this order |
|---|---|---|
| Day 0 | Store listing live (or at least approved), v0.1.1 released, README done | Every post sends people to the README and an install button |
| Day 1 | Show HN (§3.1) | The audience most likely to star; needs you at the keyboard |
| Day 2 | r/chrome_extensions (§3.2) | Small, friendly to makers; different readers from HN |
| Day 2–3 | Mastodon, Bluesky, X thread (§3.5) | Carries the GIF; links back to the repository |
| Day 3–5 | awesome-adhd-tools, mrseth01/awesome-adhd, the zero-telemetry list, AlternativeTo (§3.7) | Slow, lasting traffic; eligible now |
| Day 3 | Modmail to r/ADHD (§3.3); post only if they say yes | Their rules come first |
| Week 2–3 | Technical write-up (§3.6) → HN as a normal link, dev.to; Lobsters only with an invite | A second, different reason to look |
| Once the store listing is live | themeselection/best-chrome-extensions (§3.7) | It needs a store link |
| Week 3–6 | Product Hunt (§3.4), once the store listing has a few reviews | PH visitors install from a store or not at all |
| After a few stable weeks in the store | Nominate for the Featured badge (§3.7) | Needs a public listing with no violations |
| May 2027 | XargsUK/awesome-adhd (§3.7) | Six months public, plus evidence of use |

### Don't

- Ask anyone to upvote, or have friends post supportive comments. HN: "Don't solicit upvotes,
  comments, or submissions"; Product Hunt: "Please upvote!" breaks its rules (§3.1, §3.4).
- Paste AI-written text into HN, or answer HN comments with it (§3.1).
- Post in r/ADHD without the moderators' yes (§3.3).
- Say it groups "better than Chrome's organiser". That is the open Phase 0 question.
- Present a number of tabs as a problem, or use "hoarder", "chaos", "overwhelmed" or the banned
  words — in posts, replies, images or the GIF.
- Pay for a directory's fast track.

---

## 1. Landscape

### 1.1 At a glance

User counts and ratings are from each Chrome Web Store page on 10 November 2026 unless noted.

| Product | What it is | Strengths (and praise) | Weaknesses (and complaints) |
|---|---|---|---|
| **OneTab** — 2,000,000 users, 3.8 (14.6K ratings), updated 11 Oct 2026 | Sends your tabs into a list. Version 2 (out to all users "around March 2026") added folders, a search bar and optional end-to-end-encrypted sync; "No signup or registration required" ([site](https://www.one-tab.com/), [help](https://www.one-tab.com/help)) | One click; memory ("Save up to 95% memory"); simple; reviews from late October call it "a must have" ([reviews](https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall/reviews)) | Saved tabs that "simply disappear" (3 Nov 2026) or were removed "without notice" (18 Oct 2026); after a corrupted v2 database, recovery needs a backup of the browser profile ([troubleshooting](https://www.one-tab.com/troubleshooting)); favicons fetched through "Google's favicon generator" by domain, and "share as a web page" uploads a list ([privacy policy](https://addons.mozilla.org/en-US/firefox/addon/onetab/privacy/)); the list becomes a place nobody reopens ("the list itself becomes a graveyard" — said in [a competitor's launch post](https://dev.to/alogach/87-tabs-open-i-cant-close-any-of-them-5cl1)) |
| **Session Buddy** — 1,000,000 users, 3.3 (25.1K), updated 28 Apr 2026 | Saves windows as collections; crash recovery; export in 15+ formats ([store](https://chromewebstore.google.com/detail/session-buddy/edacconmaakjimmfgnblocblbcdcpbko)); data on the device, anonymous usage counts unless switched off ([privacy](https://sessionbuddy.com/privacy-policy/)) | Saves and restores whole sessions; recovers after a crash; exports in many formats | Version 4 arrived by auto-update and left out v3 features; the developer: "we could have done a better job communicating them" ([v4 FAQ](https://www.sessionbuddy.com/v4-faq), [user thread](https://groups.google.com/g/sessionbuddy-discuss/c/LZUhE5tSOHw)) |
| **Toby** — 300,000 users, 3.6 (3.3K), updated 26 Oct 2026 | Collections of saved tabs on a board, notes, search; sign-in for sync ([store](https://chromewebstore.google.com/detail/toby-for-chrome/hddnkoipeenegfoeaoibdmnaalmgkpip)). Free up to 60 saved tabs, then $4.50–$6 a month ([pricing](https://www.gettoby.com/pricing)) | Visual collections, quick to reopen a set | Going paid after saying it would stay free, and the price (an Oct 2024 r/chrome thread, `reddit.com/r/chrome/comments/1g0jc6w`, seen through search results); the free-tier cap |
| **Workona** — 200,000 users, 4.2 (3.8K), updated 9 Oct 2026 | "Spaces organize your work by project", autosave, "Sync your tabs between computers" ([store](https://chromewebstore.google.com/detail/workona-spaces-tab-manage/ailcmbgekjpnablpdkmaaccecekgdhlh)); paid Pro and Team plans ([pricing](https://workona.com/pricing/)) | Project-shaped; reviewers like getting a previous task's tabs back | Needs an account (user reports on its Firefox listing); free-plan limits ("only has 5 workspaces", [Capterra](https://www.capterra.co.uk/reviews/197971/workona)); slowness and crashes in some reviews |
| **Tabs Outliner** — 100,000 users, 3.2 (3.3K), updated 23 Jul 2026 | A tree that links each tab to the tab it was opened from; close-and-save in place; one-time payment for backups and shortcuts ([store](https://chromewebstore.google.com/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl)) | Power; the opener tree; crash recovery | Complicated and dated (Workona's own review of it, so not neutral: [link](https://workona.com/reviews/tabs-outliner-chrome-firefox/)); 2025 reviews of breakage after Chrome updates ([reviews](https://chromewebstore.google.com/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl/reviews)) |
| **Tab Stash** (Firefox) — 40,140 users, 4.6 (609 reviews), updated 14 Sep 2026 | Saves tabs as bookmarks, so Firefox Sync carries them; no account; MPL-2.0, about 1.1k GitHub stars ([AMO](https://addons.mozilla.org/en-US/firefox/addon/tab-stash/), [GitHub](https://github.com/josh-berry/tab-stash)) | Open source, no lock-in, bookmarks underneath | Firefox only; the Chrome port is "highly-experimental", built from source |
| **Skipper** (formerly Skeema, from the Carnegie Mellon group behind the CHI 2021 study) — 8,000 users, 3.7 (59), Featured badge, updated 29 Mar 2026 | "Tab management that works with ADHD brains"; Pro: "AI-powered Sessions that automatically group your tabs based on how you browse" ([store](https://chromewebstore.google.com/detail/skipper-tab-management-th/cjiinmicahhdcmfpdohhaahgkdiehfga)); "automatically saves and closes tabs you haven't used in a while"; Pro is a waitlist ([site](https://skipper.co/)) | Research pedigree; aimed squarely at ADHD; team sharing | Its listing declares personally identifiable information, web history, user activity and website content ([privacy tab](https://chromewebstore.google.com/detail/skipper-tab-management-th/cjiinmicahhdcmfpdohhaahgkdiehfga/privacy)); "powered by Google's Firebase", third-party analytics and "session replay scripts" ([policy](https://www.skipper.co/privacy-policy)) |
| **Chrome tab groups** | Built in; saved groups sync across devices | No install; part of the browser | You make every group yourself; saved groups going missing after a restart or update ([2022 report](https://www.androidheadlines.com/2022/11/google-fixed-saved-chrome-tab-groups-issue.html), still a recurring forum topic) |
| **Chrome "Organize tabs"** (Tab organizer, since M121) | "Chrome will automatically suggest and create tab groups based on your open tabs", with names and emoji ([Google, Jan 2024](https://blog.google/products/chrome/google-chrome-generative-ai-features-january-2024/)) | One click from Tab search | US only, 18 and over, signed in; "Only one suggested group will display at a time"; page titles, URLs and tab-group data of the window's tabs are collected ([help page](https://support.google.com/chrome/answer/14519765), from its indexed text) |
| **Chrome "tab declutter" / inactive tabs** | Android: tabs unused for 14 days move to "Inactive" and "are automatically closed after 6 months" unless switched off ([help, Android](https://support.google.com/chrome/answer/2391819?hl=en&co=GENIE.Platform%3DAndroid)). Desktop: a prompt to close tabs untouched for 7 days was tested in 2024–25 ([report](https://windowsreport.com/this-is-how-desktop-chromes-new-feature-lets-you-declutter-tab-bar/)); late-2026 reports disagree on whether it is still there | Needs no effort | Closes things on a timer |
| **Firefox AI tab groups** | A local model suggests a name and similar tabs for a group you start; "entirely on your own device" ([Mozilla, Nov 2025](https://blog.mozilla.org/en/firefox/ai-tab-groups/)) | On-device | Groups by similar titles (topic), one group at a time, Firefox only |
| **Opera Tab Islands** | "When opening new tabs from a webpage, those tabs are automatically grouped together into an island" ([Opera](https://blogs.opera.com/news/2023/06/opera-tab-islands/)) | Automatic, by opener | Opera only; by opener alone, so tabs you type an address into are not joined to anything |
| **Arc auto-archive** | Idle unpinned tabs are archived after 12 hours by default and the feature cannot be switched off ([Arc help](https://resources.arc.net/hc/en-us/articles/19228855311127), from its indexed text). Arc has had no new features since May 2025; Atlassian bought its maker ([AlternativeTo](https://alternativeto.net/news/2025/9/atlassian-acquires-the-browser-company-creator-of-the-arc-and-dia-ai-powered-browsers)) | The idea is copied widely: "Arc-like" archiving extensions for Chrome and Zen | "Why can I not disable tab archiving" (r/ArcBrowser, Nov 2023, `reddit.com/r/ArcBrowser/comments/17xhkpy`); tabs gone after the timer |
| **Zen** | No built-in archive found; add-ons copy Arc's: [Zen Tabs Cleaner](https://addons.mozilla.org/firefox/addon/zen-tabs-cleaner/) closes idle tabs after 12 hours; [zenArkive](https://addons.mozilla.org/en-US/firefox/addon/zenarkive/) keeps old tabs in a sidebar | Choice | Same timer problem as Arc |
| **Sidekick** (a "work browser" with sessions and tab suspension) | Reported shut down on 3 August 2025, its team gone to Perplexity's Comet ([WebCatalog](https://webcatalog.io/en/blog/singlebox-vs-sidekick); secondary sources only) | Sessions per task | Gone; switching browsers to manage tabs is a big ask, and such browsers come and go |

Also seen: [Tab Session Manager](https://chromewebstore.google.com/detail/tab-session-manager/iaiomicjabeggjcfkbimgmglanimpnae)
(100,000 users, auto-save, cloud sync), and many new "AI tab organizer" extensions that group by
title and domain. Chrome is testing "Ask Gemini about this group" in Canary
([July 2026](https://www.androidauthority.com/chrome-tab-group-gemini-integration-3689297/)), and
its AI history search is semantic but sends queries to Google and launched in the US first
([9to5Google](https://9to5google.com/2024/08/01/chrome-ai-history-search/),
[Windows Latest](https://www.windowslatest.com/2025/02/25/google-chrome-briefly-tests-ai-powered-history-feature-outside-the-us-on-windows-11/)).

### 1.2 Where Tab Amnesty stands out

- **It finds the projects for you, from behaviour, across sites, for every open tab at once.**
  Chrome's organizer and Firefox's AI suggest groups of similar tabs, one group at a time. Opera groups
  by opener only, inside Opera. Tabs Outliner shows the opener tree and leaves the organising to
  you. Skipper's behaviour-based sessions are a Pro feature behind a waitlist, on Firebase. Tab
  Amnesty combines the opener, timing, switching, strip position and page text.
- **Putting away keeps what each page said, and search reads it.** Most savers keep an address
  and a title. Tab Amnesty keeps a short digest — description, headings, the first 1,000 characters —
  and finds a page by a word from it.
- **Nothing closes on its own, and drafts are safe.** Arc archives on a timer you cannot turn
  off; Skipper closes tabs you haven't used; Chrome on Android closes inactive tabs after six
  months by default. Tab Amnesty closes only the group whose button you press, and leaves a tab
  with a half-written message open.
- **Nothing leaves the computer, and anyone can check.** No network requests at all, open
  source. OneTab fetches icons from Google by domain; Session Buddy sends anonymous usage counts
  by default; Chrome's organizer sends titles and addresses to Google; Toby, Workona and Skipper
  are account-and-cloud products.
- **A copy that works without the extension.** "Keep a copy" is a plain HTML page that opens in
  any browser — an answer to the complaint that follows every saver: this month's OneTab reviews,
  Session Buddy's v4.
- **A published design contract for ADHD.** No counts, streaks or reminders; nothing to name; at
  most five decisions on screen; events, not dates. The only other tool marketed to ADHD users,
  Skipper, closes tabs by itself.
- **Free, with no tiers. MIT.**

### 1.3 Where it is weaker

- **Install.** Not in a store yet: Developer mode, Load unpacked, and manual updates (switch it
  off and on). This alone loses most people who are not developers.
- **The install prompt.** "Read and change all your data on all websites" and "Read and change
  your browsing history on all your signed-in devices" (LISTING.md). Accurate about reach,
  alarming in tone; the second overstates what happens (it only reads, and only open tabs'
  addresses). LISTING.md weighs replacing `history` with `webNavigation` later.
- **The central claim is unmeasured.** The Phase 0 gate is open. On a real browser, one
  project done in the gaps between other work was split across four groups — a case where topic
  would have done better (PHASES.md, 5 October). HN will ask; say it first.
- **Cold start.** Opener and switching exist only for tabs opened while it is installed. Tabs
  already open group by timing, site and text until you have browsed for a few days.
- **Names.** Chrome's model needs "at least 22 GB of free space on the volume that contains your
  Chrome profile" and 16 GB of RAM with four cores, or a GPU with more than 4 GB, on desktop
  ([Google](https://developer.chrome.com/docs/ai/get-started)). Your own machine did not qualify.
  Most people will see names taken from the pages' titles. On Edge the model is a preview.
- **Search** matches the start of words in the digest, not whole pages, and is not semantic.
- **It does not hand things back yet.** §6.11 says the archive must volunteer; resurfacing is not
  built or approved. Until then it is search and restore, and the doom-box risk is real.
- **Gaps others fill:** no sync (by design), no phone, Chromium only, no sharing with a team, no
  notes.
- **Trust.** One maintainer, version 0.1.x, 2 stars, no store reviews. The repository openly shows
  it was built with Claude Code (CLAUDE.md, DECISIONS.md); expect questions on HN and answer
  plainly.

### 1.4 What this means for the message

- Lead with what is certain: nothing closes unless you press; everything is kept with what each
  page said; you can find it again; nothing leaves your computer.
- Present grouping by behaviour as the idea being tested, not as a proven win. Never "better than
  Chrome".
- For ADHD audiences: the design rules, not diagnoses or benefits. No "for ADHD brains", no talk
  of symptoms or treatment.
- For developers: the platform traps and the measurement.

---

## 2. Positioning

**Tagline** (keep): Close it, you'll still have it.

**One line:**

> Put a whole project of tabs away in one click — kept, searchable, and back whenever you want.
> Nothing leaves your computer.

**Two sentences:**

> Tab Amnesty notices which of your tabs belong together — the ones you opened from one another,
> in one sitting, and switched between — and shows them as groups named after what you were
> doing. One click puts a whole group away with every page written down first, so you can search
> for it later and bring it back in order, and nothing ever leaves your computer.

**Comparison table for the README** (paste under a heading "How it compares"; every cell is from
the sources in §1.1):

```markdown
## How it compares

| | Tab Amnesty | OneTab | Session Buddy | Toby | Workona | Chrome's Organize tabs |
|---|---|---|---|---|---|---|
| Finds which open tabs belong together | Yes, from which tab opened which, when, what you switched between, and page text | No: each save becomes a list you can file into folders | No: saves windows and collections | No: you file tabs into collections | No: you set up a space per project | Suggests a group of similar tabs, one at a time |
| Account | None | None needed | None | Sign-in for sync | Workona account | Google account, in the US, 18 and over |
| What leaves your computer | Nothing: no network requests | Site names, to fetch icons from Google; a list, if you share or sync it | Anonymous usage counts, unless you switch them off | Your collections, when signed in | Your tabs, synced between computers | Titles and addresses of the window's tabs, to Google |
| Price | Free | Free | Free | Free up to 60 saved tabs, then from $4.50 a month | Free plan; paid plans | Built in |
| Source | Open (MIT) | Closed | Closed | Closed | Closed | — |

Checked 10 November 2026 against each product's own store listing, site or help page —
[tell us](https://github.com/Makilesh/Chrome_tab_amnesty/issues) if something has changed. Others
group tabs for you too: Opera's Tab Islands by which tab opened which, Firefox's on-device AI by
similar titles, and Skipper's Pro sessions "based on how you browse".
```

**Words.** Use: put away, bring back, open all, keep a copy, forget this, never remember, kept,
on your computer, what you were doing. Avoid: the five banned words, numbers about anyone's tabs,
hoarder, chaos, overwhelm, guilt, finally, smart, AI-powered (say "Chrome's on-device model").

---

## 3. Launch drafts

### 3.1 Show HN

**Rules** ([Show HN](https://news.ycombinator.com/showhn.html),
[guidelines](https://news.ycombinator.com/newsguidelines.html),
[dang's advice, edited 2026](https://news.ycombinator.com/item?id=22336638)):

- "Show HN is for something you've made that other people can play with" — "ideally without
  barriers such as signups or emails". A Load-unpacked zip qualifies; a store link is better.
- "Drop any language that sounds like marketing or sales." Include "the backstory of how you came
  to work on this, and explaining what's different about it."
- **"Write your text by hand. Don't use an LLM to generate any of it (not even a tiny bit,
  including to edit or spruce it up)."** So below is a fact sheet and an outline, not text to
  paste. Treat the titles as examples and type your own.
- "Don't solicit upvotes, comments, or submissions." No booster comments from friends. Don't use
  the project's name as your username.

**Reality check** (HN Algolia, 10 November 2026). Since January 2025 the best-scoring Show HN tab
tools reached 13 points (TabTab, April 2025) and 9 points ("I was drowning in browser tabs",
June 2026). "Shelf, a local-first open-source tab manager for Chrome"
([15 Sep 2026](https://news.ycombinator.com/item?id=49708806)) and "I built a local-first,
open-source tab manager for Chrome" (18 Aug 2026) got 1 point each; "Raft – Open-source tab
manager because extensions have trust issues" and "Tab Atlas – A visual tab manager that never
auto-closes your tabs" got 2. Private, open source and never-closes are table stakes there. The
one tab post with real discussion, Advanced Tab Manager for Firefox
([2023, 94 points, 87 comments](https://news.ycombinator.com/item?id=37306058)), drew questions
about access to all websites, reading the source before installing, and "just close your tabs".

**Title examples** (all under HN's 80 characters):

- `Show HN: Tab Amnesty – grouping browser tabs by behaviour, not topic` (68) — recommended: it is
  the part HN has not seen.
- `Show HN: Tab Amnesty – group tabs by how you opened them, put a project away` (76)
- `Show HN: Tab Amnesty – close a project's tabs, keep everything on your computer` (79)

**Link:** the repository, not the store page — people will read the code. If your text does not
show at the top of the submission, post it as the first comment (dang's advice).

**Outline — write each point in your own words:**

1. What it is in one or two sentences, and how to try it (store link, or the v0.1.1 zip and Load
   unpacked).
2. Why you built it: your own reason; the CHI 2021 finding that people keep tabs open because
   closing feels like losing ("blackhole effect",
   [CMU](https://www.cmu.edu/news/stories/archives/2021/may/overcoming-tab-overload.html)).
3. The idea: a project is not a topic. It is a burst of tabs opened from one another, in one
   sitting, that you switch between — all visible to an extension without reading pages. The
   opener has to be caught when the tab is created (`openerTabId` is gone after a restart);
   timing, switching and strip position come from tab events; page text is one signal among
   several. A deterministic Louvain over a weighted graph; the same clusterer exists in Python,
   where signals are changed first, with a parity check between the two.
4. What Archive & close does: writes each page's digest (title, description, headings, first
   1,000 characters), then closes; a tab with an unsent draft stays open; Bring back survives a
   restart for a day; Keep a copy is a plain HTML file.
5. Two platform traps (pick the best): MV3 workers die after 30 s idle, so nothing lives in
   memory; Memory Saver discards tabs with no event, so it never reloads a tab to read it; tab ids
   are reused after a restart, so every record has its own id; an old service worker kept running
   against a database a newer page had upgraded and recorded nothing for two weeks; Chrome
   replaced the extension's IndexedDB once, which is why there is a second copy in Cache Storage;
   Gemini Nano needs 22 GB free, so your own machine gets title names.
6. What is not proven: the test it has to pass — beat Chrome's organiser by at least 0.15 ARI on
   four of five real browsers with 80+ tabs, and show the behavioural signals matter — has not
   been run. On a real browser, one project done between other work split into four groups; topic
   would have won there. Tabs open before install group loosely at first.
7. Privacy: no network requests; why it asks for all websites and history; MIT.
8. What you want: where it groups wrongly (describe the shape, not the titles). Optionally, people
   with 80+ tabs in a US Chrome that offers Organize tabs who would help run the measurement
   (docs/RESEARCH.md). Only ask if you are ready to handle their shareable exports: they drop page
   text and query values but keep sites and paths.

**Facts to have ready for comments** (answer by hand):

- *Why not bookmarks?* Bookmarks ask where each thing goes, one at a time. This takes a whole
  group, keeps the digest, and never asks you to name anything.
- *Why all-sites access and history?* The digest and the draft check need the content script in
  every tab that might be put away; history is read only for open tabs' addresses, never written
  (LISTING.md, "Likely reviewer questions").
- *Does it call home?* No network requests; the only `fetch` in the build is Vite's
  module-preload polyfill for its own packaged scripts (LISTING.md).
- *How do you know the grouping works?* You don't yet: protocol in docs/RESEARCH.md, your result
  in PHASES.md.
- *Why not embeddings or an LLM for grouping?* Measured: a small model judged same-project pairs
  at AUC 0.54–0.65 and added nothing to the free signals; Gemini Nano helps naming, not grouping
  (DECISIONS 2026-10-05, docs/research-jev-laya.md).
- *Firefox? Sync? Phone?* No, no (Keep a copy instead), no.
- *Built with AI?* The repository shows Claude Code was used. Say how you worked with it.

### 3.2 r/chrome_extensions

**Status: probably allowed — check first.** I could not read the subreddit's rules (Reddit blocks
my tools). A third-party summary ([Thread Otter](https://www.threadotter.com/subreddit-rules/chrome_extensions),
checked August 2026) classes it as allowing self-promotion and links but says it could not see the
rules text. Before posting, read the sidebar, the rules and any pinned post; use the flair it asks
for; post once.

**Title:** Tab Amnesty: put a whole project of tabs away in one click and get it back later (open
source, nothing leaves your computer)

**Body:**

> I made a Chrome extension for the tabs you keep open because closing them feels like losing
> them.
>
> **What it does**
> - Groups your open tabs by what you were doing: tabs you opened from one another, in one
>   sitting, and switched between count as one project, even across sites. Names come from
>   Chrome's on-device model if your computer has it, otherwise from the pages' own titles.
> - One button per group, **Archive & close**. It writes each page down first (address, title,
>   description, headings, opening lines), then closes the tabs. A tab with a half-written message
>   stays open.
> - **Bring back** restores the group in order for a day, even after a restart; **Open all** works
>   any time after.
> - Search what you put away by a word from a page's title, headings or opening lines, its site,
>   or the day.
> - **Keep a copy** saves everything you put away as one HTML file that opens in any browser.
>
> **Privacy:** no account, no server, no analytics, no network requests. It never runs in
> incognito. Mail, chat and search pages keep no title or text. MIT licensed.
>
> **Honest limits:** it's 0.1.1. Tabs that were open before you install it group more loosely
> until you've browsed for a few days.
>
> Install: [Chrome Web Store link] · or the zip from
> [Releases](https://github.com/Makilesh/Chrome_tab_amnesty/releases/latest) (Developer mode →
> Load unpacked). Code: https://github.com/Makilesh/Chrome_tab_amnesty
>
> I'd like to hear where it groups things wrong — describe the shape rather than pasting your
> titles.

### 3.3 r/ADHD

**Status: treat as not allowed.** I could not read the rules page (Reddit blocks my tools), but
every second-hand source agrees: [ReplyHey](https://www.replyhey.com/subreddits/ADHD) ("Self-promotion
is restricted by this subreddit's rules", checked 27 September 2026);
[HuntComments](https://huntcomments.com/r/adhd/rules) (regulars downvote "anything that reads as an
advert"); and a [subreddit guide](https://github.com/soarsh/awesome-productivity-subreddits/blob/main/README.md)
that says "I built an ADHD app" posts are removed at once, sometimes with a ban (it cites no rule).
So: read the sidebar yourself, send modmail, and post only with a written yes, where they say.
Don't use comment replies to get round a no-promotion rule.

**Modmail** (subject: *Question before posting: a free, open-source browser extension*):

> Hi mods. I made a free, open-source browser extension (Chrome, Edge, Brave) built around
> ADHD-friendly rules: nothing closes unless you press a button, no counts or streaks, nothing to
> name, and nothing leaves your computer. There's no paid tier, no account and no tracking.
> Before posting anything I'd like to ask: is there a place in r/ADHD where sharing it is OK — a
> weekly thread or a particular flair — or would you rather I didn't? I'll follow whatever you
> say. Link for context: https://github.com/Makilesh/Chrome_tab_amnesty

**Post, only if approved:**

**Title:** A free, open-source browser extension for closing a whole project of tabs without
losing any of it

> [Keep if the mods asked for it: Posted with the mods' OK.]
>
> [Only if true for you: I have ADHD, and] closing a tab often feels like losing it, so it stays
> open. I made a small, free tool for that feeling.
>
> When you click it, it shows your open tabs grouped by what you were doing, each group with one
> button: Archive & close. Before anything closes, it writes each page down, so you can find it
> again later by a word from it, or bring the whole group back in one click.
>
> Things it never does, on purpose:
> - close anything unless you press the button (and a tab with a half-written message stays open)
> - show how many tabs you have, keep streaks, or send reminders
> - ask you to name or sort anything
> - send anything anywhere: no account, no tracking, everything stays on your computer
>
> It isn't a fix for anything — just one way to make closing tabs feel safer. Free and open
> source: https://github.com/Makilesh/Chrome_tab_amnesty
>
> If you try it, I'd like to know what felt hard or confusing.

Other ADHD subreddits (r/ADHD_Programmers, r/adhdwomen and others) have their own rules, which I
could not read either; the same modmail-first approach applies.

### 3.4 Product Hunt

**Rules** ([build your product page](https://help.producthunt.com/en/articles/17834537-4-build-your-product-page)):
name up to 40 characters, tagline up to 60 (what the product does, without hype like "the best"),
description up to 500, maker's first comment up to 5,000, up to 3 launch tags, at least one
gallery image (1270×760 recommended; show the product in use), pricing recommended. "Please
upvote!" breaks its rules; ask for feedback. Launch day is said to start at 12:01 a.m. Pacific
(third-party guides; not on an official page I could find). Launch only once the store listing is
live: these visitors install from a store or not at all.

- **Name** (11): `Tab Amnesty`
- **Tagline** (pick one): `Put a whole project of tabs away, and get it back later` (55) ·
  `Close tabs by project and keep everything, on your computer` (59) ·
  `Close it, you'll still have it: tabs kept on your computer` (58)
- **Description** (486 of 500):

  > Tab Amnesty groups your open tabs by what you were doing: the tabs you opened from one
  > another, in one sitting, and switched between. Each group gets one button, Archive & close,
  > which writes every page down first (address, title, opening lines) and only then closes the
  > tabs. Find it later by a word from a page or its site, and bring the whole group back in
  > order. Nothing closes unless you press. No account, no network requests: everything stays on
  > your computer. Free, open source.

- **Launch tags:** Chrome Extensions · Productivity · Open Source (or Privacy instead of Open Source)
- **Pricing:** Free
- **Gallery:** the sweep page, search, a Keep a copy file open in a browser, the GIF (§4.5) —
  re-exported at 1270×760 from the made-up browsing the README uses.
- **Maker's first comment** (personalise the bracketed parts):

  > Hi, I'm [name]. I made Tab Amnesty because [your reason, in a sentence].
  >
  > A Carnegie Mellon study (CHI 2021) found people keep tabs open because closing one feels like
  > losing it. So Tab Amnesty makes closing safe: before anything closes, it writes each page down
  > — address, title, its opening lines — and gives everything back by search or in one click.
  >
  > What's different:
  > • It finds the projects for you, from how you browsed: tabs you opened from one another, in
  > one sitting, and switched between, even across sites.
  > • One button per project: Archive & close. Nothing closes unless you press it, and a tab with
  > a half-written message stays open.
  > • Bring back puts a group back, in order, for a day, even after a restart. Open all works any
  > time after.
  > • Keep a copy saves everything as one file that opens in any browser.
  > • No account, no server, no analytics, no network requests. Open source (MIT).
  >
  > Honest limits: it's early (0.1.1). Tabs that were open before you install it group more
  > loosely until you've browsed for a few days, and names come from Chrome's on-device model only
  > on computers that can run it — otherwise from the pages' own titles.
  >
  > I'd like to hear where it groups things wrong, and what felt confusing.
  > https://github.com/Makilesh/Chrome_tab_amnesty

### 3.5 Thread for X, Bluesky and Mastodon

Six posts; each fits X's 280 characters (the longest is 259) and Bluesky's 300. Attach the GIF to
the first, with alt text: *"Tab Amnesty's page shows open tabs grouped as asyncio, kubectl rollout
and Sourdough. Archive & close puts Sourdough away; searching 'fado' finds a Lisbon page; Open all
brings the Lisbon tabs back."*

1. I made Tab Amnesty, a free, open-source Chrome extension. It groups your open tabs by what you
   were doing and lets you put a whole project away in one click. Everything is kept, and nothing
   leaves your computer.
2. Why: closing a tab can feel like losing it, so it stays open. Carnegie Mellon researchers
   called it the black-hole effect (CHI 2021). Tab Amnesty writes down what each page was, its
   title and opening lines, before anything closes.
3. The groups come from how you browsed, not from topic: tabs you opened from one another, in one
   sitting, and switched between are one project, even across sites. Chrome's on-device model
   names them when your computer has it; otherwise the pages' own titles do.
4. Getting things back: Bring back puts a group back on your tab strip, in order, for a day, even
   after a restart. After that, Open all. Search finds a page by a word from its title, headings or
   opening lines. Keep a copy saves it all as one file you keep.
5. The rules it keeps: nothing closes unless you press the button. A tab with a half-written
   message stays open. No counts, no streaks, no reminders. Forget this on every group and page.
   No account, no server, no analytics. Designed with ADHD in mind.
6. It's early (0.1.1) and the grouping is still being measured, so I'd like to hear where it gets
   your groups wrong. Code, privacy notes and install: https://github.com/Makilesh/Chrome_tab_amnesty

On Mastodon, end the last post with `#OpenSource #Privacy #ChromeExtension #ADHD`.

### 3.6 The technical write-up (a second, different reason to look)

A post on your own site, GitHub Pages or dev.to, written by hand, submitted to HN as an ordinary
link one or two weeks after the Show HN ("It's ok to post your own stuff part of the time"), and to
Lobsters only if you have an invitation.

- **Title ideas:** "A project is not a topic: grouping browser tabs by how they were opened" ·
  "What Chrome does to an extension's memory: six traps"
- **Outline:** the CHI 2021 finding → the claim → the signals and why each is observable without
  reading pages → the clusterer, its Python mirror and the parity check → the measurement and
  what it cannot see → where it fails (a project interleaved with other work; pre-install tabs) → the platform
  traps (§3.1 point 5) → what it keeps, and why nothing is sent → what is measured next.

### 3.7 Directories and lists

| Where | Rules that matter | When |
|---|---|---|
| [Chrome Web Store](https://developer.chrome.com/docs/webstore/register) | $5 once; review in days to weeks; the full pack is in LISTING.md | First — after your two decisions |
| [Edge Add-ons](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) | Free; a personal Microsoft account; the listing may not name other browsers (LISTING.md) | Same week |
| [Featured badge nomination](https://developer.chrome.com/docs/webstore/discovery) | Through the One Stop Support form ("trialing"); the extension must be published and public, support English, have no active policy violations, and work "without additional credentials or payments". Editorial collections can't be requested | A few stable weeks after listing |
| [AlternativeTo](https://alternativeto.net/faq) | Free; developers may add their own app ("Add a new application"); moderated, can be slow | Day 3–5; list it as an alternative to OneTab, Session Buddy, Toby, Workona, Tab Stash and Skipper |
| [Hacker News](https://news.ycombinator.com/showhn.html) | §3.1 | Day 1 |
| [Product Hunt](https://help.producthunt.com/en/articles/17834537-4-build-your-product-page) | §3.4 | Week 3–6 |
| [Lobsters](https://lobste.rs/about) | Invitation only; "self-promo should be less than a quarter of one's stories and comments in the last year"; new users can't use the `show` tag for 70 days | Write-up only, if invited |
| [dicktracey909/awesome-adhd-tools](https://github.com/dicktracey909/awesome-adhd-tools) (97 stars) | "Must be genuinely useful for ADHD (not just general productivity)"; say why it helps ADHD specifically; no affiliate links; issue or pull request | Now — "Memory & Capture Tools" |
| [mrseth01/awesome-adhd](https://github.com/mrseth01/awesome-adhd) (361 stars) | Pull request to "Software Tools"; read its contributing guide first | Now |
| [qwemort/awesome-zero-telemetry-extensions](https://github.com/qwemort/awesome-zero-telemetry-extensions) (new, 0 stars) | Offline, collect no data, survive MV3 — an exact fit with a tiny audience | Now; costs one pull request |
| [XargsUK/awesome-adhd](https://github.com/XargsUK/awesome-adhd/blob/main/CONTRIBUTING.md) (480 stars, awesomeadhd.com) | Public for at least six months; an update in the last six months; evidence of use ("Around 25 store ratings, a couple of hundred GitHub stars"); pricing and a privacy policy that match the store; no sign-in wall; authors may suggest their own, with the same bar and their connection stated; replies take "a month or more" | Not before May 2027 |
| [themeselection/best-chrome-extensions](https://github.com/themeselection/best-chrome-extensions) (598 stars) | A Chrome Web Store link; updated in the last six months; a 130–170-character description; one extension per pull request. Ready-made line (134): *Groups open tabs by what you were doing and puts a whole project away in one click, kept and searchable. Nothing leaves your computer.* | Once the store listing is live |
| [OpenAlternative](https://openalternative.co/submit) | A paid fast track from $97; a free queue implied | Optional; don't pay |

Not a fit: alexanderop/awesome-local-first ("no longer accepting contributions"), the two
awesome-privacy lists (privacy tools, not tab tools), fregante/Awesome-WebExtensions (developer
resources and small sample code).

---

## 4. GitHub discoverability

### 4.1 Description (340 of 350 characters)

```text
Close it, you'll still have it. A Chrome extension that groups your open tabs by what you were doing (which tab opened which, when, what you switched between) and puts a whole project away in one click: kept, searchable, back in one click. Everything stays on your computer: no account, no network requests. Designed with ADHD in mind. MIT.
```

The store listing says "Made for people who keep a lot of tabs open" and never "ADHD"; the
repository can, because it describes the design, not a benefit. Drop the sentence if you'd rather
the two match.

### 4.2 Topics (20, GitHub's maximum)

```text
chrome-extension browser-extension tab-manager tab-management tabs tab-groups session-manager onetab-alternative productivity adhd adhd-tools neurodivergent privacy local-first on-device-ai gemini-nano manifest-v3 edge-extension louvain graph-clustering
```

Public repositories per topic on 10 November: chrome-extension 40,794 · browser-extension 13,157 ·
tab-manager 302 · tab-management 286 · tabs 1,680 · tab-groups 129 · session-manager 727 ·
onetab-alternative 7 · productivity 45,031 · adhd 936 · adhd-tools 55 · privacy 37,663 ·
local-first 32,770 · on-device-ai 2,737 · gemini-nano 200 · manifest-v3 8,059 · edge-extension
2,144 · louvain 94 · graph-clustering 121 (neurodivergent not counted: the search hit its rate
limit). Small topics are where a new repository shows near the top; big ones bring volume.

### 4.3 Settings

- **About → Website:** the Chrome Web Store page once live; until then
  `https://github.com/Makilesh/Chrome_tab_amnesty/releases/latest`.
- **Social preview** (Settings → General): 1280×640 PNG under 1 MB
  ([GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)).
  Left third: the icon on `#4a6fa5`, "Tab Amnesty", "Close it, you'll still have it." in
  `#fbfaf7`. Right two-thirds: a crop of `docs/images/sweep-light.png`. No counts. This is the
  card every HN, Reddit and Mastodon link shows.
- **Features → Discussions** on (Q&A, Ideas): somewhere for people who are not developers to ask,
  that is not an issue tracker.
- **Pin the repository** on your profile, and hide empty Packages and Deployments from the
  sidebar.
- **Optional: rename to `tab-amnesty`** before submitting to the stores. GitHub redirects old
  links, clones and pushes, but not GitHub Pages or Actions, and the redirect breaks if a new
  repository takes the old name
  ([GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)).
  It matches the name people search for and drops "Chrome" from the address the Edge listing
  links to. Update README, PRIVACY and LISTING links after.

### 4.4 README changes (exact text)

**a. Two badges**, added to the existing row after the MIT badge:

```html
  <img alt="Chrome, Edge and Brave 116 or later" src="https://img.shields.io/badge/Chrome%20%C2%B7%20Edge%20%C2%B7%20Brave-116%2B-4a6fa5">
  <a href="PRIVACY.md"><img alt="Network requests: none" src="https://img.shields.io/badge/network%20requests-none-4a6fa5"></a>
```

Once listed, add the store badge
([shields.io](https://shields.io/badges/chrome-web-store-users)):

```html
  <a href="https://chromewebstore.google.com/detail/ITEM_ID"><img alt="Chrome Web Store" src="https://img.shields.io/chrome-web-store/v/ITEM_ID"></a>
```

**b. A status line** after the centred intro paragraph:

```markdown
**Status:** early (0.1.1). How well the grouping works is still being measured — [how](docs/RESEARCH.md).
```

**c. The demo** (§4.5) above the first screenshot, with a still image for people who ask their
system for reduced motion:

```html
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/sweep-light.png">
  <img alt="Tab Amnesty groups open tabs as asyncio, kubectl rollout and Sourdough; Archive & close puts Sourdough away; searching 'fado' finds a Lisbon page; Open all brings it back" src="docs/images/demo.gif">
</picture>
```

**d. One sentence at the end of "Why":**

```markdown
It is designed with ADHD in mind: nothing closes unless you press a button, you never have to name or sort anything, and there are no counts, streaks or reminders.
```

**e. "How it compares"** after "Private by design": the table in §2.

**f. Install**, once listed — above "From a release":

```markdown
**From a store** (recommended): [Chrome Web Store](STORE_URL) · [Microsoft Edge Add-ons](EDGE_URL). Updates arrive by themselves.
```

**g. Questions**, before "Contributing":

```markdown
## Questions

**Will it ever close tabs by itself?**
No. Tabs close only when you press Archive & close on a group, and a tab holding a message you haven't sent stays open even then.

**Chrome warns it can "read and change all your data on all websites" and your browsing history. Why?**
Those are Chrome's fixed words for what an extension can reach. To name groups and find pages again, Tab Amnesty reads each page's title, description, headings and first thousand or so characters, and checks whether a text box still holds unsent text — yes or no, never the text. From your history it reads only how each open tab's visit started (a link, a typed address, a bookmark) and, for tabs already open when you installed it, when you visited them. It never changes your history, and all of it stays on your computer. Each permission and its reason: [PRIVACY.md](PRIVACY.md).

**Does anything leave my computer?**
Not from Tab Amnesty: no account, no server, no analytics, no network requests. Two things are Chrome's own: Chrome may download its on-device model (nothing about your tabs is part of that), and if Chrome sync is on, Chrome may save the tab groups it shows to your Google account.

**What happens if I uninstall it, or Chrome loses its data?**
Uninstalling removes everything Tab Amnesty kept, so press **Keep a copy** first: it saves everything you put away as one file that opens in any browser and can be brought back in, here or on another computer. Inside Chrome, what you put away also has a second copy, so a database Chrome replaces doesn't take it along.

**How is this different from OneTab or Chrome's tab groups?**
Those keep the tabs you choose, in the groups you make (Chrome's Organize tabs can suggest one from similar tabs). Tab Amnesty works out which tabs belong together from how you opened and used them, even across sites, writes each page down before anything closes, and lets you search what you put away. See [How it compares](#how-it-compares).

**Some groups look wrong. Why?**
It works from what it has seen since you installed it: which tab opened which, and what you switch between. Tabs that were already open have none of that yet, so they group more loosely until you've browsed for a few days, and a project you work on in between others can end up split. A group is only a suggestion: nothing changes until you press its button. How well the grouping works is still being measured: [docs/RESEARCH.md](docs/RESEARCH.md).

**Why do some groups have plain names?**
Names come from Chrome's on-device model when your computer can run it, and from the pages' own titles when it can't. Google lists [22 GB free on the drive with your Chrome profile, and 16 GB of memory with four cores or a graphics card with more than 4 GB](https://developer.chrome.com/docs/ai/get-started), so many computers get title-based names.

**Which browsers does it work in?**
Chrome, Edge and Brave, version 116 or later, on a computer. Other Chromium browsers may work but aren't tested. There is no Firefox, Safari or phone version.

**Does it sync between computers?**
No; nothing leaves your computer. To move what you put away, use **Keep a copy**, then **Bring in a copy** on the other computer.

**Is it only for people with ADHD?**
No. It's designed with ADHD in mind — no counts, no streaks, no reminders, nothing closes without you, nothing to name — and it works the same for anyone who keeps a lot of tabs open.
```

**h. Optional, last line of the README:**

```markdown
If Tab Amnesty is useful to you, a star helps other people find it.
```

### 4.5 Demo GIF storyboard

Recorded on made-up browsing, like the README screenshots — never your own tabs. A public build
in Chrome for Testing shows what most people see (title-based names). 960–1280 px wide, about 15
frames a second, under 5 MB, 15–17 seconds, one second's hold on the last frame. ScreenToGif
(Windows) records and trims in one tool. No counts anywhere, including Chrome's own.

| # | Seconds | On screen | Caption (optional, small, bottom left) |
|---|---|---|---|
| 1 | 0–2 | A Chrome window with tabs on Python's asyncio docs, kubectl rollout pages, a sourdough recipe and Lisbon pages; the cursor clicks the Tab Amnesty icon | — |
| 2 | 2–5 | The page: "What you have open, by what you were doing", with asyncio, kubectl rollout and Sourdough | Grouped by what you were doing |
| 3 | 5–8 | Archive & close on Sourdough: its tabs leave the strip; a card appears under "Put away" | Put a whole project away |
| 4 | 8–12 | Type "fado" in the search box: the Lisbon card shows "Alfama - Wikipedia" under "What matched" | Find it again |
| 5 | 12–15 | Open all: the Lisbon tabs come back as a named group at the end of the strip | Back in one click |
| 6 | 15–17 | Hold on the page's "Everything is kept on this computer" | Close it, you'll still have it. |

Save it as `docs/images/demo.gif`, use it in the README, the v0.1.1 release notes, the social
thread and Product Hunt's gallery.

### 4.6 Measuring the launch without telemetry

Tab Amnesty sends nothing, so the launch is measured outside it: GitHub stars, Insights → Traffic
(it shows "visitors from the past 14 days" only, so note referrers and views weekly), the store
dashboards' install and weekly-user figures, and what issues and discussions say. Adding
analytics would break the promise the launch is built on.

---

## 5. Sources

Checked 9–10 November 2026.

- **Competitors:** OneTab [store](https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall),
  [reviews](https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall/reviews),
  [site](https://www.one-tab.com/), [help](https://www.one-tab.com/help),
  [troubleshooting](https://www.one-tab.com/troubleshooting),
  [privacy](https://addons.mozilla.org/en-US/firefox/addon/onetab/privacy/) · Session Buddy
  [store](https://chromewebstore.google.com/detail/session-buddy/edacconmaakjimmfgnblocblbcdcpbko),
  [v4 FAQ](https://www.sessionbuddy.com/v4-faq), [privacy](https://sessionbuddy.com/privacy-policy/),
  [forum](https://groups.google.com/g/sessionbuddy-discuss/c/LZUhE5tSOHw) · Toby
  [store](https://chromewebstore.google.com/detail/toby-for-chrome/hddnkoipeenegfoeaoibdmnaalmgkpip),
  [pricing](https://www.gettoby.com/pricing) · Workona
  [store](https://chromewebstore.google.com/detail/workona-spaces-tab-manage/ailcmbgekjpnablpdkmaaccecekgdhlh),
  [pricing](https://workona.com/pricing/), [Capterra](https://www.capterra.co.uk/reviews/197971/workona) ·
  Tabs Outliner [store](https://chromewebstore.google.com/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl) ·
  Tab Stash [AMO](https://addons.mozilla.org/en-US/firefox/addon/tab-stash/),
  [GitHub](https://github.com/josh-berry/tab-stash) · Tab Session Manager
  [store](https://chromewebstore.google.com/detail/tab-session-manager/iaiomicjabeggjcfkbimgmglanimpnae) ·
  Skipper [store](https://chromewebstore.google.com/detail/skipper-tab-management-th/cjiinmicahhdcmfpdohhaahgkdiehfga),
  [site](https://skipper.co/), [privacy policy](https://www.skipper.co/privacy-policy),
  [TechCrunch 2022](https://techcrunch.com/2022/10/04/this-startup-out-of-carnegie-mellon-wrangled-my-tabs-once-and-for-all).
- **Browsers:** Google [Jan 2024](https://blog.google/products/chrome/google-chrome-generative-ai-features-january-2024/),
  [Tab organizer help](https://support.google.com/chrome/answer/14519765) (indexed text),
  [Android tabs help](https://support.google.com/chrome/answer/2391819?hl=en&co=GENIE.Platform%3DAndroid),
  [built-in AI requirements](https://developer.chrome.com/docs/ai/get-started) · desktop
  inactive-tab prompt [Windows Report](https://windowsreport.com/this-is-how-desktop-chromes-new-feature-lets-you-declutter-tab-bar/) ·
  [Gemini and tab groups](https://www.androidauthority.com/chrome-tab-group-gemini-integration-3689297/) ·
  Mozilla [AI tab groups](https://blog.mozilla.org/en/firefox/ai-tab-groups/) · Opera
  [Tab Islands](https://blogs.opera.com/news/2023/06/opera-tab-islands/) · Arc
  [help](https://resources.arc.net/hc/en-us/articles/19228855311127) (indexed text),
  [Atlassian](https://alternativeto.net/news/2025/9/atlassian-acquires-the-browser-company-creator-of-the-arc-and-dia-ai-powered-browsers),
  [Dia](https://en.wikipedia.org/wiki/Dia_(web_browser)) · Sidekick
  [WebCatalog](https://webcatalog.io/en/blog/singlebox-vs-sidekick).
- **Research:** [CMU on CHI 2021](https://www.cmu.edu/news/stories/archives/2021/may/overcoming-tab-overload.html).
- **Venues:** [Show HN](https://news.ycombinator.com/showhn.html),
  [HN guidelines](https://news.ycombinator.com/newsguidelines.html),
  [dang's Show HN advice](https://news.ycombinator.com/item?id=22336638),
  [HN Algolia](https://hn.algolia.com/?query=tab%20manager&type=story&sort=byPopularity) ·
  [Product Hunt page guide](https://help.producthunt.com/en/articles/17834537-4-build-your-product-page) ·
  [Lobsters](https://lobste.rs/about) · Reddit (second-hand only): [ReplyHey](https://www.replyhey.com/subreddits/ADHD),
  [HuntComments](https://huntcomments.com/r/adhd/rules),
  [Thread Otter](https://www.threadotter.com/subreddit-rules/chrome_extensions),
  [subreddit guide](https://github.com/soarsh/awesome-productivity-subreddits/blob/main/README.md).
- **Stores:** [CWS registration](https://developer.chrome.com/docs/webstore/register),
  [review process](https://developer.chrome.com/docs/webstore/review-process),
  [discovery and badges](https://developer.chrome.com/docs/webstore/discovery),
  [Edge account](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account).
- **GitHub:** [topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics),
  [social preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview),
  [renaming](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository),
  [traffic](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository),
  [shields.io store badge](https://shields.io/badges/chrome-web-store-users).
- **Lists:** [awesome-adhd-tools](https://github.com/dicktracey909/awesome-adhd-tools),
  [mrseth01/awesome-adhd](https://github.com/mrseth01/awesome-adhd),
  [XargsUK/awesome-adhd](https://github.com/XargsUK/awesome-adhd/blob/main/CONTRIBUTING.md),
  [best-chrome-extensions](https://github.com/themeselection/best-chrome-extensions/blob/main/CONTRIBUTING.md),
  [zero-telemetry extensions](https://github.com/qwemort/awesome-zero-telemetry-extensions),
  [OpenAlternative](https://openalternative.co/submit), [AlternativeTo FAQ](https://alternativeto.net/faq).
