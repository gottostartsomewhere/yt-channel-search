/*
 * YouTube Channel Search+
 * Panel construction, the grid takeover, and startup.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- UI helpers ----------------------------------------------------------
/*
 * Filter controls are pills, not labelled fields. Every option string names its
 * own dimension ("Any length" -> "4 - 20 min"), so the control describes itself
 * and the row above it can disappear. A stack of uppercase captions over a row
 * of identical grey boxes was the single most generic thing in this panel.
 *
 * `dim` marks the pill as untouched. filterAndSort already treats "" as no
 * filter, so this is purely how it reads: active filters look chosen.
 */
function pill(opts, title) {
  const s = document.createElement("select");
  s.className = "ytcs-pill ytcs-dim";
  if (title) s.title = title;
  for (const [val, label] of opts) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    s.appendChild(o);
  }
  s.addEventListener("change", () => s.classList.toggle("ytcs-dim", !s.value));
  return s;
}

function ghostBtn(label, title) {
  const b = document.createElement("button");
  b.className = "ytcs-ghost";
  b.textContent = label;
  if (title) b.title = title;
  return b;
}

function icon(path, size) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size || 16));
  svg.setAttribute("height", String(size || 16));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

const ICON_SEARCH = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4";
const ICON_REFRESH = "M20 11A8 8 0 1 0 18.4 16M20 5v6h-6";

