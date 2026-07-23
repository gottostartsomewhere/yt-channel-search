# YouTube Channel Search+

A Chrome extension that turns a YouTube channel's Videos tab into something you
can actually query. YouTube's own in-channel search matches title text and
nothing else. This reads the channel's entire upload history, then lets you
filter, sort, chart, and compare it by numbers YouTube never exposes: exact
duration ranges, view thresholds, upload recency, and views per day.

## The idea

Most in-page filter tools only touch the video cards already loaded on the
screen, so they can sort what you have scrolled past and no further. This one
works differently. Before it filters anything, it pulls the channel's complete
catalog through YouTube's internal InnerTube API, so every filter, sort, stat,
and chart covers all of it, not a visible slice. That completeness is the whole
point. "Show me this channel's least-viewed videos" or "the median length across
1,200 uploads" are questions you simply cannot answer from the loaded DOM.

## What it does

Once loaded, it replaces the native grid in place, with a sticky control bar on
top and a Restore YouTube button to put things back.

- Filter by title keyword, length band, view band, and upload recency.
- Sort by views, length, title, or views per day, the last of which surfaces
  breakout videos rather than just old ones.
- A live stats strip (count, total and median views, average length, median
  views per day) that recalculates as you filter.
- Outlier badges on any video beating twice the channel's median views per day.
- An Analytics view with charts drawn from the full catalog: uploads per year,
  view distribution, length distribution, and a length versus views scatter that
  shows where the channel's audience actually is.
- Compare, which pulls any other channel's full catalog and lays the two side by
  side.
- Export the current filtered set to CSV or JSON.
- Catalogs are cached locally, so re-opening a channel is instant. Refresh
  re-reads it and flags anything posted since your last visit.

## How it works

The in-channel search box is a server-side InnerTube request that only matches
text, so the metrics have to be computed on the client. The extension:

1. Reads the channel's `/videos` HTML and pulls `ytInitialData` along with the
   InnerTube key and client version.
2. Walks the uploads grid with continuation tokens against `/youtubei/v1/browse`,
   reading each video's id, title, duration, view count, and relative date. All
   of that already lives in the list payload (the thumbnail time badge and the
   metadata rows), so there is no per-video request.
3. Filters, sorts, and renders everything client-side as native-looking cards.

Every request is same-origin from the YouTube tab, so it rides your normal
session and needs no API key of your own.

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Choose Load unpacked and select this folder.
3. Open any channel's Videos tab, for example `youtube.com/@mkbhd/videos`, and
   click the Search+ button at the bottom right.

## Notes and limits

- Upload dates from InnerTube are relative ("6 months ago"), so views per day and
  the per-year chart are approximate. Exact figures, plus likes and comments,
  would need the official YouTube Data API.
- The catalog fetch is capped at roughly 1,800 videos, set by `MAX_PAGES`.
- InnerTube is an unofficial endpoint. It is stable in practice, but YouTube can
  change the payload shape, which would call for a small parser update. Built for
  personal use.

## Roadmap

- Exact stats and likes through the official Data API, opt-in with your own key,
  for precise views per day and an engagement-rate filter.
- A "hidden gems" sort: high views per day, recent, modest absolute views.
- A configurable fetch cap for very large channels.

## License

MIT. See [LICENSE](LICENSE).
