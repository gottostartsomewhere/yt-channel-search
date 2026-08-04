# Manual test checklist

There are no automated tests, so this is the pass to run before tagging a
release or merging anything that touches the panel.

Use a channel with a deep, varied back catalogue (300+ videos, a mix of Shorts
and long uploads, some you have actually watched). Sign in first, or every watch
feature will read as empty. `@mkbhd`, `@veritasium` and `@LinusTechTips` all work
well.

Run `node build.js` and load `dist/chrome`, not the repo root.

## 1. Smoke

The first two decide whether anything else is worth running.

- [ ] Panel opens on a channel's Videos tab from the Search+ button
- [ ] Console is clean. A `ReferenceError` here means the content scripts loaded
      out of order, so check the `js` array in `manifest.json`
- [ ] Catalog loads and the count climbs, ending at roughly the channel's real
      video count
- [ ] Alt+Y opens and closes the panel
- [ ] Toolbar icon opens the popup
- [ ] Restore YouTube brings the native grid back untouched
- [ ] Navigating to another channel and reopening loads that channel, not the
      previous one

## 2. Popup

- [ ] Open on this channel opens the panel and closes the popup
- [ ] On a non-YouTube tab the button is disabled with an explanation
- [ ] On a YouTube tab that predates the last extension reload, the button says
      to reload rather than failing silently
- [ ] Each setting persists across a popup close and reopen
- [ ] Reset restores defaults
- [ ] Change shortcut opens the browser's shortcut page

Then confirm each setting actually reaches the panel:

- [ ] Opening sort: panel opens already sorted that way
- [ ] Hide finished videos: finished videos absent on open
- [ ] Open automatically: panel opens without clicking, on channel load
- [ ] Video limit: set it to 60, refresh, and the catalog stops near 60
- [ ] Finished at: set to 50, and videos past halfway count as finished
- [ ] Outlier threshold: raising it leaves fewer badges

## 3. Filters

Each should narrow the count immediately, with no reload.

- [ ] Keyword matches titles, case-insensitively
- [ ] Length: each of the five bands, and Any length restores
- [ ] Views: each of the five bands, and Any views restores
- [ ] Uploaded: past week, month, 3 months, year, over a year
- [ ] Watched: not started, not finished, still watching, finished
- [ ] Fits in: 10 shows nothing longer than ten minutes
- [ ] Filters combine. Fits in 25 plus Watched not started is the flagship
      combination and should return a sensible short list
- [ ] Clear appears only when something is active, and resets everything
- [ ] The count turns accent-coloured while filtered
- [ ] A filter matching nothing shows the empty state, not a blank pane

## 4. Sorts

- [ ] Newest, and Oldest is its exact reverse
- [ ] Start here: a spread across years, not all from one period
- [ ] Most views and Fewest views
- [ ] Longest and Shortest
- [ ] Views per day differs from Most views, which is the whole point
- [ ] Trending (measured) needs two refreshes a while apart, see section 8
- [ ] Hidden gems surfaces smaller videos punching above their weight
- [ ] Title A to Z

## 5. Cards

- [ ] Thumbnail, title, views and age all present and correct
- [ ] Duration badge matches the video
- [ ] Clicking a card opens that video
- [ ] Partly watched videos show a resume bar at the right position
- [ ] Finished videos are dimmed but still present
- [ ] Outlier badges show a multiplier
- [ ] After a refresh that finds new uploads, those carry a NEW badge
- [ ] Over 600 results shows the truncation note

## 6. Exports

- [ ] CSV downloads, opens in a spreadsheet, and reflects the current filters
      rather than the whole catalogue
- [ ] JSON downloads and parses
- [ ] Titles containing commas and quotes survive the CSV round trip

## 7. Tabs

**Analytics**

- [ ] Uploads per year, median views by year, and both distributions render
- [ ] Median views by video length draws a line with a labelled peak
- [ ] Clicking a distribution bar filters the grid and switches to it
- [ ] Compare accepts an @handle, a bare handle and a full URL
- [ ] Compare bolds the winning value per row
- [ ] A nonsense channel name reports a parse failure rather than hanging

**Titles**

- [ ] Two columns, filling the width
- [ ] Words that lift performance shows real words, not filler like "gets"
- [ ] No mangled contractions such as "youre"
- [ ] Title formats percentages look plausible
- [ ] Median views by title length skips empty bands rather than drawing gaps

**Series**

- [ ] Groups recognisable series, for example numbered parts and episodes
- [ ] A channel with no series shows the empty state

**Niche**

- [ ] Track channel adds a chip
- [ ] The chip's remove button works and survives a reopen
- [ ] Refresh all reports progress per channel
- [ ] What is working right now lists videos with a multiplier
- [ ] Content gaps lists topics absent from the current channel
- [ ] An unreachable channel is counted in the status, not swallowed
- [ ] Nothing outperforming shows the empty state

## 8. Persistence

Needs two sessions with a real gap, so save it for last.

- [ ] Reopening a channel loads instantly from cache and says so
- [ ] Refresh re-reads and updates the timestamp
- [ ] A cache written before watch state existed asks for a refresh instead of
      reporting everything as unwatched
- [ ] After a second refresh hours later, cards show measured gains such as
      "+12K in 6h"
- [ ] Trending (measured) then orders by those gains
- [ ] The Niche status flips from baseline to live once tracked channels have
      two snapshots
- [ ] Watchlist survives a browser restart

## 9. Edge cases

- [ ] A channel with no Videos tab fails with a message, not a stuck spinner
- [ ] A channel with a handful of videos still renders every pane
- [ ] Signed out: watch filters are inert and nothing crashes
- [ ] Narrow window: the control bar wraps without overlapping
- [ ] Light theme: text stays legible
- [ ] Reopening the panel repeatedly does not stack duplicates

## 10. Firefox

Load `dist/firefox` through `about:debugging`.

- [ ] Panel opens. If not, grant the YouTube host permission from the addons
      panel, since Firefox MV3 treats host permissions as opt-in
- [ ] Popup renders and settings persist
- [ ] Alt+Y works
- [ ] Change shortcut opens `about:addons`
