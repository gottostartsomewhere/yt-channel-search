# YouTube Channel Search+

A Chrome extension (MV3) that adds real search and filtering inside a YouTube
channel. YouTube's own in-channel search only matches text on titles. This pulls
the channel's full uploads catalog once, then **takes over the channel's video
grid** to show only the videos matching your filters, rendered as normal
YouTube-style cards. Metrics YouTube never exposes:

- duration ranges (min/max minutes)
- minimum view count
- long-form vs Shorts split
- sort by views, duration, title, or **views-per-day** (surfaces breakout videos)
- keyword on top of all of the above

The filtered results replace the native grid in place (a sticky filter bar sits
on top), and a **Restore YouTube** button brings the original view back.

On top of the filters it shows:

- a **live stats strip** for the current result set (video count, total views,
  median views, average length, median views-per-day) that updates as you filter
- **outlier badges** on any video beating 2x the channel's median views-per-day,
  so breakout uploads jump out immediately

## How it works

YouTube's in-channel search box is a server-side [InnerTube](https://www.youtube.com/youtubei/v1)
request that only does text matching. To filter on duration/views/date you have
to have the data locally first, so the extension:

1. Reads the channel's `/videos` page HTML and pulls `ytInitialData` plus the
   InnerTube API key and client version.
2. Walks the uploads grid using continuation tokens (`/youtubei/v1/browse`),
   collecting each video's id, title, duration, view count, and relative upload
   date. Duration and views are already in the list payload (the thumbnail time
   badge and `viewCountText`), so no per-video call is needed.
3. Renders its own results list in an in-page panel, filtered and sorted
   entirely client-side.

All requests are same-origin from the YouTube tab, so they carry your normal
session and need no API key of your own.

## Install (unpacked)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `yt-channel-search` folder.
4. Open any channel's **Videos** tab (e.g. `youtube.com/@MrBeast/videos`),
   click the **Search+** pill at the bottom right. It loads the full catalog
   once, hides YouTube's grid, and shows the filtered results in its place.
   Adjust the filter bar and the grid updates live.

## Notes and limits

- Upload dates from InnerTube are relative ("2 years ago"), so views-per-day is
  approximate. Exact dates/views/likes need the official YouTube Data API v3
  (`videos.list`) — a planned upgrade path for an "engagement rate" metric.
- Catalog fetch is capped at ~1800 videos (`MAX_PAGES` in `content.js`).
- InnerTube is an unofficial endpoint. It's stable in practice but YouTube can
  change the payload shape, which would need a parser tweak. For personal use.

## Roadmap

- Exact stats + likes via the official Data API (opt-in with your own key).
- CSV export of the filtered set.
- Engagement-rate (likes/views) and duration-bucket histograms.
- Cache catalogs in IndexedDB so re-opening a channel is instant.
