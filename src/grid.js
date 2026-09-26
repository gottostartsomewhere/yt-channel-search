/*
 * Needle for YouTube
 * Shared runtime state, the filter and sort pipeline, and the video grid.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- state ---------------------------------------------------------------
/*
 * Filters that exist only as typed operators or custom ranges, with no select
 * of their own. Ages are in days, so after:2023 is a maxAge and "watched in
 * August" is a watchedMin/watchedMax pair counted back from today.
 */
function freshExtra() {
  return {
    channel: "", notChannels: [], excludes: [],
    minAge: 0, maxAge: Infinity,
    watchedMin: 0, watchedMax: Infinity, watchedText: "",
    lang: "", fresh: false,
  };
}

const state = {
  catalog: [], loading: false, active: false, enabling: false,
  // Every grid the panel has hidden, as {el, display}. A single reference was
  // not enough: see hideNativeGrids in panel.js.
  hiddenGrids: [],
  medianVpd: 0, medianViews: 0, view: "search", insight: "overview",
  newIds: new Set(), cachedAt: 0,
  watchlist: [], nicheItems: [], gapItems: [], nicheRan: false,
  // Set by the search bar (omnibar.js): which of your lists a scoped query
  // asked for, filters waiting for the panel to open, and what the library
  // strip above the results is matching.
  omniScope: "", pendingOmni: null, stripFilters: null,
  extra: freshExtra(),
  // The live search sessions behind the results page, so Load more can resume.
  searchCtx: null,
  // A followed search's new videos, on their way to the panel as NEW.
  followFresh: null,
  // Counts navigations. Anything slow remembers the value it started under and
  // drops its result if it changed: see pageGone in panel.js.
  navGen: 0,
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
  const x = state.extra;
  const muteHere = isSearchPage() && !state.omniScope;
  /*
   * Every word, anywhere in the title or channel, rather than the whole phrase
   * in one piece: "async rust" finds "Rust async explained". Your own history
   * and lists also forgive a typo, since they are searched from memory; a
   * channel's catalogue and search results match as typed.
   */
  const kwWords = kw ? kw.split(/\s+/).filter(Boolean) : [];
  const forgiving = listHasWatchDates() || !!state.omniScope;

  let rows = state.catalog.filter((v) => {
    if (x.channel && !matchChannel(v, x.channel)) return false;
    if (x.excludes.length) {
      const hay = (v.title + " " + (v.channel || "")).toLowerCase();
      if (x.excludes.some((w) => hay.includes(w))) return false;
    }
    // Upload age always, even on history: after:2023 is about when it was made.
    if (x.minAge && !(v.days != null && v.days >= x.minAge)) return false;
    if (x.maxAge !== Infinity && !(v.days != null && v.days <= x.maxAge)) return false;
    if (x.watchedMin || x.watchedMax !== Infinity) {
      if (!(typeof v.watchedDays === "number" && v.watchedDays >= x.watchedMin && v.watchedDays <= x.watchedMax)) return false;
    }
    if (x.notChannels.length && x.notChannels.some((c) => matchChannel(v, c))) return false;
    // Muted channels only leave search results. Your own lists and a channel
    // you opened on purpose are yours to see in full.
    if (muteHere && isMuted(v)) return false;
    if (x.lang && !langMatches(v.title, x.lang)) return false;
    if (x.fresh && !isFresh(v)) return false;
    if (kwWords.length && !matchScore(v, kwWords, forgiving)) return false;
    if (v.seconds > fits) return false;
    if (v.seconds < minDur || v.seconds > maxDur) return false;
    if (v.views < minViews || v.views > maxViews) return false;
    if (watched) {
      const ws = watchState(v);
      if (watched === "unfinished" ? ws === "done" : ws !== watched) return false;
    }
    if (uploaded) {
      /*
       * The date pill means different things on the two surfaces. On a channel
       * it is upload age, which is the only date there. On history the date
       * anyone is actually thinking about is when they watched it, so the same
       * control filters on that instead and the panel relabels it to say so.
       */
      const age = listHasWatchDates() ? v.watchedDays : v.days;
      if (uploaded === "old") {
        if (!(age != null && age > 366)) return false;
      } else if (!(age != null && age <= parseFloat(uploaded))) {
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
  // Unknown watch dates sort last in both directions rather than clumping at
  // whichever end happens to be numerically convenient.
  const wdLast = (v) => (typeof v.watchedDays === "number" ? v.watchedDays : Infinity);
  const wdFirst = (v) => (typeof v.watchedDays === "number" ? v.watchedDays : -1);
  // Upload order where position means nothing (search results, your lists).
  const ageNew = (v) => (v.days != null ? v.days : Infinity);
  const ageOld = (v) => (v.days != null ? v.days : -1);
  const sorters = {
    upload_new: (a, b) => ageNew(a) - ageNew(b),
    upload_old: (a, b) => ageOld(b) - ageOld(a),
    // watchedDays counts backwards from today, so ascending is most recent.
    watched_desc: (a, b) => wdLast(a) - wdLast(b),
    watched_asc: (a, b) => wdFirst(b) - wdFirst(a),
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
  // Nothing loaded yet is not "0 of 0", which reads as "nothing found".
  const total = state.catalog.length;
  ui.count.textContent = total ? rows.length + " of " + total : "";
  if (ui.meterFill) ui.meterFill.style.width = (total ? (rows.length / total) * 100 : 0) + "%";

  /*
  * Two different questions, which used to share one answer.
  *
  * Clear appears whenever anything is off default, sort included, because
  * resetting the sort is part of what it does. The count only goes accent when
  * the set was actually narrowed. Changing sort order alone used to paint
  * "22 of 22" in the filtered colour, which claims a filter ran when nothing
  * was removed.
  */
  const narrowed = rows.length !== state.catalog.length;
  const x = state.extra;
  const touched = !!(ui.kw.value.trim() || ui.duration.value || ui.views.value ||
    ui.uploaded.value || ui.watched.value || ui.fits.value || ui.sort.value !== "newest" ||
    extraTokens().length);
  ui.clear.style.display = touched ? "" : "none";
  ui.count.classList.toggle("ytcs-filtered", narrowed);
  ui.count.parentElement.classList.toggle("ytcs-narrowed", narrowed);
  if (typeof layoutTokens === "function") layoutTokens();

  // A narrowed set is the tool having worked, which is when the rating ask
  // counts a use. Guarded on typeof because panel.js defines it and this file
  // loads first: a broken ask must never be able to take the grid down with it.
  if (narrowed && typeof tickRating === "function") tickRating();
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

  // Says what is actually being read. A search is not a channel, and it is not
  // cached either, so the channel's promise would be false on both counts.
  const search = typeof isSearchPage === "function" && isSearchPage() && !state.omniScope;
  const head = document.createElement("div");
  head.className = "ytcs-loadhead";
  head.textContent = search ? "Reading the first 200 or so results"
    : isHistoryPage() || state.omniScope === "hist" ? "Reading your watch history"
    : state.omniScope ? "Reading your " + LIB_NAMES[state.omniScope]
    : ownListScope() ? "Reading your " + LIB_NAMES[ownListScope()]
    : "Reading this channel's full catalogue";

  const sub = document.createElement("div");
  sub.className = "ytcs-loadsub";
  sub.textContent = n
    ? plural(n, search ? "result" : "video") + " so far"
    : search ? "About ten seconds, then filtering is instant"
    : state.omniScope || ownListScope() ? "A few seconds, then filtering is instant"
    : "This happens once, then it is cached";

  box.appendChild(spinner);
  box.appendChild(head);
  box.appendChild(sub);
  ui.grid.appendChild(box);
}

function renderStats(rows) {
  // Nothing loaded is not a channel with zero views.
  ui.stats.style.display = state.catalog.length ? "" : "none";
  const n = rows.length;
  const totalViews = rows.reduce((s, v) => s + v.views, 0);
  // An even count puts the median between two videos, and "209.5 views" is a
  // precision view counts never had.
  const medViews = Math.round(median(rows.map((v) => v.views)));
  const avgDur = n ? Math.round(rows.reduce((s, v) => s + v.seconds, 0) / n) : 0;
  // No video count here: the query line already says "18 of 177". Label first,
  // value after, spaced rather than dotted: "Median views 318" reads as a fact,
  // "318 median views" read as a sentence missing its start.
  const tiles = [
    ["Total views", fmtCompact(totalViews)],
    ["Median views", fmtCompact(medViews)],
    ["Average length", fmtDuration(avgDur) || "–"],
  ];
  // Only meaningful when this account actually has history on the channel.
  if (state.catalog.some((v) => typeof v.progress === "number")) {
    tiles.push(["Not started", String(rows.filter((v) => watchState(v) === "new").length)]);
  }
  ui.stats.innerHTML = "";
  for (const [label, val] of tiles) {
    const tile = document.createElement("span");
    tile.className = "ytcs-stat";
    const lEl = document.createElement("span");
    lEl.className = "ytcs-statlabel";
    lEl.textContent = label;
    const vEl = document.createElement("span");
    vEl.className = "ytcs-statval";
    vEl.textContent = val;
    tile.appendChild(lEl);
    tile.appendChild(vEl);
    ui.stats.appendChild(tile);
  }
}

function renderGrid(rows) {
  const frag = document.createDocumentFragment();
  const shown = rows.slice(0, 600);
  for (const v of shown) {
    const ws = watchState(v);
    const card = document.createElement("a");
    card.className = "ytcs-card" + (ws === "done" ? " ytcs-seen" : "");
    card.href = "/watch?v=" + v.id;
    // Who made it, for the mute button. Search results carry it; a channel's
    // own grid does not need it.
    if (v.channel) card.dataset.ch = v.channel;
    if (v.handle) card.dataset.h = v.handle;

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
    const meta = factsInto(document.createElement("div"), [fmtCompact(v.views) + " views", cap(v.publishedText)]);
    meta.className = "ytcs-cmeta";
    info.appendChild(t);
    info.appendChild(meta);
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
    empty.textContent = state.catalog.length ? "No videos match these filters." : "Nothing loaded yet. Press refresh to read it.";
    ui.grid.appendChild(empty);
  }
  if (typeof renderLoadMore === "function") renderLoadMore(ui.grid);
  if (rows.length > shown.length) {
    const more = document.createElement("div");
    more.className = "ytcs-more";
    more.textContent = "Showing the first 600 of " + rows.length + ". Narrow the filters to see the rest.";
    ui.grid.appendChild(more);
  }
}
