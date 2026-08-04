/*
 * YouTube Channel Search+
 * Panel construction, the grid takeover, and startup.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- UI helpers ----------------------------------------------------------
function select(opts) {
  const s = document.createElement("select");
  s.className = "ytcs-in";
  for (const [val, label] of opts) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    s.appendChild(o);
  }
  return s;
}

function field(text, el) {
  const l = document.createElement("label");
  l.className = "ytcs-field";
  const s = document.createElement("span");
  s.className = "ytcs-flabel";
  s.textContent = text;
  l.appendChild(s);
  l.appendChild(el);
  return l;
}

// ---- UI construction (in-page grid takeover) -----------------------------
function buildUi() {
  const wrap = document.createElement("div");
  wrap.className = "ytcs-wrap";

  const bar = document.createElement("div");
  bar.className = "ytcs-bar";

  const brand = document.createElement("span");
  brand.className = "ytcs-brand";
  brand.textContent = "Search+";

  const kw = document.createElement("input");
  kw.type = "text";
  kw.placeholder = "keyword in title";
  kw.className = "ytcs-in ytcs-kw";

  const duration = select([
    ["", "Any length"],
    ["0-60", "Under 1 min"],
    ["60-240", "1 – 4 min"],
    ["240-1200", "4 – 20 min"],
    ["1200-3600", "20 – 60 min"],
    ["3600-", "Over 60 min"],
  ]);
  const views = select([
    ["", "Any views"],
    ["0-10000", "Under 10K"],
    ["10000-100000", "10K – 100K"],
    ["100000-1000000", "100K – 1M"],
    ["1000000-10000000", "1M – 10M"],
    ["10000000-", "Over 10M"],
  ]);
  const watched = select([
    ["", "Any"],
    ["new", "Not started"],
    ["unfinished", "Not finished"],
    ["partial", "Still watching"],
    ["done", "Finished"],
  ]);
  const uploaded = select([
    ["", "Any time"],
    ["7", "Past week"],
    ["31", "Past month"],
    ["93", "Past 3 months"],
    ["366", "Past year"],
    ["old", "Over a year ago"],
  ]);
  const fits = document.createElement("input");
  fits.type = "number";
  fits.min = "1";
  fits.placeholder = "any";
  fits.className = "ytcs-in ytcs-fits";
  fits.title = "Show only videos that fit in this many minutes";

  const sort = select([
    ["newest", "Newest"],
    ["oldest", "Oldest"],
    ["starthere", "Start here"],
    ["views_desc", "Most views"],
    ["views_asc", "Fewest views"],
    ["duration_desc", "Longest"],
    ["duration_asc", "Shortest"],
    ["vpd_desc", "Views per day"],
    ["trend_desc", "Trending (measured)"],
    ["gems_desc", "Hidden gems"],
    ["title_az", "Title A→Z"],
  ]);

  const status = document.createElement("span");
  status.className = "ytcs-status";
  const count = document.createElement("span");
  count.className = "ytcs-count";

  // view tabs
  const tabs = document.createElement("div");
  tabs.className = "ytcs-tabs";
  const mkTab = (label, on) => {
    const b = document.createElement("button");
    b.className = "ytcs-tab" + (on ? " ytcs-tabon" : "");
    b.textContent = label;
    tabs.appendChild(b);
    return b;
  };
  const tabGrid = mkTab("Grid", true);
  const tabAnalytics = mkTab("Analytics");
  const tabTitles = mkTab("Titles");
  const tabSeries = mkTab("Series");
  const tabNiche = mkTab("Niche");

  // action buttons
  const iconBtn = (label, title) => {
    const b = document.createElement("button");
    b.className = "ytcs-icbtn";
    b.textContent = label;
    if (title) b.title = title;
    return b;
  };
  const refresh = iconBtn("↻ Refresh", "Re-fetch and highlight new uploads");
  refresh.onclick = () => refreshCatalog();
  const csv = iconBtn("CSV", "Export the filtered videos as CSV");
  csv.onclick = () => exportCSV();
  const json = iconBtn("JSON", "Export the filtered videos as JSON");
  json.onclick = () => exportJSON();
  const clear = iconBtn("Clear", "Reset all filters");
  clear.style.display = "none";
  clear.onclick = () => {
    ui.kw.value = "";
    ui.duration.value = "";
    ui.views.value = "";
    ui.uploaded.value = "";
    ui.watched.value = "";
    ui.fits.value = "";
    ui.sort.value = "newest";
    applyView();
  };
  const divider = document.createElement("span");
  divider.className = "ytcs-div";
  const restore = document.createElement("button");
  restore.className = "ytcs-restore";
  restore.textContent = "Restore YouTube";
  restore.onclick = () => disable();

  bar.appendChild(brand);
  bar.appendChild(tabs);
  bar.appendChild(field("Keyword", kw));
  bar.appendChild(field("Length", duration));
  bar.appendChild(field("Views", views));
  bar.appendChild(field("Uploaded", uploaded));
  bar.appendChild(field("Watched", watched));
  bar.appendChild(field("Fits in (min)", fits));
  bar.appendChild(field("Sort", sort));
  bar.appendChild(status);
  bar.appendChild(count);
  bar.appendChild(clear);
  bar.appendChild(divider);
  bar.appendChild(refresh);
  bar.appendChild(csv);
  bar.appendChild(json);
  bar.appendChild(restore);

  const stats = document.createElement("div");
  stats.className = "ytcs-stats";

  const grid = document.createElement("div");
  grid.className = "ytcs-grid";

  // analytics view (charts + compare), hidden until the Analytics tab is picked
  const analytics = document.createElement("div");
  analytics.className = "ytcs-analytics";
  analytics.style.display = "none";
  const charts = document.createElement("div");
  charts.className = "ytcs-charts";
  analytics.appendChild(charts);

  const cmp = document.createElement("div");
  cmp.className = "ytcs-compare";
  const cmpHead = document.createElement("div");
  cmpHead.className = "ytcs-cmphead";
  cmpHead.textContent = "Compare with another channel";
  const cmpRow = document.createElement("div");
  cmpRow.className = "ytcs-cmprow";
  const cmpInput = document.createElement("input");
  cmpInput.type = "text";
  cmpInput.className = "ytcs-in";
  cmpInput.placeholder = "@handle or channel URL";
  const cmpBtn = document.createElement("button");
  cmpBtn.className = "ytcs-icbtn";
  cmpBtn.textContent = "Compare";
  const cmpStatus = document.createElement("span");
  cmpStatus.className = "ytcs-status";
  cmpRow.appendChild(cmpInput);
  cmpRow.appendChild(cmpBtn);
  cmpRow.appendChild(cmpStatus);
  const cmpResult = document.createElement("div");
  cmpResult.className = "ytcs-cmpresult";
  cmpResult.appendChild(emptyNote("Enter a channel above to line it up against this one."));
  cmp.appendChild(cmpHead);
  cmp.appendChild(cmpRow);
  cmp.appendChild(cmpResult);
  analytics.appendChild(cmp);

  // title analysis pane
  const titles = document.createElement("div");
  titles.className = "ytcs-pane";
  titles.style.display = "none";

  // series pane
  const series = document.createElement("div");
  series.className = "ytcs-pane";
  series.style.display = "none";

  // niche watchlist pane
  const niche = document.createElement("div");
  niche.className = "ytcs-pane";
  niche.style.display = "none";
  const nicheIntro = document.createElement("p");
  nicheIntro.className = "ytcs-explain";
  nicheIntro.textContent =
    "Track the channels you compete with. Add a few below, then hit Refresh all. " +
    "You get two things back: every video that beat its own channel's normal by a wide margin, ranked across all of them, " +
    "and the topics those channels cover that this one never has.";
  const nicheRow = document.createElement("div");
  nicheRow.className = "ytcs-cmprow";
  const nicheInput = document.createElement("input");
  nicheInput.type = "text";
  nicheInput.className = "ytcs-in";
  nicheInput.placeholder = "@handle or channel URL";
  const nicheAdd = iconBtn("Track channel", "Add this channel to the watchlist");
  const nicheRefresh = iconBtn("Refresh all", "Read every tracked channel and rank what is working");
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

  const foot = document.createElement("div");
  foot.className = "ytcs-foot";
  foot.textContent = "Reads public data through YouTube's own endpoints. Not affiliated with YouTube.";

  wrap.appendChild(bar);
  wrap.appendChild(stats);
  wrap.appendChild(grid);
  wrap.appendChild(analytics);
  wrap.appendChild(titles);
  wrap.appendChild(series);
  wrap.appendChild(niche);
  wrap.appendChild(foot);

  ui = {
    wrap, bar, kw, duration, views, uploaded, watched, fits, sort, status, count, clear,
    stats, grid, analytics, charts, titles, series, niche,
    tabGrid, tabAnalytics, tabTitles, tabSeries, tabNiche,
    cmpInput, cmpBtn, cmpStatus, cmpResult,
    nicheInput, nicheAdd, nicheRefresh, nicheStatus, nicheChips, nicheResults,
  };

  tabGrid.onclick = () => setView("grid");
  tabAnalytics.onclick = () => setView("analytics");
  tabTitles.onclick = () => setView("titles");
  tabSeries.onclick = () => setView("series");
  tabNiche.onclick = () => setView("niche");
  cmpBtn.onclick = () => runCompare();
  cmpInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runCompare(); });

  nicheAdd.onclick = async () => {
    const url = normalizeChannelInput(nicheInput.value);
    const key = url && channelKeyFromUrl(url);
    if (!key) { nicheStatus.textContent = "couldn't parse that channel"; return; }
    if (state.watchlist.indexOf(key) === -1) state.watchlist.push(key);
    await saveWatchlist(state.watchlist);
    nicheInput.value = "";
    nicheStatus.textContent = state.watchlist.length + " tracked";
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

async function findGridWithRetry(tries) {
  tries = tries || 12;
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
 * Store the catalog and keep a rolling set of view-count snapshots. Diffing
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
        if (typeof before === "number" && v.views >= before) {
          v.gained = v.views - before;
          v.sinceDays = days;
          v.measuredVpd = v.gained / days;
        }
      }
    }
  }

  const snapshot = {};
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
    const bits = [cat.length + " videos"];
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

async function enable() {
  if (!ui) buildUi();
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
  if (cfg.hideWatched) ui.watched.value = "unfinished";
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
  btn.title = "Filter this channel's videos by duration, views, and more";
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
  state.view = "grid";
  setTimeout(ensureUi, 300);
});
// Keyboard shortcut, relayed from the service worker.
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "ytcs-toggle" && isChannelPage()) {
      if (state.active) disable();
      else enable();
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
