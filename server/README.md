# Monitor

A prototype of the one thing worth charging for: polling channels while nobody's
browser is open, and saying when something breaks out.

The extension can't do this. It only runs when a tab is open and someone clicks
refresh, which means measured velocity depends on the user remembering to visit.
A server doesn't have that problem, and a server is also the only part that
can't be forked out of an MIT repo, because the value is the machine doing work.

## Status

Prototype. It polls, stores snapshots, detects breakouts, and prints a report.
There is no scheduler, no email, no accounts, and no billing.

## Two findings from building it

**Server-side reading works.** The obvious risk was that YouTube would block a
datacenter IP with no cookies and no browser. It doesn't. Plain `fetch` with a
normal user agent returns the full page, the InnerTube key, and the continuation
endpoint, and a channel reads in about a second. No API key, no session.

**But listing view counts are only two significant figures.** This is the one
that matters. A video showing 2.4M moves in steps of 100,000, so any real growth
below that is invisible, and a single step across a boundary is indistinguishable
from 100,000 genuine views. Measured against that, day-to-day velocity on a large
video is mostly rounding noise. Early runs produced confident 76x alerts that
were entirely artefacts.

The code now refuses to treat a gain as real unless it clears three rounding
steps, which is where the error drops to roughly a third. The honest consequence
is that this prototype only sees dramatic movement. For a breakout alert that is
arguably correct, but it is a limitation, not a feature.

**The fix is the official Data API.** `videos.list` returns exact view counts,
costs one quota unit per call, and takes fifty video ids per call. The free
allowance of 10,000 units a day covers 500,000 video readings, far more than a
watchlist needs. Exact counts remove the quantisation completely.

That also happens to make the tiering honest: the free extension uses public
listing data and is approximate, the paid service uses a metered data source and
is exact. Nothing is locked away artificially. The paid tier is better because
it costs something to run.

## Running it

```
node monitor.js          poll, save a snapshot, report
node monitor.js --dry    poll and report, write nothing
node test-alerts.js      exercise the detection logic
```

Channels live in `channels.json` as an array of handles. Snapshots are written
per channel into `data/`, which is not committed.

The first run only records a baseline, since velocity needs two readings.

## How detection works

Within a channel, never across them. A 50k channel's breakout should outrank a
5M channel's ordinary upload, and comparing raw numbers would bury it.

1. Diff the current reading against the previous snapshot.
2. Discard anything that could be explained by rounding.
3. If fewer than five videos moved observably, decline to judge. A median over
   three readings is just the middle one.
4. Take the median gain per day as the channel's current normal.
5. Alert on videos running at twice that or more.

New uploads are reported separately and are not run through the outlier maths,
since they have no prior reading to diff against.

## What is missing before this is a product

- Exact counts through the Data API, which the section above explains
- A scheduler. Cloudflare Workers cron triggers and GitHub Actions are both free
  and both fit this shape
- Email delivery
- Accounts, so a watchlist belongs to someone
- An endpoint for the extension to sync its watchlist up
- Billing

## Licence note

This directory is the part that would be a paid service. It currently sits in
the MIT repo with everything else. If it ever becomes a product, it should move
to its own repo, and the extension should stay MIT and free.
