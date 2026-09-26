# Phase 2

Phase 1 shipped a channel search tool. Phase 2 turns it into one filter engine
that runs over any YouTube video list: a channel, a playlist, Watch Later,
Liked, search results.

That is the whole thesis and every decision below follows from it. The filters
are the product. Where the videos came from is an implementation detail.

---

## 0. Source adapters

Not user visible, which is why it is tempting to skip and why it has to come
first. Build playlists as a fork of the channel path and there are two
codebases by the third feature.

Every source exposes the same thing:

```js
{ id, label, canHandle(url), fetch(), more() }
```

`grid.js`, `charts.js` and `store.js` never learn which one they got. Adding a
surface becomes about fifty lines instead of a branch through the panel.

**`parseVideo` needs three shape branches, not one.** YouTube is mid-migration
and disagrees with itself between page types. Confirmed by reading real
payloads:

| Shape | Where |
|---|---|
| `lockupViewModel` | channel grids, public playlists, newer search |
| `playlistVideoRenderer` | Watch Later, Liked, older playlist pages |
| `videoRenderer` | older search results |

All three normalise to:

```js
{ id, title, channel, channelId, seconds, views, published, progress, playable }
```

`lockupViewModel` paths, verified against a live payload:

| Field | Path |
|---|---|
| id | `contentId` |
| title | `metadata.lockupMetadataViewModel.title.content` |
| duration | `contentImage…thumbnailBottomOverlayViewModel.badges[0].thumbnailBadgeViewModel.text` |
| progress | `…thumbnailBottomOverlayViewModel.progressBar.thumbnailOverlayProgressBarViewModel.startPercent` |
| views, date | `…contentMetadataViewModel.metadataRows[1].metadataParts[0 and 1].text.content` |
| channel | `metadataRows[0].metadataParts[0].text.content` |

Watch progress survives in the new shape. That was in doubt and it is settled.

**The collab trap.** A collaboration video puts "Throwdown and 2 more" in
`metadataRows[0]` and moves the real channel list into an `avatarStackViewModel`
dialog. A naive parse invents a channel called "Throwdown and 2 more" and the
channel filter quietly breaks on exactly the videos people remember best.

---

## 1. The cut

Do this before adding anything. Smaller surface to refactor, and the store
listing changes once instead of twice.

Every number in Insights is derived from cumulative public view counts and
relative dates. Four features were already deleted for that reason. Anything
added there is another chance to ship something that has to come out later.
Meanwhile the search side runs on facts: a duration is a duration, a watch
percentage is a watch percentage, nothing inferred.

The test is **control or conclusion**. A clickable length histogram is not an
insight, it is a filter with a shape. It describes the set in front of you and
works over any source. A claim about a channel's best year is a conclusion drawn
from a proxy, and it is nonsense the moment the set is fifty channels in a bag.

**Goes:** median views by upload year, the length sweet spot, the title-format
table, Compare, Watchlist.

**Stays:** view distribution, length distribution. Both clickable, both filter
the grid.

**The Insights tab goes with them.** Two clickable histograms are filter
controls, so they belong beside the filters as a collapsible strip, not behind a
tab. One tab, one job.

This also removes the creator half of the product. The extension has been two
things: a viewer tool (search, watch state, free time) and a creator tool
(compare, gaps, title formats). The viewer half is differentiated and gets used.
The creator half competes with companies that have sales teams and better data.

---

## 2. Public playlists

Data fully verified. Cheapest real win.

Detect `/playlist?list=`, fetch the page, parse `ytInitialData`, read
`lockupViewModel`. Same filters, same grid, no new permission.

**Blocked on one test.** Pagination past 100 is unproven. The uploads playlist
used earlier had 90 videos with 1 hidden, so all 89 fit one page and there was
no continuation to find. Run the same snippet against a public playlist whose
header states 300 or more before building on this.

---

## 3. Watch Later and Liked

Verified. Reads through `/playlist?list=WL` and parsing `ytInitialData`, which
sidesteps the auth wall on the first page.

**The 100 cap is gone. This section was wrong and 1.1.0 disproved it.**

It said signing was a large escalation not worth making. It is neither large nor
avoidable: YouTube's own page JavaScript signs these requests with an
`Authorization: SAPISIDHASH` header built from the SAPISID cookie, and a content
script on youtube.com can compute the identical hash. Roughly fifteen lines,
shipped in `sapisidHash()` in core.js.

