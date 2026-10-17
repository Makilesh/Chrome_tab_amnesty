# Tab Amnesty — privacy

**Everything Tab Amnesty records stays on your computer.** It makes no network requests of its
own: nothing is sent to the developer, to an analytics service, to an AI service, or to anyone
else. There is no account, no server, no tracking and no advertising. Nothing is sold or shared.

Last changed: 17 October 2026. Changes to this page are visible in the
[repository's history](https://github.com/Makilesh/Chrome_tab_amnesty/commits/main/PRIVACY.md).

## What it records, and why

Tab Amnesty has one purpose: to group your open tabs by what you were doing, so you can put a
whole project away in one click and find it again later. For that, for each tab in a normal
(non-incognito) window, it keeps:

- the page's **address, title and site**;
- **when** the tab was opened, **which tab it was opened from**, when you switched to it and for
  how long, and which tabs you switched between — this is how it tells one project from another;
- **how the visit started** (a link, a typed address, a bookmark…), read from Chrome's history
  for that page, and for tabs that were already open when you installed it, when you visited them;
- a short **digest of the page**: its description, its headings and its opening text (about a
  thousand characters at most), so a group can be named and a page found again by what it said;
- whether a text box you typed into **still holds text you have not sent**. To tell, it looks on
  your computer at whether that box is empty, and keeps a yes or no only, never the text — so
  that Archive & close never closes a tab with a half-written message.

Tabs on mail, chat, calendar and search-results pages are never grouped, so for those it keeps
only the site and page path of the address — not a search's words, not a message's id — and the
timing: no title, no page text.

When you put a group away, it keeps a card for it: the group's name, when it was, its sites, and
for each tab the address, title, digest and, if Chrome's on-device model wrote one, a summary.

It never keeps or sends what you type, passwords, cookies or form contents. It does not run in
incognito windows at all.

## On-device AI

When your Chrome offers its built-in on-device model (Gemini Nano), Tab Amnesty asks it to name
groups and to summarise pages you put away. That runs on your computer, through Chrome; nothing
goes to a server. The first time, Chrome may download the model itself — that is Chrome's own
download from Google, and nothing about your tabs is part of it. Without the model, names come
from the pages' own titles.

## Where it is kept

In the extension's own storage inside your Chrome profile (its IndexedDB database, with a second
copy of what you put away in its Cache Storage, so a database Chrome replaces does not take your
archive along). Only Tab Amnesty can read it — web pages cannot. Uninstalling Tab Amnesty
removes all of it.

What you put away is kept until you forget it. The record of a tab you closed yourself, without
putting it away, is removed 30 days after it closed.

## Your controls

- **Forget this** — on every card and every tab. Forgotten things are removed for good.
- **Sites never remembered** — tabs on these sites are still grouped while open, but nothing
  about them is kept: no titles, no page text, nothing after they close. Adding a site also
  removes what was already kept about it.
- **Keep a copy** — saves everything you put away as one file, where your downloads go. That file
  is yours: it holds the titles and addresses of what you put away and your list of sites never
  remembered, and it goes nowhere you do not take it. **Bring in a copy** reads one back, adding
  only what is missing.
- **Uninstall** — removes everything Tab Amnesty kept.

## Permissions, and what each is for

| Permission | Why |
|---|---|
| Tabs | See which tabs are open, which tab opened which, and close or reopen them when you ask. |
| Tab groups | Show groups on your tab strip, and reopen a card as a named group. |
| History | When a visit started (link, typed, …), and when tabs that were open before you installed it were visited. |
| Access to the pages you visit (http and https) | Read each page's title, description, headings and opening text for its digest, and notice unsent typing — on your computer only. |
| Scripting | Start reading the tabs that were already open when Tab Amnesty was installed or updated. |
| Alarms | Do background work (summaries, keeping records in step) on a schedule rather than continuously. |
| Offscreen document | Run Chrome's on-device summariser outside the background worker. |
| Unlimited storage | Keep everything you put away for as long as you want it, without Chrome's storage cap deleting it. |

## The tester build

Copies handed to testers for the research study (`npm run package`) also note, every few hours,
**how many** tabs are open, and **when** Archive & close was pressed — numbers and times only, no
addresses or titles. Those stay on the computer too; a tester sends them only by choosing
**Export study summary** and handing the file over. The Chrome Web Store version does not include
the study.

## Chrome Web Store policy

Tab Amnesty's use of this information complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements.

## Questions

Open an issue: <https://github.com/Makilesh/Chrome_tab_amnesty/issues>.
