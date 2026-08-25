/*
 * YouTube Channel Search+
 * Shared runtime state, the filter and sort pipeline, and the video grid.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- state ---------------------------------------------------------------
const state = {
  catalog: [], loading: false, active: false, enabling: false,
  nativeGrid: null, nativeDisplay: "",
  medianVpd: 0, medianViews: 0, view: "search", insight: "overview",
  newIds: new Set(), cachedAt: 0,
  watchlist: [], nicheItems: [], gapItems: [], nicheRan: false,
};
let ui = null;      // cached refs for the injected UI
let launcher = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- filtering + sorting -------------------------------------------------
function rangeVal(sel) {
  const v = sel.value;
  if (!v) return [0, Infinity];
  const parts = v.split("-");
  const min = parseFloat(parts[0]) || 0;
  const max = parts[1] === "" || parts[1] === undefined ? Infinity : parseFloat(parts[1]);
  return [min, max];
}

// YouTube marks a video finished well before 100%, so treat the tail as done.
function watchState(v) {
  if (typeof v.progress !== "number") return "new";
  if (v.progress >= cfg.finishedAt) return "done";
  if (v.progress > 0) return "partial";
  return "new";
}

function filterAndSort() {
  const kw = ui.kw.value.trim().toLowerCase();
  const [minDur, maxDur] = rangeVal(ui.duration);
  const [minViews, maxViews] = rangeVal(ui.views);
  const uploaded = ui.uploaded.value; // "", "7", "31", "93", "366", "old"
  const watched = ui.watched.value; // "", "new", "partial", "done", "unfinished"
  const sort = ui.sort.value;
  const fits = parseFloat(ui.fits.value) > 0 ? parseFloat(ui.fits.value) * 60 : Infinity;

  let rows = state.catalog.filter((v) => {
    if (kw && !v.title.toLowerCase().includes(kw)) return false;
    if (v.seconds > fits) return false;
    if (v.seconds < minDur || v.seconds > maxDur) return false;
    if (v.views < minViews || v.views > maxViews) return false;
    if (watched) {
      const ws = watchState(v);
      if (watched === "unfinished" ? ws === "done" : ws !== watched) return false;
    }
    if (uploaded) {
      if (uploaded === "old") {
        if (!(v.days != null && v.days > 366)) return false;
      } else if (!(v.days != null && v.days <= parseFloat(uploaded))) {
        return false;
      }
    }
    return true;
  });

  const vpd = (v) => (v.days ? v.views / Math.max(v.days, 1) : 0);
  // Punching above its weight: fast relative to the channel, small in absolute terms.
  const gem = (v) => {
    const rate = vpd(v) / (state.medianVpd || 1);
    const size = Math.max(0.25, v.views / (state.medianViews || 1));
    return rate / size;
  };
  const sorters = {
    views_desc: (a, b) => b.views - a.views,
    views_asc: (a, b) => a.views - b.views,
    duration_desc: (a, b) => b.seconds - a.seconds,
    duration_asc: (a, b) => a.seconds - b.seconds,
    vpd_desc: (a, b) => vpd(b) - vpd(a),
    trend_desc: (a, b) => (b.measuredVpd || 0) - (a.measuredVpd || 0),
    gems_desc: (a, b) => gem(b) - gem(a),
    title_az: (a, b) => a.title.localeCompare(b.title),
  };
  if (sort === "starthere") rows = startHere(rows);
  else if (sort === "oldest") rows = rows.slice().reverse();
  else if (sort !== "newest" && sorters[sort]) rows = rows.slice().sort(sorters[sort]);
  return rows;
}

/*
 * A sampler for landing on a big channel cold. Ranking by lifetime views just
 * hands you the oldest uploads, so score by views per day instead, then cap
 * how many come from any one year. You get the channel's best work spread
 * across its life rather than twelve videos from one hot month.
 */
