/*
 * The paid tier, in one file.
 *
 * Poll tracked channels, store a view-count snapshot each run, and compare
 * against the previous one. A video is worth an alert when it is gaining views
 * materially faster than that channel's own current normal, which is why the
 * comparison is always within a channel and never across them: a 50k channel's
 * breakout should outrank a 5M channel's routine upload.
 *
 *   node monitor.js            poll every channel in channels.json
 *   node monitor.js --dry      poll and report, write nothing
 */

const fs = require("fs");
const path = require("path");
const { readChannel } = require("./youtube");

const DATA = path.join(__dirname, "data");
const CHANNELS = path.join(__dirname, "channels.json");

const MIN_GAIN = 500;       // ignore noise on small channels
const MIN_RATIO = 2;        // times the channel's own median pace
// A median over three movers is really just the middle reading, so an outlier
// would be measured against one other video. False alerts cost trust faster
// than missed ones, so hold out for a sample worth taking a median of.
const MIN_SAMPLE = 5;
const KEEP_SNAPSHOTS = 12;

/*
 * Listing pages give view counts to two significant figures, so a video sitting
 * at 2.4M moves in steps of 100,000 and anything smaller is invisible. A single
 * step across a boundary therefore looks identical to real growth of 100,000.
 *
 * A reading is therefore worth about plus or minus one step. At one step of
 * growth the error is total, at three it is around a third, so three is where
 * a ratio starts meaning something. In practice this makes the monitor deaf to
 * ordinary movement on large videos, which is the right trade for an alerting
 * product: a genuine breakout clears the bar easily and the rest was noise.
 *
 * Exact counts need the official Data API. See README.
 */
const MIN_STEPS = 3;

function roundingStep(views) {
  if (views < 1000) return 1;
  return Math.pow(10, Math.floor(Math.log10(views)) - 1);
}

function beyondRounding(gained, views) {
  return gained >= roundingStep(views) * MIN_STEPS;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

function fmtSpan(days) {
  if (days < 1 / 24) return Math.round(days * 1440) + "m";
  if (days < 1) return Math.round(days * 24) + "h";
  return Math.round(days) + "d";
}

function storePath(handle) {
  return path.join(DATA, handle.replace(/[^\w@.-]/g, "_") + ".json");
}

function loadStore(handle) {
  try {
    return JSON.parse(fs.readFileSync(storePath(handle), "utf8"));
  } catch (e) {
    return { handle, snapshots: [] };
  }
}

function saveStore(handle, store) {
  fs.mkdirSync(DATA, { recursive: true });
  store.snapshots = store.snapshots.slice(-KEEP_SNAPSHOTS);
  fs.writeFileSync(storePath(handle), JSON.stringify(store, null, 2));
}

/*
 * Compare the newest reading against the previous snapshot. Returns the videos
 * that are outrunning the channel's own median pace, plus anything new since
 * last time, which is worth surfacing regardless of how fast it is moving.
 */
function findBreakouts(videos, previous) {
  if (!previous) return { alerts: [], fresh: [], reason: "baseline" };

  const elapsedDays = (Date.now() - previous.t) / 86400000;
  if (elapsedDays <= 0) return { alerts: [], fresh: [], reason: "no time elapsed" };

  const moved = [];
  const fresh = [];
  for (const v of videos) {
    const before = previous.views[v.id];
    if (before == null) {
      fresh.push(v);
      continue;
    }
    const gained = v.views - before;
    if (gained >= MIN_GAIN && beyondRounding(gained, v.views)) {
      moved.push(Object.assign({}, v, { gained, perDay: gained / elapsedDays }));
    }
  }

  if (moved.length < MIN_SAMPLE) {
    return { alerts: [], fresh, elapsedDays, reason: "too little movement to judge" };
  }

  const base = median(moved.map((v) => v.perDay)) || 1;
  const alerts = moved
    .map((v) => Object.assign({}, v, { ratio: v.perDay / base }))
    .filter((v) => v.ratio >= MIN_RATIO)
    .sort((a, b) => b.ratio - a.ratio);

  return { alerts, fresh, elapsedDays, base, reason: "ok" };
}

async function pollChannel(handle, opts) {
  const store = loadStore(handle);
  const previous = store.snapshots[store.snapshots.length - 1] || null;

  const videos = await readChannel(handle, { maxPages: 2 });
  const result = findBreakouts(videos, previous);

  if (!opts.dry) {
    const views = {};
    for (const v of videos) views[v.id] = v.views;
    store.snapshots.push({ t: Date.now(), views });
    saveStore(handle, store);
  }

  return Object.assign({ handle, scanned: videos.length, snapshots: store.snapshots.length }, result);
}

function renderReport(results) {
  const lines = [];
  let alertCount = 0;

  for (const r of results) {
    if (r.error) {
      lines.push(r.handle + ": could not read (" + r.error + ")");
      continue;
    }
    const head = r.handle + ": " + r.scanned + " videos";
    if (r.reason === "baseline") {
      lines.push(head + ", baseline saved. Next run can compare.");
      continue;
    }
    if (r.reason !== "ok") {
      lines.push(head + ", " + r.reason + " over " + fmtSpan(r.elapsedDays) + ".");
    }

    for (const v of r.fresh) {
      lines.push("  NEW      " + v.title);
    }
    for (const v of r.alerts) {
      alertCount++;
      lines.push(
        "  " + v.ratio.toFixed(1) + "x".padEnd(7) + " +" + fmt(v.gained) +
        " in " + fmtSpan(r.elapsedDays) + "   " + v.title
      );
      lines.push("           https://youtu.be/" + v.id);
    }
    if (r.reason === "ok" && !r.alerts.length && !r.fresh.length) {
      lines.push(head + ", nothing unusual over " + fmtSpan(r.elapsedDays) + ".");
    }
  }

  return { text: lines.join("\n"), alertCount };
}

async function main() {
  const dry = process.argv.includes("--dry");
  let handles;
  try {
    handles = JSON.parse(fs.readFileSync(CHANNELS, "utf8"));
  } catch (e) {
    console.error("Could not read channels.json. Expected an array of handles.");
    process.exit(1);
  }

  const results = [];
  for (const handle of handles) {
    try {
      results.push(await pollChannel(handle, { dry }));
    } catch (e) {
      results.push({ handle, error: e.message });
    }
  }

  const report = renderReport(results);
  console.log(report.text || "Nothing to report.");
  if (dry) console.log("\n(dry run, no snapshots written)");
}

if (require.main === module) main();

module.exports = { findBreakouts, renderReport, median };