// ---- UI construction (in-page grid takeover) -----------------------------
function buildUi() {
  const wrap = document.createElement("div");
  wrap.className = "ytcs-wrap";

  // ---- row 1: identity, the two primary tabs, and catalogue state ---------
  const head = document.createElement("div");
  head.className = "ytcs-head";

  const brand = document.createElement("span");
  brand.className = "ytcs-brand";
  brand.textContent = "Search+";

  const tabs = document.createElement("div");
  tabs.className = "ytcs-tabs";
  tabs.setAttribute("role", "tablist");
  const mkTab = (label, on) => {
    const b = document.createElement("button");
    b.className = "ytcs-tab" + (on ? " ytcs-tabon" : "");
    b.textContent = label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", on ? "true" : "false");
    tabs.appendChild(b);
    return b;
  };
  const tabSearch = mkTab("Search", true);
  const tabInsights = mkTab("Insights");

  const status = document.createElement("span");
  status.className = "ytcs-status";

  const refresh = document.createElement("button");
  refresh.className = "ytcs-iconbtn";
  refresh.title = "Re-read the channel and flag anything new";
  refresh.setAttribute("aria-label", "Refresh catalogue");
  refresh.appendChild(icon(ICON_REFRESH));
  refresh.onclick = () => refreshCatalog();

  const restore = document.createElement("button");
  restore.className = "ytcs-restore";
  restore.textContent = "Restore YouTube";
  restore.onclick = () => disable();

  const csv = ghostBtn("CSV", "Download the filtered videos as CSV");
  csv.onclick = () => exportCSV();
  const json = ghostBtn("JSON", "Download the filtered videos as JSON");
  json.onclick = () => exportJSON();
  const exports = document.createElement("span");
  exports.className = "ytcs-exports";
  exports.appendChild(csv);
  exports.appendChild(json);

  head.appendChild(brand);
  head.appendChild(tabs);
  const hspacer = document.createElement("span");
  hspacer.className = "ytcs-spacer";
  head.appendChild(hspacer);
  head.appendChild(status);
  // Export sits with the other actions rather than among the filters: it is a
  // thing you do to the result, not a thing that changes it.
  head.appendChild(exports);
  head.appendChild(refresh);
  head.appendChild(restore);

  // ---- row 2: the filter line --------------------------------------------
  const filters = document.createElement("div");
  filters.className = "ytcs-filters";

  const searchBox = document.createElement("div");
  searchBox.className = "ytcs-searchbox";
  searchBox.appendChild(icon(ICON_SEARCH, 17));
  const kw = document.createElement("input");
  kw.type = "text";
  kw.placeholder = "Search this channel's titles";
  kw.className = "ytcs-search";
  kw.setAttribute("aria-label", "Search this channel's titles");
  searchBox.appendChild(kw);

  const duration = pill([
    ["", "Any length"],
    ["0-60", "Under 1 min"],
    ["60-240", "1 – 4 min"],
    ["240-1200", "4 – 20 min"],
    ["1200-3600", "20 – 60 min"],
    ["3600-", "Over 60 min"],
  ], "Video length");
  const views = pill([
    ["", "Any views"],
    ["0-10000", "Under 10K"],
    ["10000-100000", "10K – 100K"],
    ["100000-1000000", "100K – 1M"],
    ["1000000-10000000", "1M – 10M"],
    ["10000000-", "Over 10M"],
  ], "View count");
  const uploaded = pill([
    ["", "Any time"],
    ["7", "Past week"],
    ["31", "Past month"],
    ["93", "Past 3 months"],
    ["366", "Past year"],
    ["old", "Over a year ago"],
  ], "Upload date");
  const watched = pill([
    ["", "Watched: any"],
    ["new", "Not started"],
    ["unfinished", "Not finished"],
    ["partial", "Still watching"],
    ["done", "Finished"],
  ], "Your watch history on this channel");
  // Presets rather than a free number box: it makes the feature discoverable,
  // and it keeps the row one consistent kind of control.
  const fits = pill([
    ["", "Any free time"],
    ["10", "10 min free"],
    ["20", "20 min free"],
    ["30", "30 min free"],
    ["45", "45 min free"],
    ["60", "1 hour free"],
  ], "Only show videos that fit the time you have");

  const sort = pill([
    ["newest", "Newest first"],
    ["oldest", "Oldest first"],
    ["starthere", "Start here"],
    ["views_desc", "Most views"],
    ["views_asc", "Fewest views"],
    ["duration_desc", "Longest"],
    ["duration_asc", "Shortest"],
    ["vpd_desc", "Views per day"],
    ["trend_desc", "Trending (measured)"],
    ["gems_desc", "Hidden gems"],
    ["title_az", "Title A→Z"],
  ], "Sort order");
  sort.classList.remove("ytcs-dim");
  sort.classList.add("ytcs-sort");

  const count = document.createElement("span");
  count.className = "ytcs-count";

  const clear = ghostBtn("Clear", "Reset every filter");
  clear.style.display = "none";
  clear.onclick = () => {
    ui.kw.value = "";
    for (const el of [ui.duration, ui.views, ui.uploaded, ui.watched, ui.fits]) {
      el.value = "";
      el.classList.add("ytcs-dim");
    }
    ui.sort.value = "newest";
    applyView();
  };

  filters.appendChild(searchBox);
  filters.appendChild(duration);
  filters.appendChild(views);
  filters.appendChild(uploaded);
  filters.appendChild(watched);
  filters.appendChild(fits);
  // Sort belongs with the pills, not across the spacer with the result state.
  // Sitting on the far side it was the first thing to wrap, so it dropped onto
  // a line of its own and read as though it had fallen off.
  filters.appendChild(sort);
  const fspacer = document.createElement("span");
  fspacer.className = "ytcs-spacer";
  filters.appendChild(fspacer);
  filters.appendChild(count);
  filters.appendChild(clear);

  const stats = document.createElement("div");
  stats.className = "ytcs-stats";

  const grid = document.createElement("div");
  grid.className = "ytcs-grid";

  // ---- Insights: one pane, four sections behind a secondary nav -----------
  const insights = document.createElement("div");
  insights.className = "ytcs-insights";
  insights.style.display = "none";

  const subnav = document.createElement("div");
  subnav.className = "ytcs-subnav";
  subnav.setAttribute("role", "tablist");
  const mkSub = (label, on) => {
    const b = document.createElement("button");
    b.className = "ytcs-sub" + (on ? " ytcs-subon" : "");
    b.textContent = label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", on ? "true" : "false");
    subnav.appendChild(b);
    return b;
  };
  const subOverview = mkSub("Overview", true);
  const subCompare = mkSub("Compare");
  const subWatchlist = mkSub("Watchlist");
  insights.appendChild(subnav);

  // Overview: the charts drawn from whatever the filters currently select.
  const paneOverview = document.createElement("div");
  paneOverview.className = "ytcs-pane";
  const charts = document.createElement("div");
  charts.className = "ytcs-charts";
  paneOverview.appendChild(charts);

  // Compare
  const compare = document.createElement("div");
  compare.className = "ytcs-pane";
  compare.style.display = "none";
  const cmpIntro = document.createElement("p");
  cmpIntro.className = "ytcs-explain";
  cmpIntro.textContent =
    "Read another channel's full catalogue and line its numbers up against this one.";
  const cmpRow = document.createElement("div");
  cmpRow.className = "ytcs-inputrow";
  const cmpInput = document.createElement("input");
  cmpInput.type = "text";
  cmpInput.className = "ytcs-textin";
  cmpInput.placeholder = "@handle or channel URL";
  const cmpBtn = document.createElement("button");
  cmpBtn.className = "ytcs-primary";
  cmpBtn.textContent = "Compare";
  const cmpStatus = document.createElement("span");
  cmpStatus.className = "ytcs-status";
  cmpRow.appendChild(cmpInput);
  cmpRow.appendChild(cmpBtn);
  cmpRow.appendChild(cmpStatus);
  const cmpResult = document.createElement("div");
  cmpResult.className = "ytcs-cmpresult";
  compare.appendChild(cmpIntro);
  compare.appendChild(cmpRow);
  compare.appendChild(cmpResult);

  // Watchlist
  const niche = document.createElement("div");
  niche.className = "ytcs-pane";
  niche.style.display = "none";
  const nicheIntro = document.createElement("p");
  nicheIntro.className = "ytcs-explain";
  nicheIntro.textContent =
    "Track a set of channels, then refresh. You get back every video beating its own " +
    "channel's normal pace by a wide margin, ranked across all of them, and the topics " +
    "they cover that this channel never has.";
  const nicheRow = document.createElement("div");
  nicheRow.className = "ytcs-inputrow";
  const nicheInput = document.createElement("input");
  nicheInput.type = "text";
  nicheInput.className = "ytcs-textin";
  nicheInput.placeholder = "@handle or channel URL";
  const nicheAdd = document.createElement("button");
  nicheAdd.className = "ytcs-primary";
  nicheAdd.textContent = "Track";
  nicheAdd.title = "Add this channel to the watchlist";
  const nicheRefresh = ghostBtn("Refresh all", "Read every tracked channel and rank what is working");
  const nicheStatus = document.createElement("span");
  nicheStatus.className = "ytcs-status";
  nicheRow.appendChild(nicheInput);
  nicheRow.appendChild(nicheAdd);
  nicheRow.appendChild(nicheRefresh);
  nicheRow.appendChild(nicheStatus);
  const nicheChips = document.createElement("div");
  nicheChips.className = "ytcs-chips";
  const nicheResults = document.createElement("div");
  nicheResults.className = "ytcs-nresults";
  niche.appendChild(nicheIntro);
  niche.appendChild(nicheRow);
  niche.appendChild(nicheChips);
  niche.appendChild(nicheResults);

  insights.appendChild(paneOverview);
  insights.appendChild(compare);
  insights.appendChild(niche);

  const foot = document.createElement("div");
  foot.className = "ytcs-foot";
  foot.textContent = "Reads public data through YouTube's own endpoints. Not affiliated with YouTube.";

  // Both rows stick as one block. Two separately-sticky rows would need their
  // tops kept in sync with the header's rendered height, which does not survive
  // a wrap at narrow widths.
  const chrome = document.createElement("div");
  chrome.className = "ytcs-chrome";
  chrome.appendChild(head);
  chrome.appendChild(filters);

  wrap.appendChild(chrome);
  wrap.appendChild(stats);
  wrap.appendChild(grid);
  wrap.appendChild(insights);
  wrap.appendChild(foot);

  ui = {
    wrap, head, filters, kw, duration, views, uploaded, watched, fits, sort,
    status, count, clear, stats, grid,
    insights, charts,
    tabSearch, tabInsights,
    insightPanes: { overview: paneOverview, compare: compare, watchlist: niche },
    insightTabs: { overview: subOverview, compare: subCompare, watchlist: subWatchlist },
    cmpInput, cmpBtn, cmpStatus, cmpResult,
    niche, nicheInput, nicheAdd, nicheRefresh, nicheStatus, nicheChips, nicheResults,
  };

  cmpResult.appendChild(emptyNote("Enter a channel above to line it up against this one."));

  tabSearch.onclick = () => setView("search");
  tabInsights.onclick = () => setView("insights");
  subOverview.onclick = () => setInsight("overview");
  subCompare.onclick = () => setInsight("compare");
  subWatchlist.onclick = () => setInsight("watchlist");

  cmpBtn.onclick = () => runCompare();
  cmpInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runCompare(); });

  nicheAdd.onclick = async () => {
    const url = normalizeChannelInput(nicheInput.value);
    const key = url && channelKeyFromUrl(url);
    if (!key) { nicheStatus.textContent = "couldn't parse that channel"; return; }
    if (state.watchlist.indexOf(key) === -1) state.watchlist.push(key);
    await saveWatchlist(state.watchlist);
    nicheInput.value = "";
    nicheStatus.textContent = plural(state.watchlist.length, "channel") + " tracked";
    renderNiche();
  };
  nicheRefresh.onclick = () => refreshWatchlist();

  for (const el of [kw, duration, views, uploaded, watched, fits, sort]) {
    el.addEventListener("input", applyView);
    el.addEventListener("change", applyView);
  }
}

