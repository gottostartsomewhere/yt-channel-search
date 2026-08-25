/*
 * YouTube Channel Search+
 * Dependency-free SVG charts and the analytics pane that arranges them.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- tiny SVG charts (no libraries, CSP-safe) ----------------------------
const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  (kids || []).forEach((c) => el.appendChild(c));
  return el;
}
function svgText(x, y, s, cls) {
  const t = svg("text", { x: x, y: y, "text-anchor": "middle", class: cls });
  t.textContent = s;
  return t;
}
/*
 * `onBar` makes the columns clickable so a chart can drive the grid filters.
 *
 * The tallest bar is drawn in the accent. Every one of these charts exists to
 * answer "where is the peak", so colouring the answer is the chart doing its
 * job rather than decoration, and it means each card can be read in a glance
 * without going to the note underneath.
 */
function barChart(data, onBar) {
  const W = 340, H = 128, pad = { t: 14, r: 8, b: 26, l: 8 };
  const max = Math.max(1, Math.max.apply(null, data.map((d) => d.value)));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const slot = iw / (data.length || 1);
  const bw = Math.min(slot * 0.68, 46);
  const top = peakIndex(data);
  /*
   * A value label per bar runs them into each other once there are enough
   * bars: twelve years in a 340-unit viewBox leaves 27 units a slot, and
   * "254.0K" needs closer to 40, so the row renders as "64.0K47.0K68.0K".
   * When they will not fit, only the peak keeps its label. The peak is the
   * finding; the others were texture.
   */
  const widest = data.reduce((w, d) => Math.max(w, d.value ? fmtCompact(d.value).length : 0), 0);
  const valuesFit = widest * 10.5 * 0.58 <= slot - 2;
  const root = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "ytcs-svg", preserveAspectRatio: "xMidYMid meet" });
  data.forEach((d, i) => {
    const isTop = i === top && d.value > 0;
    const h = (d.value / max) * ih;
    const x = pad.l + i * slot + (slot - bw) / 2;
    const y = pad.t + (ih - h);
    root.appendChild(svg("rect", {
      x: x, y: y, width: bw, height: Math.max(h, 1), rx: 3,
      class: "ytcs-bar" + (isTop ? " ytcs-bar-peak" : ""),
    }));
    if (d.value && (valuesFit || isTop)) {
      root.appendChild(svgText(x + bw / 2, y - 5, fmtCompact(d.value), "ytcs-barval" + (isTop ? " ytcs-barval-peak" : "")));
    }
    // Same crowding problem on the axis once the year count climbs. Every
    // other tick still carries the shape without the labels touching.
    if (slot >= 22 || i % 2 === 0 || isTop) {
      root.appendChild(svgText(x + bw / 2, H - 9, d.label, "ytcs-barlab" + (isTop ? " ytcs-barlab-peak" : "")));
    }
    if (onBar) {
      const hit = svg("rect", { x: pad.l + i * slot, y: pad.t, width: slot, height: ih, class: "ytcs-hit" });
      hit.addEventListener("click", () => onBar(i));
      root.appendChild(hit);
    }
  });
  return root;
}
// Line chart for a value that has a shape across ordered bins.
function lineChart(data) {
  const W = 340, H = 128, pad = { t: 16, r: 14, b: 26, l: 14 };
  const max = Math.max(1, Math.max.apply(null, data.map((d) => d.value)));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const step = data.length > 1 ? iw / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({
    x: pad.l + i * step,
    y: pad.t + ih - (d.value / max) * ih,
    d: d,
  }));
  const root = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "ytcs-svg", preserveAspectRatio: "xMidYMid meet" });
  root.appendChild(svg("line", { x1: pad.l, y1: pad.t + ih, x2: pad.l + iw, y2: pad.t + ih, class: "ytcs-axis" }));
  root.appendChild(svg("polyline", {
    points: pts.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" "),
    class: "ytcs-line",
  }));
  let peak = 0;
  pts.forEach((p, i) => { if (p.d.value > pts[peak].d.value) peak = i; });
  // Drop a rule from the peak to the axis. On a sweet-spot curve the reader
  // wants the x position, not the y value, so the line to the label is the
  // part that carries the finding.
  const pk = pts[peak];
  root.appendChild(svg("line", {
    x1: pk.x, y1: pk.y, x2: pk.x, y2: pad.t + ih, class: "ytcs-ldrop",
  }));
  pts.forEach((p, i) => {
    const isTop = i === peak;
    root.appendChild(svg("circle", { cx: p.x, cy: p.y, r: isTop ? 4.2 : 2.4, class: isTop ? "ytcs-lpt ytcs-lpt-peak" : "ytcs-lpt" }));
    root.appendChild(svgText(p.x, H - 9, p.d.label, "ytcs-barlab" + (isTop ? " ytcs-barlab-peak" : "")));
    if (isTop) root.appendChild(svgText(p.x, p.y - 10, fmtCompact(p.d.value), "ytcs-barval ytcs-barval-peak"));
  });
  return root;
}

