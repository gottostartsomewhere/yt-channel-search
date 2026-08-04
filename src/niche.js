/*
 * YouTube Channel Search+
 * Competitor watchlist, cross-channel outliers, and view switching.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- niche watchlist -----------------------------------------------------
async function getWatchlist() {
  const rec = await idbGet("__watchlist");
  return (rec && rec.list) || [];
}
async function saveWatchlist(list) {
  await idbPut("__watchlist", { list: list });
}
function channelKeyFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/\/videos\/?$/, "");
  } catch (e) {
    return null;
  }
}

// Words the tracked channels rank for that this channel never uses.
function contentGap(mine, theirs, minCount) {
  const mineWords = new Set();
  mine.forEach((v) => tokenize(v.title).forEach((w) => mineWords.add(w)));
  return keywordStats(theirs, minCount)
    .filter((k) => !mineWords.has(k.word))
    .sort((a, b) => b.medViews - a.medViews);
}

async function refreshWatchlist() {
  if (!state.watchlist.length) {
    ui.nicheStatus.textContent = "add a channel first";
    return;
  }
  ui.nicheRefresh.disabled = true;
  const outliers = [];
  const theirVideos = [];
  let liveChannels = 0;
  let fails = 0;
  for (const key of state.watchlist) {
    ui.nicheStatus.textContent = "reading " + key.replace(/^\//, "") + "…";
    try {
      const cat = await fetchCatalogFrom(location.origin + key + "/videos", () => {});
      await persistCatalog(key, cat); // annotates measured velocity in place

      // Prefer measured velocity: rank videos moving fastest relative to how
      // fast this channel normally moves right now. Only once there is enough
      // measured data, otherwise fall back to the lifetime average.
      const measured = cat.filter((v) => v.measuredVpd > 0 && v.gained >= VELOCITY_FLOOR);
      if (measured.length >= MIN_MEASURED) {
        liveChannels++;
        const base = median(measured.map((v) => v.measuredVpd)) || 1;
        measured.forEach((v) => {
          const ratio = v.measuredVpd / base;
          if (ratio >= 1.5) {
            outliers.push({ v: v, channel: key, ratio: ratio, measured: true, gained: v.gained, sinceDays: v.sinceDays });
          }
        });
      } else {
        const rates = cat.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
        const base = median(rates) || 1;
        cat.forEach((v) => {
          const rate = v.days ? v.views / Math.max(v.days, 1) : 0;
          const ratio = rate / base;
          if (ratio >= 1.5) outliers.push({ v: v, channel: key, ratio: ratio, measured: false });
        });
      }
      theirVideos.push.apply(theirVideos, cat);
    } catch (e) {
      fails++;
      console.error("[Channel Search+] watchlist", key, e);
    }
  }
  outliers.sort((a, b) => b.ratio - a.ratio);
  state.nicheItems = outliers;
  state.gapItems = state.catalog.length ? contentGap(state.catalog, theirVideos, 3) : [];
  state.nicheRan = true;
  const mode = liveChannels
    ? liveChannels + " of " + state.watchlist.length + " live"
    : "baseline set, refresh again later for live velocity";
  const bits = [
    state.watchlist.length + " channels",
    theirVideos.length + " videos",
    outliers.length + " outliers",
    mode,
  ];
  if (fails) bits.push(fails + " couldn't be read");
  ui.nicheStatus.textContent = bits.join(" · ");
  ui.nicheRefresh.disabled = false;
  renderNiche();
}

function nicheList(items) {
  const wrap = document.createElement("div");
  wrap.className = "ytcs-nlist";
  items.slice(0, 24).forEach((it) => {
    const row = document.createElement("a");
    row.className = "ytcs-nrow";
    row.href = "/watch?v=" + it.v.id;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = "https://i.ytimg.com/vi/" + it.v.id + "/mqdefault.jpg";
    const meta = document.createElement("div");
    meta.className = "ytcs-nmeta";
    const t = document.createElement("div");
    t.className = "ytcs-ntitle";
    t.textContent = it.v.title;
    const sub = document.createElement("div");
    sub.className = "ytcs-nsub";
    const parts = [it.channel.replace(/^\//, "")];
    if (it.measured) {
      const span = it.sinceDays < 1
        ? Math.max(1, Math.round(it.sinceDays * 24)) + "h"
        : Math.round(it.sinceDays) + "d";
      parts.push("+" + fmtCompact(Math.round(it.gained)) + " in " + span);
      parts.push(it.ratio.toFixed(1) + "x normal pace");
    } else {
      parts.push(fmtCompact(it.v.views) + " views");
      parts.push(it.ratio.toFixed(1) + "x lifetime median");
    }
    sub.textContent = parts.join("  ·  ");
    meta.appendChild(t);
    meta.appendChild(sub);
    row.appendChild(img);
    row.appendChild(meta);
    wrap.appendChild(row);
  });
  return wrap;
}

function renderNiche() {
  ui.nicheChips.innerHTML = "";
  if (!state.watchlist.length) {
    const hint = document.createElement("div");
    hint.className = "ytcs-status";
    hint.textContent = "No channels tracked yet. Add a few competitors, then refresh to see what is working across the niche.";
    ui.nicheChips.appendChild(hint);
  }
  state.watchlist.forEach((key) => {
    const chip = document.createElement("span");
    chip.className = "ytcs-chip";
    const label = document.createElement("span");
    label.textContent = key.replace(/^\//, "");
    const x = document.createElement("button");
    x.className = "ytcs-chipx";
    x.textContent = "×";
    x.title = "Stop tracking";
    x.onclick = async () => {
      state.watchlist = state.watchlist.filter((k) => k !== key);
      await saveWatchlist(state.watchlist);
      renderNiche();
    };
    chip.appendChild(label);
    chip.appendChild(x);
    ui.nicheChips.appendChild(chip);
  });

  ui.nicheResults.innerHTML = "";
  if (state.nicheItems.length) {
    ui.nicheResults.appendChild(section("What is working right now", nicheList(state.nicheItems)));
  }
  if (state.gapItems.length) {
    ui.nicheResults.appendChild(section(
      "Content gaps: topics they cover and you do not",
      dataTable(["Topic", "Their videos", "Median views"], state.gapItems.slice(0, 20).map((g) => [
        g.word, String(g.count), fmtCompact(Math.round(g.medViews)),
      ]))
    ));
  }
  if (state.watchlist.length && state.nicheRan && !state.nicheItems.length && !state.gapItems.length) {
    ui.nicheResults.appendChild(emptyNote("Nothing is outperforming across these channels right now. Check back after they post."));
  }
}

// ---- view switching ------------------------------------------------------
function setView(name) {
  state.view = name;
  const panes = { grid: ui.grid, analytics: ui.analytics, titles: ui.titles, series: ui.series, niche: ui.niche };
  const tabs = { grid: ui.tabGrid, analytics: ui.tabAnalytics, titles: ui.tabTitles, series: ui.tabSeries, niche: ui.tabNiche };
  Object.keys(panes).forEach((k) => {
    panes[k].style.display = k === name ? "" : "none";
    tabs[k].classList.toggle("ytcs-tabon", k === name);
  });
  applyView();
}