function startHere(rows) {
  const PER_YEAR = 3;
  const nowYear = new Date().getFullYear();
  const scored = rows
    .map((v) => ({
      v: v,
      score: v.days ? v.views / Math.max(v.days, 1) : 0,
      year: v.days != null ? nowYear - Math.floor(v.days / 365) : 0,
    }))
    .sort((a, b) => b.score - a.score);

  const perYear = {};
  const picked = [];
  const rest = [];
  scored.forEach((s) => {
    perYear[s.year] = (perYear[s.year] || 0) + 1;
    if (perYear[s.year] <= PER_YEAR) picked.push(s);
    else rest.push(s);
  });
  return picked.concat(rest).map((s) => s.v);
}

function applyView() {
  if (!ui) return;
  const rows = filterAndSort();
  renderStats(rows);
  if (state.view === "insights") {
    if (state.insight === "overview") renderAnalytics(rows);
    else if (state.insight === "watchlist") renderNiche();
    // Compare renders when a channel is actually submitted, not on every keystroke.
  } else {
    renderGrid(rows);
  }
  ui.count.textContent = rows.length + " of " + state.catalog.length;

  const filtered = !!(ui.kw.value.trim() || ui.duration.value || ui.views.value ||
    ui.uploaded.value || ui.watched.value || ui.fits.value || ui.sort.value !== "newest");
  ui.clear.style.display = filtered ? "" : "none";
  ui.count.classList.toggle("ytcs-filtered", filtered);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Median absolute deviation. The spread measure that matches a median: unlike a
// standard deviation it is not dragged upward by the very outlier we are trying
// to find, so one breakout video cannot raise the bar it has to clear.
function mad(nums, mid) {
  if (!nums.length) return 0;
  return median(nums.map((x) => Math.abs(x - mid)));
}

/*
 * The wait on a cold channel is the product working, so it says so.
 *
 * Reading a full catalogue takes ten to twenty seconds, longer on a big
 * channel. The busy class only fades cards that already exist, so on a first
 * visit it dimmed an empty box and the whole panel sat blank with a small
 * counter in the header. That reads as broken, which for a lot of people on
 * their first run is where it ends.
 *
 * Naming what is happening turns the same wait into an explanation: the reason
 * this is slower than YouTube's own search is the reason it can answer
 * questions YouTube's cannot.
 */
function renderLoading(n) {
  ui.grid.innerHTML = "";
  const box = document.createElement("div");
  box.className = "ytcs-loading";

  const spinner = document.createElement("div");
  spinner.className = "ytcs-spinner";

  const head = document.createElement("div");
  head.className = "ytcs-loadhead";
  head.textContent = "Reading this channel's full catalogue";

  const sub = document.createElement("div");
  sub.className = "ytcs-loadsub";
  sub.textContent = n
    ? plural(n, "video") + " so far"
    : "This happens once, then it is cached";

  box.appendChild(spinner);
  box.appendChild(head);
  box.appendChild(sub);
  ui.grid.appendChild(box);
}

function renderStats(rows) {
  const n = rows.length;
  const totalViews = rows.reduce((s, v) => s + v.views, 0);
  const medViews = median(rows.map((v) => v.views));
  const avgDur = n ? Math.round(rows.reduce((s, v) => s + v.seconds, 0) / n) : 0;
  const vpds = rows.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
  const medVpd = median(vpds);
  // No video count here: the filter row already says "18 of 177", and repeating
  // it in a tile was one of six identical boxes competing for the same glance.
  const tiles = [
    ["total views", fmtCompact(totalViews)],
    ["median views", fmtCompact(medViews)],
    ["avg length", fmtDuration(avgDur) || "–"],
    ["median views/day", fmtCompact(Math.round(medVpd))],
  ];
  // Only meaningful when this account actually has history on the channel.
  if (state.catalog.some((v) => typeof v.progress === "number")) {
    tiles.push(["not started", String(rows.filter((v) => watchState(v) === "new").length)]);
  }
  ui.stats.innerHTML = "";
  tiles.forEach(([label, val], i) => {
    if (i) {
      const dot = document.createElement("span");
      dot.className = "ytcs-statdot";
      dot.textContent = "·";
      ui.stats.appendChild(dot);
    }
    const tile = document.createElement("span");
    tile.className = "ytcs-stat";
    const vEl = document.createElement("span");
    vEl.className = "ytcs-statval";
    vEl.textContent = val;
    const lEl = document.createElement("span");
    lEl.className = "ytcs-statlabel";
    lEl.textContent = label;
    tile.appendChild(vEl);
    tile.appendChild(lEl);
    ui.stats.appendChild(tile);
  });
}

function renderGrid(rows) {
  const frag = document.createDocumentFragment();
  const shown = rows.slice(0, 600);
  for (const v of shown) {
    const ws = watchState(v);
    const card = document.createElement("a");
    card.className = "ytcs-card" + (ws === "done" ? " ytcs-seen" : "");
    card.href = "/watch?v=" + v.id;

    const thumb = document.createElement("div");
    thumb.className = "ytcs-thumb";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = "https://i.ytimg.com/vi/" + v.id + "/hqdefault.jpg";
    thumb.appendChild(img);
    const durText = fmtDuration(v.seconds);
    if (durText) {
      const d = document.createElement("span");
      d.className = "ytcs-dur";
      d.textContent = durText;
      thumb.appendChild(d);
    }
    if (ws !== "new") {
      const track = document.createElement("span");
      track.className = "ytcs-prog";
      const fill = document.createElement("span");
      fill.className = "ytcs-progfill";
      fill.style.width = Math.min(100, Math.max(2, v.progress)) + "%";
      track.appendChild(fill);
      thumb.appendChild(track);
    }

    const info = document.createElement("div");
    info.className = "ytcs-info";
    const t = document.createElement("div");
    t.className = "ytcs-ctitle";
    t.textContent = v.title;
    t.title = v.title;
    const meta = document.createElement("div");
    meta.className = "ytcs-cmeta";
    meta.textContent = [fmtCompact(v.views) + " views", v.publishedText]
      .filter(Boolean).join("  •  ");
    info.appendChild(t);
    info.appendChild(meta);
    const vpdVal = v.days ? v.views / Math.max(v.days, 1) : 0;
    if (v.days) {
      const vpd = document.createElement("div");
      vpd.className = "ytcs-cvpd";
      vpd.textContent = "≈ " + fmtCompact(Math.round(vpdVal)) + " views/day";
      info.appendChild(vpd);
    }
    if (v.gained > 0 && v.sinceDays) {
      const span = v.sinceDays < 1
        ? Math.max(1, Math.round(v.sinceDays * 24)) + "h"
        : Math.round(v.sinceDays) + "d";
      const measured = document.createElement("div");
      measured.className = "ytcs-cmeasured";
      measured.textContent = "+" + fmtCompact(Math.round(v.gained)) + " in the last " + span;
      info.appendChild(measured);
    }
    /*
     * Cards used to carry an outlier badge here, a multiplier of the video's
     * views per day against the channel's median. It was removed for the same
     * reason the rising/fading verdict was: it divided a recent upload's launch
     * spike by a lifetime average made mostly of old videos, so the number was
     * inflated by construction and the badges reading "376.1x" were mostly
     * saying "this video is new". Sorting by views per day still ranks the same
     * videos, without printing a figure that cannot be defended.
     */
    if (state.newIds && state.newIds.has(v.id)) {
      const nb = document.createElement("span");
      nb.className = "ytcs-new";
      nb.textContent = "NEW";
      thumb.appendChild(nb);
    }

    card.appendChild(thumb);
    card.appendChild(info);
    frag.appendChild(card);
  }
  ui.grid.innerHTML = "";
  ui.grid.appendChild(frag);
  if (!shown.length && !state.loading) {
    const empty = document.createElement("div");
    empty.className = "ytcs-empty";
    empty.textContent = state.catalog.length ? "No videos match these filters." : "Click Search+ to load this channel.";
    ui.grid.appendChild(empty);
  }
  if (rows.length > shown.length) {
    const more = document.createElement("div");
    more.className = "ytcs-more";
    more.textContent = "Showing the first 600 of " + rows.length + ". Narrow the filters to see the rest.";
    ui.grid.appendChild(more);
  }
}
