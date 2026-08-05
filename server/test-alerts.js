/*
 * Exercises the breakout logic against a fabricated previous snapshot, since
 * waiting a day between real polls is a poor way to find out the maths is wrong.
 *
 *   node test-alerts.js
 */

const { findBreakouts } = require("./monitor");

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "  pass  " : "  FAIL  ") + name);
  if (!ok) {
    console.log("          expected " + JSON.stringify(want));
    console.log("          got      " + JSON.stringify(got));
    failures++;
  }
}

const DAY = 86400000;

/*
 * Numbers here have to look like real listing data, which is rounded to two
 * significant figures. At 500,000 views the step is 10,000, so a routine gain
 * of 30,000 is three steps and comfortably observable, and anything finer is
 * something the monitor genuinely cannot see.
 */
const BASE_VIEWS = 500000;
const ROUTINE_GAIN = 30000;

function scenario(hotGain, count) {
  const videos = [];
  const views = {};
  const n = count == null ? 10 : count;
  for (let i = 0; i < n; i++) {
    const id = "vid" + i;
    views[id] = BASE_VIEWS;
    videos.push({ id, title: "Routine upload " + i, views: BASE_VIEWS + ROUTINE_GAIN, seconds: 600 });
  }
  views.hot = BASE_VIEWS;
  videos.push({ id: "hot", title: "The breakout", views: BASE_VIEWS + hotGain, seconds: 600 });
  return { videos, previous: { t: Date.now() - DAY, views } };
}

console.log("\nbreakout detection");

{
  const { videos, previous } = scenario(300000);
  const r = findBreakouts(videos, previous);
  check("flags the outlier", r.alerts.map((a) => a.id), ["hot"]);
  check("reports the real gain", r.alerts[0].gained, 300000);
  check("ratio is gain over channel median pace", Math.round(r.alerts[0].ratio), 10);
  check("routine uploads stay quiet", r.alerts.length, 1);
}

{
  // Everything moving together is a channel-wide bump, not a breakout.
  const { videos, previous } = scenario(ROUTINE_GAIN);
  const r = findBreakouts(videos, previous);
  check("uniform growth alerts nobody", r.alerts.length, 0);
}

console.log("\nnew uploads");

{
  const { videos, previous } = scenario(ROUTINE_GAIN);
  videos.push({ id: "brandnew", title: "Posted since last poll", views: 4000, seconds: 300 });
  const r = findBreakouts(videos, previous);
  check("unseen video is reported as new", r.fresh.map((f) => f.id), ["brandnew"]);
  check("and is not double counted as an alert", r.alerts.some((a) => a.id === "brandnew"), false);
}

console.log("\nguards");

{
  const { videos } = scenario(20000);
  const r = findBreakouts(videos, null);
  check("first ever poll only sets a baseline", r.reason, "baseline");
}

{
  // Only three videos moved observably. A median over three readings is really
  // just the middle one, so it should decline rather than invent an outlier.
  const { videos, previous } = scenario(300000, 3);
  const r = findBreakouts(videos, previous);
  check("too small a sample declines to judge", r.reason, "too little movement to judge");
}

console.log("\nmeasurement resolution");

{
  // At 2.4M views the listing moves in steps of 100,000, so a 40,000 gain is
  // inside the rounding error and must not be treated as real movement.
  const views = {};
  const videos = [];
  for (let i = 0; i < 10; i++) {
    views["v" + i] = 2400000;
    videos.push({ id: "v" + i, title: "v" + i, views: 2440000 });
  }
  const r = findBreakouts(videos, { t: Date.now() - DAY, views });
  check("gains inside the rounding error are not movement", r.reason, "too little movement to judge");
}

{
  // A single step across a boundary looks like +100,000 but could be a handful
  // of real views, so one step alone must not qualify either.
  const views = {};
  const videos = [];
  for (let i = 0; i < 10; i++) {
    views["v" + i] = 2400000;
    videos.push({ id: "v" + i, title: "v" + i, views: 2500000 });
  }
  const r = findBreakouts(videos, { t: Date.now() - DAY, views });
  check("one rounding step alone is not movement", r.reason, "too little movement to judge");
}

console.log(failures ? "\n" + failures + " failing\n" : "\nall passing\n");
process.exit(failures ? 1 : 0);
