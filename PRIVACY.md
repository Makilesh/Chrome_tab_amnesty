# Tab Amnesty — privacy

**Everything Tab Amnesty records stays on your computer.** It makes no network requests of its
own: nothing is sent to the developer, to an analytics service, to an AI service, or to anyone
else. There is no account, no server, no tracking and no advertising. Nothing is sold or shared.

**It asks first.** Nothing is recorded until you press **Start grouping my tabs** on the page Tab
Amnesty opens when it is installed. That page lists what it notes, as this one does below.

Tab Amnesty works in Chrome, Microsoft Edge and Brave; where they differ, this page says so.

Last changed: 11 November 2026. Changes to this page are visible in the
[repository's history](https://github.com/Makilesh/Chrome_tab_amnesty/commits/main/PRIVACY.md).

## What it records, and why

Tab Amnesty has one purpose: to group your open tabs by what you were doing, so you can put a
whole project away in one click and find it again later. For that, for each tab in a normal
(non-incognito) window, it keeps:

- the page's **address, title and site**;
- **when** the tab was opened, **which tab it was opened from**, when you switched to it and for
  how long, and which tabs you switched between — this is how it tells one project from another;
- **how the visit started** (a link, a typed address, a bookmark…), as your browser reports it
  when the page loads. Tab Amnesty does not read your browsing history;
- a short **digest of the page**: its description, its headings and its opening text (about a
  thousand characters at most), so a group can be named and a page found again by what it said;
- whether a text box you typed into **still holds text you have not sent**. To tell, it looks on
  your computer at whether that box is empty, and keeps a yes or no only, never the text — so
  that Archive & close never closes a tab with a half-written message.

Tabs on the mail, chat, calendar, search and message pages on Tab Amnesty's
[built-in list](src/cluster/ambient.json) are never grouped, so for those it keeps only the site —
and, for a search or message page, which page of the site — never a search's words or a message's
id, plus the timing: no title, no page text. A tab that is not a web page (a local file, a blank
page, a file opened in a tab) keeps no title, no text, and only what kind of page it was. Other
pages that show your messages are kept like any page; add their site to **Sites never remembered**
to keep nothing about them.

When you put a group away, it keeps a card for it: the group's name, when it was, its sites, and
for each tab the address, title, digest and, if your browser's on-device model wrote one, a summary.
A card is a record of the page, not a copy of it: bringing a tab back loads the page again.

When you correct a group, it keeps the correction so the group stays as you left it: which tabs
you put together, which you took out, and the name if you typed one.

It never keeps or sends what you type into web pages, passwords, cookies or form contents. It does not run in
incognito windows at all.

## On-device AI

When your browser offers a built-in on-device model — Gemini Nano in Chrome; in Microsoft Edge,
Phi-4-mini, still a preview there — Tab Amnesty asks it to name groups and to summarise pages you
put away. That runs on your computer, through the browser; nothing goes to a server. The first
time, the browser may download the model itself — Chrome from Google, Edge from Microsoft — and
nothing about your tabs is part of that download. Without the model, names come from the pages'
own titles.

## Where it is kept

In the extension's own storage inside your browser profile (its IndexedDB database, with a second
copy of what you put away in its Cache Storage, so a database the browser replaces does not take
your archive along). Only Tab Amnesty can read it — web pages cannot. Uninstalling Tab Amnesty
removes all of it.

When you show groups on your tab strip, or bring a group back, the browser makes named tab groups.
If the browser's sync is on, it may save those groups and their names to your account (a Google
account in Chrome, a Microsoft account in Edge) — that is the browser's own feature, under your
sync settings, not Tab Amnesty sending anything.

What you put away is kept until you forget it. The record of a tab you closed yourself, without
putting it away, is removed 30 days after it closed.

## Your controls

- **Forget this** — on every card and every tab. Forgotten things are removed for good.
- **Sites never remembered** — tabs on these sites are still grouped while open, but nothing
  about them is kept: no titles, no page text, nothing after they close. Adding a site also
  removes what was already kept about it.
- **Keep a copy** — saves everything you put away as one file, where your downloads go. That file
  is yours: it holds what you put away — titles, addresses, what each page said and any summaries —
  and your list of sites never remembered, and it goes nowhere you do not take it. **Bring in a copy** reads one back, adding
  only what is missing.
- **Uninstall** — removes everything Tab Amnesty kept.

## Permissions, and what each is for

| Permission | Why |
|---|---|
| Tabs | See which tabs are open, which tab opened which, and close or reopen them when you ask. |
| Tab groups | Show groups on your tab strip, and reopen a card as a named group. |
| Favicons | Show each page's site icon beside it, from the copy your browser already keeps on your computer. Nothing is fetched from the site. |
| Web navigation | How each visit started (a link, a typed address, a bookmark…), as the page loads. It does not read your browsing history. |
| Access to the pages you visit (http and https) | Read each page's title, description, headings and opening text for its digest, and notice unsent typing — on your computer only. |
| Scripting | Start reading the tabs that were already open when Tab Amnesty was installed or updated. |
| Alarms | Do background work (summaries, keeping records in step) on a schedule rather than continuously. |
| Offscreen document | Run the browser's on-device summariser outside the background worker. |
| Unlimited storage | Keep everything you put away for as long as you want it, without the browser's storage limit deleting it. |

## The tester build

Copies handed to testers for the research study (`npm run package -- --study`) also note, every few hours,
**how many** tabs are open, and **when** Archive & close was pressed — numbers and times only, no
addresses or titles. Those stay on the computer too; a tester sends them only by choosing
**Export study summary** and handing the file over. The versions in the Chrome Web Store and Edge
Add-ons do not include the study.

## Store policies

Tab Amnesty's use of this information complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements, and with the
[Microsoft Edge Add-ons developer policies](https://learn.microsoft.com/microsoft-edge/extensions-chromium/store-policies/developer-policies).

## Questions

Open an issue: <https://github.com/Makilesh/Chrome_tab_amnesty/issues>.
