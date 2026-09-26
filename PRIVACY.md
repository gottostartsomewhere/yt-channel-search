# Privacy policy

Last updated: 25 September 2026

Needle for YouTube (formerly Channel Search+ for YouTube) does not collect,
transmit, or sell any data. There is no server, no account, and no analytics. Everything the extension reads stays
inside your own browser.

## What it reads

When you open the panel on a channel, the extension requests that channel's
public video listings from youtube.com, using the same endpoints the site itself
uses. Those requests carry your existing YouTube session, exactly as they would
if you scrolled the page yourself, which is why your own watch progress appears
on the videos. The extension never sees your password, and never asks for it.

On your watch history page it does the same thing with your history, which is
your own data on your own account, read the same way the page reads it.

On a search results page, if you open the panel or type a filter into the
search bar, it reads the first 200 or so results for that search, the same
results the page shows as you scroll.

It reads nothing outside youtube.com.

## Your library in the search bar

When you click into YouTube's search bar, the extension shows matches from your
Watch Later, Liked videos and watch history alongside YouTube's own suggestions.
To do that without a delay on every keystroke, it keeps a copy of those three
lists on your device.

- It reads the first page of each list, the same page you would see by opening
  it, with the session your browser already sends. **No cookie is read and
  nothing is signed for this**, unless you have also turned on deep reading
  below.
- It only reads them when you click into the search bar, and at most once every
  three hours. Nobody who never uses the search bar pays for it.
- The copy stays in your browser's local storage for youtube.com and is never
  sent anywhere. Clear cached data in the popup deletes it.
- You can turn the whole feature off in the popup ("Library in the search bar").
  YouTube's search bar then behaves exactly as it does without the extension.

Filters you type into the search bar, such as `<20m`, are removed before YouTube
sees your search. YouTube only ever receives the words you were searching for.

The same local copy is what puts "In Watch Later" and "Watched Monday" on
YouTube's thumbnails. Nothing extra is read for that: it compares the video
links already on the page against the copy on your device.

## The one script that runs in YouTube's own page

Everything above runs in the browser's isolated space for extensions, which
cannot see or touch YouTube's own JavaScript. One small file, `navigate.js`,
runs inside the page instead, because that is the only way to open a video the
way YouTube's own links do, without reloading the whole page.

It does two things.

- When you click a video in the panel, the search bar or the library row, or
  press Enter on a search with filters, it asks YouTube to open that address.
  It accepts only two kinds: a video (`/watch?v=`) and a search
  (`/results?search_query=`, with YouTube's own filter parameter if there is
  one). If it is missing or YouTube ignores it, the page simply loads normally.
- It copies YouTube's public API key and client version onto the page, so a
  followed search can be checked with one small request instead of loading a
  whole results page first. That key is embedded in every YouTube page for
  every visitor. It identifies the website, not you.

It reads nothing else and stores nothing.

## What it remembers across searches

YouTube's search forgets you between searches. These features exist because
this extension does not, and every one of them is kept on your device.

- **Videos you have been shown.** When a search result has actually been on
  your screen, its video id is noted with a count and a date, up to the most
  recent 20,000. That is what `is:fresh` reads to leave out what you have
  already seen. Only ids are kept, not titles, and only from search results.
- **Searches you follow.** Each one is the query as you typed it, filters and
  all. About every six hours while YouTube is open, the extension asks YouTube
  for this month's uploads matching it, the same request as searching it
  yourself, and keeps anything new for the search bar. The query list syncs
  between your own browsers; what each one has found stays on the device.
- **Channels you muted.** Their names and handles, synced between your own
  browsers. Muted channels are hidden from search results only.
- **The channels you watch.** The channels that appear most in your history
  have their public video lists read in the background, at most one channel
  every ten minutes and then once a week each, so `in:channels` can search
  them. You can turn this off in the popup ("Index channels you watch").

The follow checks and the channel index are the only things the extension
does without being clicked. Both only talk to youtube.com, both only read
public search results and public channel pages, and both stop when YouTube is
not open.

## Deep reading, and the one thing worth reading carefully

This is the only part of the extension that touches anything resembling a
credential, so it is described in full rather than summarised.

**It is off by default and does nothing until you turn it on** in the popup.
Left alone, the extension reads roughly the first 180 videos of your history,
the first 100 of Watch Later and Liked, and the first page of search results'
watch progress, and stops, exactly like every other feature here.

