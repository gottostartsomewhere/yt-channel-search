/*
 * Needle for YouTube
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

/*
 * Topics the tracked channels cover that this one never has.
 *
 * This used to run through keywordStats and rank by lift, which was removed
 * along with the per-word lift table: ranking hundreds of words by the median
 * of tiny samples surfaces coincidences, and a word does not cause views, its
 * subject does.
 *
 * The claim here is weaker and survives that. "They have twelve videos about
 * this and you have none" is a fact about coverage, checkable by looking at
 * their channel, with no assertion that the word is why anything performed.
 * So it ranks by how much of their catalogue the topic occupies, not by how
 * well it did, and the floor is a real share rather than three videos.
 */
function contentGap(mine, theirs) {
  const mineWords = new Set();
  mine.forEach((v) => tokenize(v.title).forEach((w) => mineWords.add(w)));

  const counts = new Map();
  theirs.forEach((v) => {
    new Set(tokenize(v.title)).forEach((w) => {
      if (mineWords.has(w)) return;
      if (!counts.has(w)) counts.set(w, []);
      counts.get(w).push(v.views);
    });
  });

  const floor = Math.max(4, Math.round(theirs.length * 0.02));
  const out = [];
  counts.forEach((views, word) => {
    if (views.length >= floor) {
      out.push({ word: word, count: views.length, medViews: median(views) });
    }
  });
  return out.sort((a, b) => b.count - a.count);
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

/*
 * Results are derived from the watchlist, so any edit to the list invalidates
 * them. Without this, removing a channel left its videos ranked on screen
 * until the next refresh, and emptying the list entirely left a full set of
 * results for channels no longer tracked. Clearing on every edit costs a
 * refresh after adding one, which is the cheaper of the two wrongs.
 */
function clearNicheResults() {
  state.nicheItems = [];
  state.gapItems = [];
  state.nicheNew = null;
  state.nicheRan = false;
}

async function refreshWatchlist() {
  if (!state.watchlist.length) {
    clearNicheResults();
    ui.nicheStatus.textContent = "Add a channel first";
    renderNiche();
    return;
  }
  // Held locally for the same reason as runCompare: this loop takes a while,
  // and leaving the page mid-way can set ui to null under it.
  const u = ui;
  const gen = state.navGen;
  u.nicheRefresh.disabled = true;
  const outliers = [];
  const theirVideos = [];
  const newSeen = new Set();
  let liveChannels = 0;
  let fails = 0;
  for (const key of state.watchlist) {
    u.nicheStatus.textContent = "Reading " + key.replace(/^\//, "") + "…";
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
        /*
         * Before there are snapshots, this used to rank on lifetime pace:
         * views divided by days since upload. On a real channel that produced
         * a list ordered purely by recency and inversely by views, because a
         * day-old video divides by one. MKBHD's top five came out 21 hours,
         * 3 days, 13 days, 3 weeks, 1 month, at 1.6M rising to 5.8M views. It
         * called 599 of 1892 videos outliers, which is a third of a catalogue
         * and therefore not an outlier at all.
         *
         * So it no longer pretends to detect anything. It answers the question
         * one fetch can actually answer about a competitor: what have they put
         * out lately, biggest first. Once two snapshots exist the channel
         * switches to measured velocity above and this stops being used.
         */
        cat
          .filter((v) => v.days != null && v.days <= RECENT_DAYS)
          .forEach((v) => outliers.push({ v: v, channel: key, measured: false }));
      }
      theirVideos.push.apply(theirVideos, cat);
    } catch (e) {
      fails++;
      console.error("[Needle] watchlist", key, e);
    }
  }
  /*
   * Measured rows first, ranked on how far each beat its own channel's pace.
   * The rest are recent uploads ranked on plain view count. Two different
   * questions, so they are never interleaved: sorting them together once let
   * the weaker measure crowd out the stronger one.
   */
  // The content gaps below are measured against this page's catalogue, so a
  // different page gets no results rather than someone else's gaps. The
  // snapshots saved along the way are still kept.
  if (pageGone(gen)) {
    u.nicheRefresh.disabled = false;
    return;
  }
  outliers.sort((a, b) => {
    if (a.measured !== b.measured) return a.measured ? -1 : 1;
    return a.measured ? b.ratio - a.ratio : b.v.views - a.v.views;
  });
  state.nicheItems = outliers;
  state.nicheNew = newSeen;
  state.gapItems = state.catalog.length ? contentGap(state.catalog, theirVideos) : [];
  state.nicheRan = true;
  // Only the measured entries are outliers. Counting recent uploads as
  // outliers was how "599 outliers" out of 1892 videos got printed.
  const measuredCount = outliers.filter((o) => o.measured).length;
  const bits = [
    plural(state.watchlist.length, "channel"),
    plural(theirVideos.length, "video"),
  ];
  if (liveChannels) {
    bits.push(plural(measuredCount, "outlier"));
    bits.push(liveChannels + " of " + state.watchlist.length + " live");
  } else {
    bits.push(plural(outliers.length, "recent upload"));
    bits.push("Baseline set. Refresh again later for measured growth");
  }
  if (fails) bits.push(fails + " couldn't be read");
  factsInto(ui.nicheStatus, bits.map(cap));
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
    } else if (it.v.publishedText) {
      // The view count moved into the metric column for these rows, so
      // repeating it here would say the same thing twice on one line.
      parts.push(it.v.publishedText);
    }
    factsInto(sub, parts.map(cap));
    meta.appendChild(t);
    meta.appendChild(sub);

    /*
     * The measured rows get a multiple, the inferred ones do not.
     *
     * A measured multiple compares one observed rate against the median of
     * other observed rates over the same window, so it means what it says. The
     * lifetime version divides a video's views per day by the channel's
     * lifetime median, and a recent upload is still inside its launch spike
     * while that median is dominated by videos years past theirs. It printed
     * things like "43.0x", which mostly reported that the video was new. The
     * same arithmetic was already removed from the grid badges.
     *
     * The ordering is still useful even when the number is not, so those rows
     * keep their place and show the view count instead. The rank column
     * carries the position either way.
     */
    const metric = document.createElement("div");
    metric.className = "ytcs-nmetric";
    const mval = document.createElement("div");
    mval.className = "ytcs-nmval";
    const mlab = document.createElement("div");
    mlab.className = "ytcs-nmlab";
    if (it.measured) {
      mval.textContent = it.ratio.toFixed(1) + "x";
      mlab.textContent = "Normal pace";
    } else {
      mval.textContent = fmtCompact(it.v.views);
      mlab.textContent = "Views";
    }
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
    hint.textContent = "No channels tracked yet. Add a few, then refresh to see what is beating its own channel's normal pace right now.";
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
      clearNicheResults();
      ui.nicheStatus.textContent = state.watchlist.length
        ? plural(state.watchlist.length, "channel") + " tracked, refresh to update"
        : "";
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
    /*
     * The heading has to match what the list is actually ranked on. With no
     * snapshots yet there is no velocity to speak of, so it says so rather
     * than promising a finding it cannot make.
     */
    let title;
    if (!measured) {
      title = "Their biggest uploads of the last " + RECENT_DAYS + " days";
      basis = "Ranked on plain view count, because one visit cannot measure how fast anything is " +
        "moving. Refresh again after a gap and this becomes growth measured between your visits.";
    } else if (measured === total) {
      title = "What is working right now";
      basis = "Ranked on growth measured between your own visits, not inferred from upload dates.";
    } else {
      title = "What is working right now";
      basis = "The first " + measured + " of " + total + " are ranked on growth measured between " +
        "your visits. The rest are recent uploads from channels without a second reading yet, " +
        "ranked on view count, which is why they carry no multiple.";
    }
    ui.nicheResults.appendChild(section(title, nicheList(state.nicheItems), basis));
  }
  if (state.gapItems.length) {
    ui.nicheResults.appendChild(section(
      "Content gaps: topics they cover and you do not",
      dataTable(["Topic", "Their videos", "Their median views"], state.gapItems.slice(0, 20).map((g) => [
        g.word,
        String(g.count),
        fmtCompact(Math.round(g.medViews)),
      ])),
      "Ranked by how much of their catalogue the topic takes up, which is a fact " +
      "you can check on their channel. It is not a claim that covering it would " +
      "work for you."
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
  const filtersBite = name === "search" || state.insight === "overview";
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