// ---- grid takeover lifecycle ---------------------------------------------
function findNativeGrid() {
  return document.querySelector("ytd-rich-grid-renderer");
}

// A tab that has just been brought to the front has to mount ytd-browse from
// scratch, which takes longer than a normal in-page navigation, so the budget
// is wider than the 2.4s that was enough when this only ran on a visible tab.
async function findGridWithRetry(tries) {
  tries = tries || 25;
  for (let i = 0; i < tries; i++) {
    const g = findNativeGrid();
    if (g && g.parentElement) return g;
    await sleep(200);
  }
  return null;
}

function recomputeMedians() {
  const vpds = state.catalog.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
  state.medianVpd = median(vpds);
  state.medianViews = median(state.catalog.map((v) => v.views));
}

// Load from cache instantly if present; otherwise fetch fresh.
async function loadCatalog() {
  if (state.loading) return;
  const key = channelBasePath();
  const cached = key ? await idbGet(key) : null;
  if (cached && cached.videos && cached.videos.length) {
    state.catalog = cached.videos;
    state.cachedAt = cached.fetchedAt || 0;
    state.newIds = new Set();
    recomputeMedians();
    const hasWatch = state.catalog.some((v) => typeof v.progress === "number");
    ui.status.textContent = state.catalog.length + " cached · " + fmtAgo(state.cachedAt) +
      (hasWatch ? "" : " · refresh for watch history");
    applyView();
    return;
  }
  await refreshCatalog();
}

