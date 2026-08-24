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

// Two bars, and both have to clear. The ratio is a floor so nothing pedestrian
// gets called an outlier. The MAD bar scales with how uneven the channel already
// is: where every video moves at a similar pace 1.5x is genuinely notable, and
// on a wildly uneven channel it is a Tuesday.
function isOutlier(rate, base, spread, ratio) {
  if (ratio < OUTLIER_RATIO) return false;
  if (spread <= 0) return true; // no spread to speak of, so the ratio is all there is
  return rate >= base + OUTLIER_MADS * spread;
}

async function refreshWatchlist() {
  if (!state.watchlist.length) {
    ui.nicheStatus.textContent = "add a channel first";
    return;
  }
  ui.nicheRefresh.disabled = true;
  const outliers = [];
  const theirVideos = [];
  const newSeen = new Set();
  let liveChannels = 0;
  let fails = 0;
  for (const key of state.watchlist) {
    ui.nicheStatus.textContent = "reading " + key.replace(/^\//, "") + "…";
    try {
      const cat = await fetchCatalogFrom(location.origin + key + "/videos", () => {});
      const info = await persistCatalog(key, cat); // annotates measured velocity in place
      info.newIds.forEach((id) => newSeen.add(id));

      // Prefer measured velocity: rank videos moving fastest relative to how
      // fast this channel normally moves right now. Only once there is enough
      // measured data, otherwise fall back to the lifetime average.
      //
      // The baseline runs over everything still moving at all, not just the
      // videos already clearing VELOCITY_FLOOR. Filtering to fast ones first
      // would make "normal" rise during a channel's hot week and hide the very
      // breakouts this is looking for. The floor stays on candidacy instead, so
      // a video that gained twelve views cannot ride a flattering ratio in.
      const moving = cat.filter((v) => v.measuredVpd > 0);
      if (moving.length >= MIN_MEASURED) {
        liveChannels++;
        const rates = moving.map((v) => v.measuredVpd);
        const base = median(rates) || 1;
        const spread = mad(rates, base);
        moving
          .filter((v) => v.gained >= VELOCITY_FLOOR)
          .forEach((v) => {
            const ratio = v.measuredVpd / base;
            if (!isOutlier(v.measuredVpd, base, spread, ratio)) return;
            outliers.push({ v: v, channel: key, ratio: ratio, measured: true, gained: v.gained, sinceDays: v.sinceDays });
          });
      } else {
        const rates = cat.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
        const base = median(rates) || 1;
        const spread = mad(rates, base);
        cat.forEach((v) => {
          const rate = v.days ? v.views / Math.max(v.days, 1) : 0;
          const ratio = rate / base;
          if (!isOutlier(rate, base, spread, ratio)) return;
          outliers.push({ v: v, channel: key, ratio: ratio, measured: false });
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
  state.nicheNew = newSeen;
  state.gapItems = state.catalog.length ? contentGap(state.catalog, theirVideos, 3) : [];
  state.nicheRan = true;
  const mode = liveChannels
    ? liveChannels + " of " + state.watchlist.length + " live"
    : "baseline set, refresh again later for live velocity";
  const bits = [
    plural(state.watchlist.length, "channel"),
    plural(theirVideos.length, "video"),
    plural(outliers.length, "outlier"),
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
  items.slice(0, 24).forEach((it, i) => {
    const row = document.createElement("a");
    row.className = "ytcs-nrow";
    row.href = "/watch?v=" + it.v.id;
    // The list is sorted by how far each video beat its own channel's normal,
    // so the position is the finding. Numbering it makes that readable at a
    // glance instead of implied by row order.
    const rank = document.createElement("div");
    rank.className = "ytcs-nrank" + (i < 3 ? " ytcs-nrank-top" : "");
    rank.textContent = String(i + 1);
    row.appendChild(rank);
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
    // persistCatalog already worked out which ids it had not seen before, so
    // flagging them here costs nothing.
    if (state.nicheNew && state.nicheNew.has(it.v.id)) parts.push("new since your last check");
    if (it.measured) {
      const span = it.sinceDays < 1
        ? Math.max(1, Math.round(it.sinceDays * 24)) + "h"
        : Math.round(it.sinceDays) + "d";
      parts.push("+" + fmtCompact(Math.round(it.gained)) + " in " + span);
    } else {
      parts.push(fmtCompact(it.v.views) + " views");
    }
    sub.textContent = parts.join("  ·  ");
    meta.appendChild(t);
    meta.appendChild(sub);

    // The multiple is the whole reason the row is in the list, so it comes out
    // of the dot-separated subline and into its own column. Down a list of 24
    // that turns "read every row" into "scan one column".
    const metric = document.createElement("div");
    metric.className = "ytcs-nmetric";
    const mval = document.createElement("div");
    mval.className = "ytcs-nmval";
    mval.textContent = it.ratio.toFixed(1) + "x";
    const mlab = document.createElement("div");
    mlab.className = "ytcs-nmlab";
    mlab.textContent = it.measured ? "normal pace" : "lifetime median";
    metric.appendChild(mval);
    metric.appendChild(mlab);

    row.appendChild(img);
    row.appendChild(meta);
    row.appendChild(metric);
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
    // Say which basis the ranking used. "3.2x normal pace" means two different
    // things depending on whether it came from snapshots or lifetime averages,
    // and the reader cannot tell them apart from the rows alone.
    const total = state.nicheItems.length;
    const measured = state.nicheItems.filter((it) => it.measured).length;
    let basis;
    if (!measured) {
      basis = "Ranked on lifetime pace. Refresh again in half an hour and this becomes growth measured between your visits.";
    } else if (measured === total) {
      basis = "Ranked on growth measured between your own visits, not inferred from upload dates.";
    } else {
      basis = measured + " of " + total + " ranked on measured growth, the rest on lifetime pace.";
    }
    ui.nicheResults.appendChild(section("What is working right now", nicheList(state.nicheItems), basis));
  }
  if (state.gapItems.length) {
    ui.nicheResults.appendChild(section(
      "Content gaps: topics they cover and you do not",
      dataTable(["Topic", "Their videos", "Median views", "Lift"], state.gapItems.slice(0, 20).map((g) => [
        g.word,
        String(g.count),
        fmtCompact(Math.round(g.medViews)),
        (g.lift || 0).toFixed(1) + "x",
      ])),
      "Lift is measured against these channels' own median, so a high number is a topic that outperforms for them rather than a topic that is merely popular."
    ));
  }
  if (state.watchlist.length && state.nicheRan && !state.nicheItems.length && !state.gapItems.length) {
    ui.nicheResults.appendChild(emptyNote("Nothing is outperforming across these channels right now. Check back after they post."));
  }
}

/*
 * ---- view switching ------------------------------------------------------
 *
 * Two levels. Search is the product and the front door, so it gets one of only
 * two primary tabs; everything analytical sits behind Insights and switches
 * with a secondary nav. Four coequal tabs made the panel read as four tools
 * bolted together instead of one.
 */
function setView(name) {
  state.view = name;
  const panes = { search: ui.grid, insights: ui.insights };
  const tabs = { search: ui.tabSearch, insights: ui.tabInsights };
  Object.keys(panes).forEach((k) => {
    panes[k].style.display = k === name ? "" : "none";
    tabs[k].classList.toggle("ytcs-tabon", k === name);
    tabs[k].setAttribute("aria-selected", k === name ? "true" : "false");
  });
  // The filter bar drives the grid and the two panes computed from it. Compare
  // and Watchlist read other channels, so the filters would only mislead there.
  const filtersBite = name === "search" ||
    state.insight === "overview" || state.insight === "titles";
  ui.filters.classList.toggle("ytcs-filters-idle", !filtersBite);
  applyView();
}

function setInsight(name) {
  state.insight = name;
  Object.keys(ui.insightPanes).forEach((k) => {
    ui.insightPanes[k].style.display = k === name ? "" : "none";
    ui.insightTabs[k].classList.toggle("ytcs-subon", k === name);
    ui.insightTabs[k].setAttribute("aria-selected", k === name ? "true" : "false");
  });
  setView("insights");
}