Proven on watch history, which has the same wall. Unsigned it returns a 200
carrying the logged-out page rather than an error, which is what made it look
like a refusal. Signed, it walked eight pages at ~180 each, 1,464 videos, 68 days
back, and never ran out of continuation tokens.

**So Watch Later past 100 is open by the same mechanism**, and so is Liked, and
any other private playlist.

**The cost is not technical, it is trust, and it is paid with a toggle.** Reading
an auth cookie is the shape of thing malicious extensions do, and this source is
public, so somebody will eventually read the function. In 1.1.0 it is off by
default, behind an explicit setting, documented in full in PRIVACY.md before
anyone finds it themselves. Do the same for Watch Later: reuse `cfg.deepHistory`
rather than adding a second toggle for the same capability.

The standout here is filtering Watch Later by channel. YouTube offers nothing
like it. `isPlayable` also gives free detection of dead videos.

---

## 4. Homepage strip

The surface fix, not another feature. Channel search is episodic, twice a year.
A strip on the homepage is seen every time YouTube opens.

`host_permissions` already covers www.youtube.com, so this is a match-pattern
widening and nothing a reviewer reads as new access.

YouTube is an SPA, so hook `yt-navigate-finish`, check `location.pathname` is
`/`, insert before `ytd-rich-grid-renderer`, and guard on an element id so
re-fires do not stack duplicates.

**Off by default, one row, dismissible, two controls at most.** A seven-pill
filter panel bolted above someone's home feed is how uninstalls are earned.
Homepage modification nobody asked for is a different product from a panel
somebody opened deliberately.

---

## 5. Search

You cannot search YouTube's catalogue, only its result feed. What is possible is
pulling `/results?search_query=` the same way every other page is pulled,
walking continuations to 150 or 200 results, and filtering those.

Still worth doing: YouTube's own duration filter is three coarse buckets and it
has no watch-state filter at all.

**Label it honestly in the UI.** "Filtering 200 results", never "searching
YouTube".

---

## 6. Scheduler

Independent of everything above, so it can ship whenever.

`chrome.alarms` for the schedule, `chrome.notifications` to fire,
`storage.local` for the items.

**Two things that would actually bite:**

`notifications` is a warned permission. Adding it to the manifest in an update
disables the extension for every existing user until they click through a
re-approval prompt. Put it in `optional_permissions` and call
`chrome.permissions.request()` the first time somebody sets a reminder. No
install warning, no disabled installs, and people grant it in the moment they
asked for the thing.

Alarms do not reliably survive an extension update. Make `storage.local` the
source of truth and rebuild alarms on `onStartup` and `onInstalled`. A scheduler
that forgets everything after a version bump is worse than no scheduler.

**Schedule sessions, not videos.** Per-video reminders have a known failure
mode: Watch Later does not rot because people forget it exists, it rots because
they saved things they never actually wanted to watch. Remind somebody about a
video they have already passed over six times and the notification gets
dismissed, then muted.

"Saturday 10am, 40 minutes free" fires one notification that opens the panel
with a queue drawn from Watch Later that fits in 40 minutes. That is the
free-time filter doing the work rather than a to-do list bolted on the side, and
it is one notification a week instead of twenty.

Keep a note field per saved video either way. Six months later "why did I save
this" is a real question and nothing currently answers it.

---

## Store work

Once, at the end, not per feature. Every one of these is a re-review.

- **Single purpose** becomes "Searching and filtering YouTube video lists."
  Still one purpose, still true, and it covers every source above.
- **Short description** rewrite. The current one names channels specifically.
- **Detailed description** rewrite. The INSIGHTS block dies with the tab.
- **Screenshots.** 3, 4 and 5 in STORE.txt point at Insights, Watchlist and
  Compare, all of which are being removed. They were already flagged for
  retaking, so nothing is lost.
- Version bump and resubmit.

---

## Order

```
0. source adapters          nothing works cleanly without it
1. the cut                  before adding, not after
   -- test playlist pagination past 100 --
2. public playlists         blocked on that test
3. Watch Later and Liked    label the cap
4. homepage strip           needs 3 to exist
5. search                   most work, least verified
6. scheduler                independent, slot anywhere
```

Each of 2 through 6 ships alone. There is no reason to hold a finished one
waiting for the next.