/*
 * Store the catalogue and keep a rolling set of view-count snapshots. Diffing
 * the newest fetch against the previous snapshot gives measured velocity,
 * which is real rather than inferred from YouTube's relative dates. Videos
 * are annotated in place so the numbers survive in the cache.
 */
async function persistCatalog(key, cat) {
  const prev = await idbGet(key);
  const history = (prev && prev.history) || [];
  const last = history[history.length - 1];
  const now = Date.now();

  if (last && last.t) {
    const days = (now - last.t) / 86400000;
    if (days > 0.02) {
      for (const v of cat) {
        const before = last.v[v.id];
        if (typeof before !== "number" || v.views < before) continue;
        const gained = v.views - before;
        // Anything that could be explained by the two-significant-figure
        // rounding in listing counts is not a measurement. Recording it would
        // hand the outlier maths a fabricated jump.
        if (!beyondRounding(gained, v.views)) continue;
        v.gained = gained;
        v.sinceDays = days;
        v.measuredVpd = gained / days;
      }
    }
  }

  // Prototype-less: video ids come out of a parsed payload and become object
  // keys here, and a key like "__proto__" or "constructor" on a normal object
  // does not behave like data. Nothing can currently produce one, since
  // YouTube assigns the ids, but this is the only place parsed strings are
  // used as keys and the guard costs nothing.
  const snapshot = Object.create(null);
  for (const v of cat) snapshot[v.id] = v.views;
  // Only lay down a fresh snapshot once enough time has passed, otherwise a
  // burst of refreshes would collapse the measurement window to minutes.
  const tooSoon = last && last.t && (now - last.t) / 86400000 <= 0.02;
  const nextHistory = tooSoon ? history : history.concat([{ t: now, v: snapshot }]).slice(-SNAPSHOT_LIMIT);

  const oldIds = prev && prev.ids ? new Set(prev.ids) : null;
  const newIds = oldIds ? cat.filter((v) => !oldIds.has(v.id)).map((v) => v.id) : [];

  await idbPut(key, {
    channel: key,
    fetchedAt: now,
    videos: cat,
    ids: cat.map((v) => v.id),
    history: nextHistory,
  });
  // Drop the least recently fetched channels once the cache is oversized.
  // After the write, so the channel just visited is never the one evicted.
  await pruneCache();
  return { newIds: newIds, snapshots: nextHistory.length, at: now };
}

async function refreshCatalog() {
  if (state.loading) return;
  state.loading = true;
  ui.grid.classList.add("ytcs-busy");
  ui.status.textContent = "loading… 0";
  const key = channelBasePath();
  try {
    const cat = await fetchCatalog((n) => (ui.status.textContent = "loading… " + n));
    state.catalog = cat;
    state.cachedAt = Date.now();
    let info = { newIds: [], snapshots: 1 };
    if (key) info = await persistCatalog(key, cat);
    state.newIds = new Set(info.newIds);
    recomputeMedians();
    const bits = [plural(cat.length, "video")];
    if (info.newIds.length) bits.push(info.newIds.length + " new");
    bits.push(info.snapshots > 1 ? info.snapshots + " snapshots" : "first snapshot");
    ui.status.textContent = bits.join(" · ");
    applyView();
  } catch (e) {
    ui.status.textContent = "error: " + e.message;
    console.error("[Channel Search+]", e);
  } finally {
    state.loading = false;
    ui.grid.classList.remove("ytcs-busy");
  }
}

