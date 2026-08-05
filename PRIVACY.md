# Privacy policy

Last updated: 5 August 2026

Channel Search+ for YouTube does not collect, transmit, or sell any data. There
is no server, no account, and no analytics. Everything the extension reads stays
inside your own browser.

## What it reads

When you open the panel on a channel, the extension requests that channel's
public video listings from youtube.com, using the same endpoints the site itself
uses. Those requests carry your existing YouTube session, exactly as they would
if you scrolled the page yourself, which is why your own watch progress appears
on the videos. The extension never sees your password, and never asks for it.

It reads nothing outside youtube.com.

## What it stores, and where

All of it is local to your browser. Nothing leaves your machine.

| Stored | Where | Why |
| --- | --- | --- |
| Video catalogues for channels you open | IndexedDB | So reopening a channel is instant |
| View-count snapshots with timestamps | IndexedDB | So growth can be measured between visits |
| The channels you add to your watchlist | IndexedDB | So the list survives a restart |
| Your settings | `chrome.storage.sync` | So they persist |

Settings use the browser's own sync storage, so if you have browser sync turned
on they travel between your devices through your browser account. That is the
browser's mechanism, not ours, and it covers settings only. Catalogues,
snapshots, and watchlists never sync and never leave the device.

## What it never does

- No data is sent to the author or to any third party.
- No analytics, telemetry, crash reporting, or advertising.
- No tracking across sites. The extension only runs on youtube.com.
- Nothing is sold or shared, because nothing is collected.

## Deleting your data

Removing the extension deletes everything it stored. To clear it while keeping
the extension, remove the site data for youtube.com in your browser settings,
which drops the cached catalogues and snapshots, and use Reset in the popup to
restore default settings.

## Permissions, and why each is needed

- **storage** keeps your settings between sessions.
- **Access to youtube.com** is what lets the panel read a channel's listings and
  draw itself on the page. It is limited to `www.youtube.com` and no other site.

## Source

The extension is open source under the MIT licence. Every claim above can be
checked against the code at
<https://github.com/gottostartsomewhere/yt-channel-search>.

## Contact

Open an issue at
<https://github.com/gottostartsomewhere/yt-channel-search/issues>.