/*
 * Every card carries one sentence saying what the chart means for this channel.
 * A bar chart on its own is a number the reader still has to interpret, and
 * "here is your data, work it out" is the loudest complaint aimed at the tools
 * this competes with. The note is always derived from the rows on screen, and
 * it is omitted rather than hedged when the sample is too thin to support it.
 */
function chartCard(title, node, note, wide) {
  const card = document.createElement("div");
  card.className = "ytcs-chart" + (wide ? " ytcs-chart-wide" : "");
  const h = document.createElement("div");
  h.className = "ytcs-charttitle";
  h.textContent = title;
  card.appendChild(h);
  card.appendChild(node);
  if (note) {
    const n = document.createElement("div");
    n.className = "ytcs-chartnote";
    n.textContent = note;
    card.appendChild(n);
  }
  return card;
}
function chartEmpty() {
  const d = document.createElement("div");
  d.className = "ytcs-chartempty";
  d.textContent = "not enough data";
  return d;
}

// ---- analytics view ------------------------------------------------------
function bucketCounts(rows, buckets, valueOf) {
  return buckets.map((b) => ({
    label: b[0],
    value: rows.filter((v) => valueOf(v) >= b[1] && valueOf(v) < b[2]).length,
  }));
}
// ---- reading the charts --------------------------------------------------
// Each of these returns one sentence, or "" when the data cannot support one.

function peakIndex(data) {
  let best = 0;
  data.forEach((d, i) => { if (d.value > data[best].value) best = i; });
  return best;
}

function uploadsNote(uploads) {
  if (uploads.length < 3) return "";
  // The newest bin is the current year and is still filling, so comparing to it
  // would report every channel as collapsing every January.
  const settled = uploads.slice(0, -1);
  const peak = peakIndex(settled);
  const last = settled[settled.length - 1];
  if (!settled[peak].value) return "";
  if (peak === settled.length - 1) {
    return "Output is at its highest in " + last.label + ", " + plural(last.value, "upload") + ".";
  }
  const drop = Math.round((1 - last.value / settled[peak].value) * 100);
  if (drop < 15) return "Output has held roughly steady since " + settled[peak].label + ".";
  return "Output peaked in " + settled[peak].label + " and is down " + drop + "% by " + last.label + ".";
}

/*
 * Direction of travel, over a recent window rather than a lifetime.
 *
 * Two earlier versions of this were wrong in the same way. Dividing the newest
 * year by the very first reported "114.1x bigger than in '13"; comparing whole
 * halves still gave 41.1x. Both are arithmetically right and both answer a
 * question nobody asked, because a channel's opening years are near zero and
 * any ratio anchored to them comes out enormous and positive no matter what
 * has happened since.
 *
 * The damage was not just an ugly number. On a channel that peaked in '21 and
 * has been below that ever since, the lifetime comparison still said "rising",
 * because six near-empty years from a decade ago outvoted the recent decline.
 * A three-year window against the three before it asks whether the channel is
 * growing now, which is the thing being read off this chart.
 *
 * The current year is excluded from the comparison. It is still filling, and
 * its videos have had the least time to accumulate views, so it always reads
 * low. It stays on the chart, because it is real, but it does not get a vote
 * on the trend.
 */
const TRAJECTORY_WINDOW = 3;

function trajectoryYears(traj, nowYear) {
  return traj.filter((d) => d.value > 0 && (nowYear == null || d.year !== nowYear));
}

