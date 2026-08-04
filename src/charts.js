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
// `onBar` makes the columns clickable so a chart can drive the grid filters.
function barChart(data, onBar) {
  const W = 340, H = 172, pad = { t: 14, r: 8, b: 30, l: 8 };
  const max = Math.max(1, Math.max.apply(null, data.map((d) => d.value)));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const slot = iw / (data.length || 1);
  const bw = Math.min(slot * 0.68, 46);
  const root = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "ytcs-svg", preserveAspectRatio: "xMidYMid meet" });
  data.forEach((d, i) => {
    const h = (d.value / max) * ih;
    const x = pad.l + i * slot + (slot - bw) / 2;
    const y = pad.t + (ih - h);
    root.appendChild(svg("rect", { x: x, y: y, width: bw, height: Math.max(h, 1), rx: 3, class: "ytcs-bar" }));
    if (d.value) root.appendChild(svgText(x + bw / 2, y - 4, fmtCompact(d.value), "ytcs-barval"));
    root.appendChild(svgText(x + bw / 2, H - 12, d.label, "ytcs-barlab"));
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
  const W = 340, H = 172, pad = { t: 18, r: 14, b: 30, l: 14 };
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
  pts.forEach((p, i) => {
    root.appendChild(svg("circle", { cx: p.x, cy: p.y, r: 2.6, class: "ytcs-lpt" }));
    root.appendChild(svgText(p.x, H - 12, p.d.label, "ytcs-barlab"));
    if (i === peak) root.appendChild(svgText(p.x, p.y - 8, fmtCompact(p.d.value), "ytcs-barval"));
  });
  return root;
}

function chartCard(title, node) {
  const card = document.createElement("div");
  card.className = "ytcs-chart";
  const h = document.createElement("div");
  h.className = "ytcs-charttitle";
  h.textContent = title;
  card.appendChild(h);
  card.appendChild(node);
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
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const uploads = years.map((y) => ({ label: "'" + String(y).slice(2), value: byYear[y] }));
  ui.charts.appendChild(chartCard("Uploads per year", uploads.length ? barChart(uploads) : chartEmpty()));

  // Trajectory: is the channel's typical video getting bigger or smaller?
  const trajectory = years.map((y) => {
    const cohort = rows.filter((v) => v.days != null && nowYear - Math.floor(v.days / 365) === y);
    return { label: "'" + String(y).slice(2), value: Math.round(median(cohort.map((v) => v.views))) };
  });
  ui.charts.appendChild(chartCard("Median views by upload year", trajectory.length ? barChart(trajectory) : chartEmpty()));

  const viewsData = bucketCounts(rows, VIEW_BUCKETS, (v) => v.views);
  ui.charts.appendChild(chartCard("Views distribution", barChart(viewsData, (i) => {
    ui.views.value = VIEW_VALUES[i];
    setView("grid");
  })));

  const lenData = bucketCounts(rows, LEN_BUCKETS, (v) => v.seconds);
  ui.charts.appendChild(chartCard("Length distribution", barChart(lenData, (i) => {
    ui.duration.value = LEN_VALUES[i];
    setView("grid");
  })));

  // Where the channel's sweet spot actually is. Bins with fewer than two
  // videos are dropped so one outlier cannot invent a peak.
  const curve = LENGTH_CURVE
    .map((b) => {
      const hit = rows.filter((v) => v.seconds >= b[1] && v.seconds < b[2]);
      return { label: b[0], value: hit.length >= 2 ? Math.round(median(hit.map((v) => v.views))) : null };
    })
    .filter((d) => d.value != null);
  ui.charts.appendChild(chartCard("Median views by video length", curve.length > 1 ? lineChart(curve) : chartEmpty()));
}