/*
 * YouTube does not mount ytd-browse at all while the tab is in the background.
 * There is no grid, no #primary, nothing to take over, and findGridWithRetry
 * spends its whole budget against a page that has not rendered. It then falls
 * through to document.body, so the panel lands somewhere useless and the native
 * grid is never hidden. Switch to the tab afterwards and you have both.
 *
 * Clicking the launcher cannot hit this, since you have to be looking at the
 * tab to click it. Auto-open can: it fires 800ms after load, which for a
 * channel opened in a background tab is long before anything exists.
 */
function whenVisible() {
  if (document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

async function enable() {
  if (state.active || state.enabling) return;
  state.enabling = true;
  try {
    await enableNow();
  } finally {
    state.enabling = false;
  }
}

async function enableNow() {
  if (!ui) buildUi();
  await whenVisible();
  // The tab may have been left on a different page while it sat in the
  // background, so the channel it was opened for is not necessarily the one
  // being looked at now.
  if (!isChannelPage()) return;
  const native = await findGridWithRetry();
  const host =
    (native && native.parentElement) ||
    document.querySelector("ytd-browse #primary") ||
    document.querySelector("#primary") ||
    document.body;

  if (native && native.parentElement) {
    native.parentElement.insertBefore(ui.wrap, native);
    state.nativeGrid = native;
    state.nativeDisplay = native.style.display;
    native.style.display = "none";
  } else {
    host.insertBefore(ui.wrap, host.firstChild);
  }

  state.active = true;
  if (launcher) launcher.textContent = "Close";
  ui.sort.value = cfg.defaultSort;
  if (cfg.hideWatched) {
    ui.watched.value = "unfinished";
    ui.watched.classList.remove("ytcs-dim");
  }
  state.watchlist = await getWatchlist();
  renderNiche();
  if (!state.catalog.length) await loadCatalog();
  else applyView();
}

function disable() {
  if (state.nativeGrid) {
    state.nativeGrid.style.display = state.nativeDisplay || "";
    state.nativeGrid = null;
  }
  if (ui && ui.wrap.parentElement) ui.wrap.remove();
  state.active = false;
  if (launcher) launcher.textContent = "Search+";
}

// ---- launcher + navigation handling --------------------------------------
function buildLauncher() {
  const btn = document.createElement("button");
  btn.className = "ytcs-launcher";
  btn.textContent = "Search+";
  btn.title = "Search this channel's whole back catalogue, and filter it by length, views, date and what you have watched";
  btn.onclick = async () => {
    if (state.active) disable();
    else await enable();
  };
  document.body.appendChild(btn);
  return btn;
}

function ensureUi() {
  const onChannel = isChannelPage();
  if (onChannel && !launcher) {
    launcher = buildLauncher();
  } else if (!onChannel && launcher) {
    disable();
    launcher.remove();
    launcher = null;
    ui = null;
    state.catalog = [];
  }
}

window.addEventListener("yt-navigate-finish", () => {
  // YouTube replaces the grid node on navigation; tear down and reset.
  disable();
  state.catalog = [];
  state.newIds = new Set();
  state.cachedAt = 0;
  state.view = "search";
  state.insight = "overview";
  setTimeout(ensureUi, 300);
});
// Keyboard shortcut, relayed from the service worker.
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "ytcs-toggle" && isChannelPage()) {
      if (state.active) disable();
      else enable();
      return;
    }
    /*
     * The popup cannot clear the cache itself. IndexedDB is opened from the
     * content script, so the database belongs to the youtube.com origin, and
     * the popup runs on the extension's own. It has to ask the page.
     */
    if (msg.type === "ytcs-clear") {
      clearCache().then(() => {
        state.catalog = [];
        state.newIds = new Set();
        state.cachedAt = 0;
        state.watchlist = [];
        if (state.active) disable();
        sendResponse({ ok: true });
      }, () => sendResponse({ ok: false }));
      return true; // async reply
    }
  });
} catch (e) { /* no extension context, nothing to relay */ }

function bootstrap() {
  setInterval(ensureUi, 1500);
  loadSettings().then(() => {
    ensureUi();
    if (cfg.autoOpen && isChannelPage()) setTimeout(() => { if (!state.active) enable(); }, 800);
  });
}

if (!window.__ytcsLoaded) {
  window.__ytcsLoaded = true;
  bootstrap();
}