function trajectoryRatio(solid) {
  if (solid.length < 4) return null;
  const w = Math.min(TRAJECTORY_WINDOW, Math.floor(solid.length / 2));
  const recentYears = solid.slice(solid.length - w);
  const earlierYears = solid.slice(solid.length - w * 2, solid.length - w);
  const earlier = median(earlierYears.map((d) => d.value));
  const recent = median(recentYears.map((d) => d.value));
  if (!earlier) return null;
  return { x: recent / earlier, recentYears: recentYears, earlierYears: earlierYears };
}

/*
 * "'21-'25" is only honest when those years run consecutively. A channel that
 * went quiet through '22 and '23 has three data years with a hole in the
 * middle, and a range label claims a span that is not there, so a gapped
 * window gets its years listed instead.
 */
function yearSpan(years) {
  if (years.length === 1) return years[0].label;
  const contiguous = years[years.length - 1].year - years[0].year === years.length - 1;
  if (contiguous) return years[0].label + "-" + years[years.length - 1].label;
  return years.map((d) => d.label).join(", ");
}

function trajectoryNote(traj, nowYear) {
  const solid = trajectoryYears(traj, nowYear);
  const r = trajectoryRatio(solid);
  if (!r) return "";
  const head = "Median views across " + yearSpan(r.recentYears) + " are " +
    r.x.toFixed(1) + "x " + yearSpan(r.earlierYears) + ". ";
  if (r.x >= 1.25) return head + "Rising.";
  if (r.x <= 0.8) return head + "Fading.";
  return head + "Holding flat.";
}

function shareNote(data, total, noun) {
  if (!total) return "";
  const top = peakIndex(data);
  if (!data[top].value) return "";
  const pct = Math.round((data[top].value / total) * 100);
  return pct + "% of the catalogue sits in the " + data[top].label + " " + noun + ".";
}

/*
 * What the length curve is allowed to claim.
 *
 * A "sweet spot" means an interior peak: performance climbs to some runtime
 * and falls away after it. When the best bin is the longest one the curve is
 * still rising where the data runs out, and the honest reading is not that
 * long videos are better but that long videos are rare and self-selected. A
 * channel averaging under seven minutes only makes a twenty-five minute video
 * when it is a big production, so of course those few overperform. Saying
 * "20-30m is the sweet spot, at 29.5x the channel median" off the back of that
 * is a confident claim built on a handful of videos.
 */
function curveNote(curve, base) {
  if (curve.length < 2 || !base) return "";
  const best = peakIndex(curve);
  const lift = curve[best].value / base;
  if (lift < 1.15) return "No length clearly outperforms. Runtime is not what decides this channel.";
  if (best === curve.length - 1) {
    return "Performance is still climbing at " + curve[best].label + ", the longest runtime with enough " +
      "uploads to measure. Long videos are rare here, so treat this as a hint rather than a finding.";
  }
  return curve[best].label + " is the sweet spot, at " + lift.toFixed(1) + "x the channel median.";
}

/*
 * ---- headline finding ----------------------------------------------------
 *
 * The two things worth knowing before any chart, written as a sentence.
 *
 * This used to be four big numbers under uppercase captions, but two of them
 * (videos read, median views) already sit in the summary line above, and a
 * number under a caption makes the reader do the interpreting. Sweet spot and
 * trajectory are conclusions, so they are stated as conclusions. The count
 * stays as provenance rather than as a statistic of its own.
 */
function headlineFinding(count, sweet, arc) {
  if (!sweet && !arc) return null;
  const p = document.createElement("p");
  p.className = "ytcs-finding";

  const add = (text, accent) => {
    const el = document.createElement(accent ? "strong" : "span");
    if (accent) el.className = "ytcs-fval";
    el.textContent = text;
    p.appendChild(el);
  };

  add("Across " + plural(count, "video") + ", ");
  if (sweet) {
    add("the sweet spot is ");
    add(sweet, true);
  }
  if (sweet && arc) add(" and ");
  if (arc) {
    add("the typical upload is ");
    add(arc, true);
  }
  add(".");
  return p;
}

