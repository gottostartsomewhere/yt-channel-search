# YouTube Channel Search+

YouTube Studio tells you how your own videos did. It is blind to every other
channel on the platform. This fills that gap: point it at anyone's channel and
it reads their entire upload history, then filters, charts, tracks, and compares
it using numbers YouTube never exposes publicly.

It runs entirely in your browser. No account, no API key, no server.

## The idea

Most in-page filter tools only touch the video cards already loaded on screen,
so they can sort what you have scrolled past and nothing more. This one pulls the
channel's complete catalog through YouTube's internal InnerTube API before it
filters anything, so every sort, statistic, and chart covers all of it. Questions
like "what are this channel's least-viewed videos" or "what is the median length
across 1,200 uploads" are unanswerable from the loaded DOM, and trivial here.

## What it does

The extension replaces the native grid in place, with a control bar on top and a
Restore YouTube button to put things back. It has four views.

**Grid.** Filter by title keyword, length band, view band, upload recency, and
**watch state**. That last one is the piece plain YouTube never gives you: hide
everything you have already finished, or pull up only the videos you started and
abandoned. Your progress rides along in the same payload the catalog comes from,
so finding the unwatched half of a 900-video back catalogue takes one dropdown.

Two more built for the moment you actually want to watch something. **Start
here** is for landing on a huge channel cold: sorting by raw views just hands
you the oldest uploads, so it scores by views per day and caps how many come
from any one year, giving you the channel's best work spread across its life.
**Fits in** takes the minutes you have and shows only what will fit. Set it to
25, set Watched to not started, and you have the answer to what should I watch
right now.
Sort by views, length, views per day, measured trend, or hidden gems (fast
relative to the channel but still small in absolute terms). A live stats strip
recalculates as you filter, and outliers get a badge showing how far they beat
the channel's median rate.

**Analytics.** Charts drawn from the whole catalog: uploads per year, median
views by upload year (is the channel rising or fading), view and length
distributions, and a length-versus-views scatter. Click any distribution bar to
filter the grid by that band.

**Titles.** The part Studio does not do even for your own channel. Studio tells
you what performed. This tells you which *patterns* perform: which words lift
median views and by how much, which title formats land (question, versus,
numbered, how-to, superlative), and how title length maps to views.

**Niche.** Track a set of competitor channels. Refresh reads all of them and
gives you two things: what is working right now, and content gaps, the topics
they rank for that you have never covered. Once a tracked channel has been
refreshed twice, "what is working" ranks by measured velocity, how fast each
video is moving relative to how fast that channel normally moves, so a small
channel's breakout can outrank a big channel's average upload. Until then it
falls back to the lifetime average.

Alongside that: catalogs cache locally so re-opening is instant, refreshing flags
uploads added since your last visit, and any filtered set exports to CSV or JSON.

## Measured velocity

Every refresh stores a snapshot of every video's view count with a timestamp.
Diff two snapshots and you get something the relative dates cannot give you:
real, measured growth. "Gained 380K views in the last 4 days" is observed, not
inferred. The tool gets more useful the more often you open it, and the history
is yours alone, kept locally.

## How it works

The in-channel search box is a server-side InnerTube request that only matches
text, so every metric has to be computed client-side. The extension:

1. Reads the channel's `/videos` HTML and pulls `ytInitialData` along with the
   InnerTube key and client version.
2. Walks the uploads grid with continuation tokens against `/youtubei/v1/browse`,
   reading each video's id, title, duration, view count, and relative date. All of
   that already lives in the list payload, so there is no per-video request.
3. Filters, analyses, and renders everything locally.

Every request is same-origin from the YouTube tab, so it rides your normal
session and needs no API key of your own.

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Choose Load unpacked and select this folder.
3. Open any channel's Videos tab, for example `youtube.com/@mkbhd/videos`, and
   click the Search+ button at the bottom right.

## Notes and limits

- Public view counts are all anyone gets for a channel they do not own, so this
  is a competitive-signal tool rather than a precision instrument. For other
  people's channels every tool is working from the same public numbers.
- Upload dates from InnerTube are relative ("6 months ago"), so views per day and
  the per-year charts are approximate. Measured velocity is not, because it comes
  from your own snapshots.
- Velocity needs at least two visits before it can show anything.
- Watch state comes from your signed-in session, so it is empty when signed out
  and it ages with the cache. Refresh to bring it up to date. A video counts as
  finished at 90 percent, which is roughly where YouTube stops offering a resume.
- The catalog fetch is capped at roughly 1,800 videos, set by `MAX_PAGES`.
  Refreshing a watchlist reads each channel in turn, so a large one takes a while.
- InnerTube is an unofficial endpoint. It is stable in practice, but YouTube can
  change the payload shape, which would call for a small parser update.

## Roadmap

- Sparklines per video once a few snapshots have accumulated.
- Exact stats and likes through the official Data API, opt-in with your own key.
- A configurable fetch cap for very large channels.

## License

MIT. See [LICENSE](LICENSE).