Turned on, it can read further into those lists. Doing that requires signing
the request, because YouTube refuses the later pages of your own lists to an
unsigned one and answers as though nobody is logged in. The signature is an `Authorization: SAPISIDHASH` header,
which is a SHA-1 of a timestamp, your `SAPISID` cookie, and `https://www.youtube.com`.
This is precisely what youtube.com's own JavaScript computes for its own
requests; the extension does the same calculation for the same server.

To be exact about what that means:

- The cookie is read from `document.cookie` on youtube.com, in the page, and is
  used to compute a hash. **The cookie value itself is never stored and never
  sent anywhere.**
- Only the resulting hash is sent, and only to youtube.com, in a request your
  browser was already attaching that same cookie to.
- Nothing about this reaches the author or any third party, because there is
  still no server to reach.
- Untick the box and it stops immediately. There is nothing to clean up, since
  nothing was kept.

It is written this way because the source is public and somebody will eventually
read the function that does it. Better that they find it explained here first.

## What it stores, and where

All of it is local to your browser. Nothing leaves your machine.

| Stored | Where | Why |
| --- | --- | --- |
| Video catalogues for channels you open | IndexedDB | So reopening a channel is instant |
| Your watch history, if you open the panel on it | IndexedDB | So filtering and sorting it is instant |
| Your Watch Later, Liked videos and watch history, if the search bar feature is on | IndexedDB | So the search bar can match them as you type |
| Filters you just typed into the search bar | `sessionStorage`, for two minutes | So the results page can apply them after YouTube loads it |
| How many times you have filtered, and whether you answered the review prompt | `chrome.storage.local` | So the prompt appears once and never again after you answer |
| How far you watched those videos | IndexedDB, inside the catalogue above | So the watch filters can hide what you have finished |
| View-count snapshots with timestamps | IndexedDB | So growth can be measured between visits |
| The channels you add to your watchlist | IndexedDB | So the list survives a restart |
| Video ids you have been shown in search results, with counts and dates | IndexedDB | So `is:fresh` can leave them out |
| What each followed search has found | IndexedDB | So the search bar can show what is new |
| Public video lists of the channels you watch most | IndexedDB, with the catalogues above | So `in:channels` can search them |
| Searches you follow, and channels you muted | `chrome.storage.sync` | So they follow you between your own browsers |
| Your settings | `chrome.storage.sync` | So they persist |

Watch progress is the most personal of these, so to be exact about it: YouTube
already includes it in the listing payload the page itself requests, the
extension reads it from there rather than tracking you, and it is written to
the same local cache as the rest of the catalogue. It is never transmitted, and
unlike your settings it never syncs between devices.

Settings use the browser's own sync storage, so if you have browser sync turned
on they travel between your devices through your browser account. That is the
browser's mechanism, not ours, and it covers settings, followed searches and
muted channels only. Catalogues, snapshots, watchlists and everything the
extension remembers about what you were shown never sync and never leave the
device.

## What it never does

- No data is sent to the author or to any third party.
- No analytics, telemetry, crash reporting, or advertising.
- No tracking across sites. The extension only runs on youtube.com.
- Nothing is sold or shared, because nothing is collected.

## Deleting your data

Open the popup on any YouTube tab and use **Clear cached data**. That deletes
every cached catalogue, every snapshot, your watchlist, your library copy, the
record of what you were shown, and what followed searches have found. Followed
searches and muted channels are removed one by one in the popup's own lists. It asks once before
doing it, and it cannot be undone. Settings are left alone; Reset next to it
restores those.

Removing the extension also deletes everything it stored.

Cached catalogues are capped at the 40 most recently read channels, so the
cache does not grow without limit as you browse. Your watchlist is exempt from
that, since it is a choice you made rather than a cache.

## Permissions, and why each is needed

- **storage** keeps your settings between sessions.
- **Access to youtube.com** is what lets the panel read a channel's listings and
  draw itself on the page. It is limited to `www.youtube.com` and no other site.

No additional permission is requested for deep watch history. It uses the
youtube.com access the extension already has, which is why the setting exists at
all: the capability could not be gated by the browser, so it is gated by you.

## Source

The extension is free, with no paid tier, and its full source is published under
the PolyForm Noncommercial licence. Every claim above can be checked against the
code at <https://github.com/gottostartsomewhere/yt-channel-search>.

## Contact

Open an issue at
<https://github.com/gottostartsomewhere/yt-channel-search/issues>.