function renderAnalytics(rows) {
  ui.charts.innerHTML = "";

  const nowYear = new Date().getFullYear();
  const byYear = {};
  rows.forEach((v) => {
    if (v.days != null) {
      const y = nowYear - Math.floor(v.days / 365);
      byYear[y] = (byYear[y] || 0) + 1;
    }
  });
  /*
   * Every year from first to last, including the silent ones.
   *
   * Listing only the years that have uploads drops the gaps, so a channel that
   * posted nothing in '23 and '24 drew '22 flush against '25 and the trend
   * read as continuous. On a time series that is not a cosmetic problem: the
   * gap is often the most interesting thing on the chart.
   */
  const present = Object.keys(byYear).map(Number);
  const years = [];
  if (present.length) {
    for (let y = Math.min.apply(null, present); y <= Math.max.apply(null, present); y++) years.push(y);
  }
  const uploads = years.map((y) => ({ label: "'" + String(y).slice(2), value: byYear[y] || 0 }));

  // Trajectory: is the channel's typical video getting bigger or smaller?
  // Carries the year itself, so the trend can exclude the one still filling.
  const trajectory = years.map((y) => {
    const cohort = rows.filter((v) => v.days != null && nowYear - Math.floor(v.days / 365) === y);
    return { label: "'" + String(y).slice(2), year: y, value: Math.round(median(cohort.map((v) => v.views))) };
  });

  const viewsData = bucketCounts(rows, VIEW_BUCKETS, (v) => v.views);
  const lenData = bucketCounts(rows, LEN_BUCKETS, (v) => v.seconds);

  /*
   * Two videos used to be enough for a bin to count, which is how a channel
   * averaging 6:46 ended up being told its sweet spot was 20-30m at 29.5x the
   * median: a couple of long, heavily produced uploads landed in an otherwise
   * empty bin and their median became a "finding". A bin now has to hold a
   * real share of the catalogue before it is allowed to say anything.
   */
  const minBin = Math.max(5, Math.round(rows.length * 0.03));
  const curve = LENGTH_CURVE
    .map((b) => {
      const hit = rows.filter((v) => v.seconds >= b[1] && v.seconds < b[2]);
      return { label: b[0], value: hit.length >= minBin ? Math.round(median(hit.map((v) => v.views))) : null };
    })
    .filter((d) => d.value != null);

  const medViews = median(rows.map((v) => v.views));
  const peak = curve.length > 1 ? peakIndex(curve) : -1;
  // Only an interior peak earns the phrase "sweet spot". A curve still rising
  // at its last bin has not found one, it has run out of data, and the note
  // under the chart says so at more length.
  const sweet =
    peak > -1 && peak < curve.length - 1 && curve[peak].value > medViews * 1.15
      ? curve[peak].label
      : "";

  const ratio = trajectoryRatio(trajectoryYears(trajectory, nowYear));
  const arc = ratio ? (ratio.x >= 1.25 ? "rising" : ratio.x <= 0.8 ? "fading" : "flat") : "";

  const strip = headlineFinding(rows.length, sweet, arc);
  if (strip) ui.charts.appendChild(strip);

  /*
   * Findings first, evidence after. The length curve and the year-on-year
   * median are the two charts that answer a question ("what should I make",
   * "is this channel worth watching"), so they get the width. Uploads and the
   * two distributions describe the catalogue rather than concluding anything,
   * so they sit underneath at a third each.
   */
  ui.charts.appendChild(chartCard(
    "Median views by video length",
    curve.length > 1 ? lineChart(curve) : chartEmpty(),
    curveNote(curve, medViews),
    true
  ));
  ui.charts.appendChild(chartCard(
    "Median views by upload year",
    trajectory.length ? barChart(trajectory) : chartEmpty(),
    trajectoryNote(trajectory, nowYear),
    true
  ));
  ui.charts.appendChild(chartCard(
    "Uploads per year",
    uploads.length ? barChart(uploads) : chartEmpty(),
    uploadsNote(uploads)
  ));
  // Clicking a bar sets the matching filter and drops you into Search to see
  // what it selected. The pill has to be un-dimmed by hand, since assigning
  // .value does not fire the change event that normally does it.
  const crossFilter = (el, value) => {
    el.value = value;
    el.classList.toggle("ytcs-dim", !value);
    setView("search");
  };
  ui.charts.appendChild(chartCard(
    "Views distribution",
    barChart(viewsData, (i) => crossFilter(ui.views, VIEW_VALUES[i])),
    shareNote(viewsData, rows.length, "band")
  ));
  ui.charts.appendChild(chartCard(
    "Length distribution",
    barChart(lenData, (i) => crossFilter(ui.duration, LEN_VALUES[i])),
    shareNote(lenData, rows.length, "range")
  ));
}
