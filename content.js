/* YouTube Channel Search+  —  content script
 *
 * Core idea: YouTube's in-channel search is a server-side InnerTube request that
 * only matches text. To filter by duration / views / date, we pull the channel's
 * full uploads catalog once (via InnerTube continuations), then filter + sort it
 * client-side and RENDER the results in place of the channel's native video grid.
 */
(function () {
  "use strict";

  if (window.__ytcsLoaded) return;
  window.__ytcsLoaded = true;

  // ---- constants -----------------------------------------------------------
  const MAX_PAGES = 60; // safety cap: ~30 videos/page => ~1800 videos
  const FALLBACK_VER = "2.20240710.01.00";

  // ---- small parsers -------------------------------------------------------
  function parseDuration(t) {
    if (!t) return 0;
    const parts = String(t).trim().split(":").map((x) => parseInt(x, 10));
    if (parts.some(isNaN)) return 0;
    let s = 0;
    for (const p of parts) s = s * 60 + p;
    return s;
  }

  function parseViews(t) {
    if (!t) return 0;
    t = String(t).toLowerCase();
    if (t.includes("no views")) return 0;
    const m = t.match(/([\d.,]+)\s*([kmb]?)/);
    if (!m) return 0;
    let num = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(num)) return 0;
    const suf = m[2];
    if (suf === "k") num *= 1e3;
    else if (suf === "m") num *= 1e6;
    else if (suf === "b") num *= 1e9;
    return Math.round(num);
  }

  // relative "2 years ago" -> approximate days since upload
  function parseRelativeDays(t) {
    if (!t) return null;
    const m = String(t).match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const map = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
    return n * map[m[2].toLowerCase()];
  }

  // ---- JSON extraction from page HTML --------------------------------------
  function sliceBalancedJson(s, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) return s.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  function findJson(html, marker) {
    let from = 0;
    while (true) {
      const i = html.indexOf(marker, from);
      if (i === -1) return null;
      const brace = html.indexOf("{", i);
      if (brace === -1) return null;
      const jsonStr = sliceBalancedJson(html, brace);
      if (jsonStr) {
        try { return JSON.parse(jsonStr); } catch (e) { /* keep looking */ }
      }
      from = i + marker.length;
    }
  }

  // first value found for `key` anywhere in the object tree
  function deepFind(obj, key) {
    if (obj == null || typeof obj !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === "object") {
        const found = deepFind(v, key);
        if (found != null) return found;
      }
    }
    return null;
  }

  // ---- video mapping (legacy videoRenderer) --------------------------------
  function overlayDuration(vr) {
    const overlays = vr.thumbnailOverlays || [];
    for (const o of overlays) {
      const r = o.thumbnailOverlayTimeStatusRenderer;
      if (r && r.text) return r.text.simpleText || (r.text.runs && r.text.runs[0] && r.text.runs[0].text) || "";
    }
    return "";
  }

  function mapVideo(vr) {
    const id = vr.videoId;
    const title =
      (vr.title && vr.title.runs && vr.title.runs[0] && vr.title.runs[0].text) ||
      (vr.title && vr.title.simpleText) || "(no title)";
    const durationText = (vr.lengthText && vr.lengthText.simpleText) || overlayDuration(vr) || "";
    const seconds = parseDuration(durationText);
    const viewsText =
      (vr.viewCountText && vr.viewCountText.simpleText) ||
      (vr.shortViewCountText && vr.shortViewCountText.simpleText) || "";
    const views = parseViews(viewsText);
    const publishedText = (vr.publishedTimeText && vr.publishedTimeText.simpleText) || "";
    const days = parseRelativeDays(publishedText);
    return { id, title, durationText, seconds, views, publishedText, days };
  }

  // ---- video mapping (current lockupViewModel shape) -----------------------
  function lockupDuration(lvm) {
    const tvm = lvm.contentImage && lvm.contentImage.thumbnailViewModel;
    const overlays = (tvm && tvm.overlays) || [];
    for (const o of overlays) {
      const badges =
        (o.thumbnailBottomOverlayViewModel && o.thumbnailBottomOverlayViewModel.badges) ||
        (o.thumbnailOverlayBadgeViewModel && o.thumbnailOverlayBadgeViewModel.thumbnailBadges) ||
        [];
      for (const b of badges) {
        const t = b.thumbnailBadgeViewModel && b.thumbnailBadgeViewModel.text;
        if (t && /^\d{1,2}(:\d{2})+$/.test(t)) return t;
      }
    }
    return "";
  }

  function lockupMeta(lvm) {
    const lmv = lvm.metadata && lvm.metadata.lockupMetadataViewModel;
    const cmv = lmv && lmv.metadata && lmv.metadata.contentMetadataViewModel;
    const rows = (cmv && cmv.metadataRows) || [];
    let viewsText = "", publishedText = "";
    for (const row of rows) {
      for (const part of row.metadataParts || []) {
        const c = part.text && part.text.content;
        if (!c) continue;
        if (/view/i.test(c)) viewsText = c;
        else if (/ago|streamed|premiered/i.test(c)) publishedText = c;
      }
    }
    return { viewsText, publishedText };
  }

  function idFromThumb(lvm) {
    const tvm = lvm.contentImage && lvm.contentImage.thumbnailViewModel;
    const sources = tvm && tvm.image && tvm.image.sources;
    const url = sources && sources[0] && sources[0].url;
    const m = url && url.match(/\/vi\/([\w-]+)\//);
    return m ? m[1] : null;
  }

  function mapLockup(lvm) {
    if (lvm.contentType && lvm.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
    const id = lvm.contentId || idFromThumb(lvm);
    if (!id) return null;
    const lmv = lvm.metadata && lvm.metadata.lockupMetadataViewModel;
    const title = (lmv && lmv.title && lmv.title.content) || "(no title)";
    const durationText = lockupDuration(lvm);
    const seconds = parseDuration(durationText);
    const { viewsText, publishedText } = lockupMeta(lvm);
    return {
      id,
      title,
      durationText,
      seconds,
      views: parseViews(viewsText),
      publishedText,
      days: parseRelativeDays(publishedText),
    };
  }

  function parseItemArray(arr) {
    const videos = [];
    let token = null;
    for (const it of arr || []) {
      if (it.richItemRenderer && it.richItemRenderer.content) {
        const content = it.richItemRenderer.content;
        if (content.lockupViewModel) {
          const v = mapLockup(content.lockupViewModel);
          if (v) videos.push(v);
        } else if (content.videoRenderer && content.videoRenderer.videoId) {
          videos.push(mapVideo(content.videoRenderer));
        }
      } else if (it.continuationItemRenderer) {
        const ce = it.continuationItemRenderer.continuationEndpoint;
        token = (ce && ce.continuationCommand && ce.continuationCommand.token) || null;
      }
    }
    return { videos, token };
  }

  // ---- channel URL helpers -------------------------------------------------
  function channelBasePath() {
    const segs = location.pathname.split("/").filter(Boolean);
    if (!segs.length) return null;
    if (segs[0] === "channel" || segs[0] === "c" || segs[0] === "user") {
      return "/" + segs.slice(0, 2).join("/");
    }
    if (segs[0].startsWith("@")) return "/" + segs[0];
    return null;
  }

  function isChannelPage() {
    return channelBasePath() != null;
  }

  function channelVideosUrl() {
    const base = channelBasePath();
    return base ? location.origin + base + "/videos" : null;
  }

  // ---- catalog fetcher (the core primitive) --------------------------------
  async function fetchContinuation(apiKey, clientVersion, token) {
    const res = await fetch(
      location.origin + "/youtubei/v1/browse?key=" + apiKey + "&prettyPrint=false",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-YouTube-Client-Name": "1",
          "X-YouTube-Client-Version": clientVersion,
        },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion } },
          continuation: token,
        }),
      }
    );
    return res.json();
  }

  async function fetchCatalog(onProgress) {
    const url = channelVideosUrl();
    if (!url) throw new Error("Not on a channel page.");

    const html = await (await fetch(url, { credentials: "same-origin" })).text();
    const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    if (!apiKey) throw new Error("Could not read YouTube's API key from the page.");
    const clientVersion =
      (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] ||
      (html.match(/"clientVersion":"([^"]+)"/) || [])[1] ||
      FALLBACK_VER;

    const data = findJson(html, "ytInitialData");
    if (!data) throw new Error("Could not parse ytInitialData.");
    const grid = deepFind(data, "richGridRenderer");
    if (!grid || !grid.contents) throw new Error("No videos grid found (channel may have no uploads tab).");

    let { videos, token } = parseItemArray(grid.contents);
    const all = videos.slice();
    onProgress(all.length);

    let pages = 0;
    while (token && pages < MAX_PAGES) {
      pages++;
      let json;
      try {
        json = await fetchContinuation(apiKey, clientVersion, token);
      } catch (e) {
        break;
      }
      const arr = deepFind(json, "continuationItems");
      if (!arr) break;
      const res = parseItemArray(arr);
      all.push(...res.videos);
      token = res.token;
      onProgress(all.length);
      if (res.videos.length === 0) break;
    }
    return all;
  }

  // ---- formatting ----------------------------------------------------------
  function fmtCompact(n) {
    if (n == null) return "–";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  }

  function fmtDuration(s) {
    if (!s) return "";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (x) => String(x).padStart(2, "0");
    return h > 0 ? h + ":" + pad(m) + ":" + pad(sec) : m + ":" + pad(sec);
  }

  // ---- state ---------------------------------------------------------------
  const state = { catalog: [], loading: false, active: false, nativeGrid: null, nativeDisplay: "", medianVpd: 0 };
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

  function filterAndSort() {
    const kw = ui.kw.value.trim().toLowerCase();
    const [minDur, maxDur] = rangeVal(ui.duration);
    const [minViews, maxViews] = rangeVal(ui.views);
    const uploaded = ui.uploaded.value; // "", "7", "31", "93", "366", "old"
    const sort = ui.sort.value;

    let rows = state.catalog.filter((v) => {
      if (kw && !v.title.toLowerCase().includes(kw)) return false;
      if (v.seconds < minDur || v.seconds > maxDur) return false;
      if (v.views < minViews || v.views > maxViews) return false;
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
    const sorters = {
      views_desc: (a, b) => b.views - a.views,
      views_asc: (a, b) => a.views - b.views,
      duration_desc: (a, b) => b.seconds - a.seconds,
      duration_asc: (a, b) => a.seconds - b.seconds,
      vpd_desc: (a, b) => vpd(b) - vpd(a),
      title_az: (a, b) => a.title.localeCompare(b.title),
    };
    if (sort === "oldest") rows = rows.slice().reverse();
    else if (sort !== "newest" && sorters[sort]) rows = rows.slice().sort(sorters[sort]);
    return rows;
  }

  function applyView() {
    if (!ui) return;
    const rows = filterAndSort();
    renderStats(rows);
    renderGrid(rows);
    ui.count.textContent = rows.length + " of " + state.catalog.length;
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function renderStats(rows) {
    const n = rows.length;
    const totalViews = rows.reduce((s, v) => s + v.views, 0);
    const medViews = median(rows.map((v) => v.views));
    const avgDur = n ? Math.round(rows.reduce((s, v) => s + v.seconds, 0) / n) : 0;
    const vpds = rows.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
    const medVpd = median(vpds);
    const tiles = [
      ["Videos", String(n)],
      ["Total views", fmtCompact(totalViews)],
      ["Median views", fmtCompact(medViews)],
      ["Avg length", fmtDuration(avgDur) || "–"],
      ["Median/day", fmtCompact(Math.round(medVpd))],
    ];
    ui.stats.innerHTML = "";
    for (const [label, val] of tiles) {
      const tile = document.createElement("div");
      tile.className = "ytcs-stat";
      const vEl = document.createElement("div");
      vEl.className = "ytcs-statval";
      vEl.textContent = val;
      const lEl = document.createElement("div");
      lEl.className = "ytcs-statlabel";
      lEl.textContent = label;
      tile.appendChild(vEl);
      tile.appendChild(lEl);
      ui.stats.appendChild(tile);
    }
  }

  function renderGrid(rows) {
    const frag = document.createDocumentFragment();
    const shown = rows.slice(0, 600);
    for (const v of shown) {
      const card = document.createElement("a");
      card.className = "ytcs-card";
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
      if (state.medianVpd && vpdVal >= 2 * state.medianVpd) {
        const badge = document.createElement("span");
        badge.className = "ytcs-outlier";
        badge.textContent = "🔥 " + (vpdVal / state.medianVpd).toFixed(1) + "×";
        thumb.appendChild(badge);
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
      more.textContent = "Showing first 600 of " + rows.length + " — narrow the filters to see the rest.";
      ui.grid.appendChild(more);
    }
  }

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
    const uploaded = select([
      ["", "Any time"],
      ["7", "Past week"],
      ["31", "Past month"],
      ["93", "Past 3 months"],
      ["366", "Past year"],
      ["old", "Over a year ago"],
    ]);
    const sort = select([
      ["newest", "Newest"],
      ["oldest", "Oldest"],
      ["views_desc", "Most views"],
      ["views_asc", "Fewest views"],
      ["duration_desc", "Longest"],
      ["duration_asc", "Shortest"],
      ["vpd_desc", "Views/day ⚡"],
      ["title_az", "Title A→Z"],
    ]);

    const status = document.createElement("span");
    status.className = "ytcs-status";
    const count = document.createElement("span");
    count.className = "ytcs-count";
    const restore = document.createElement("button");
    restore.className = "ytcs-restore";
    restore.textContent = "Restore YouTube";
    restore.onclick = () => disable();

    bar.appendChild(brand);
    bar.appendChild(field("Keyword", kw));
    bar.appendChild(field("Length", duration));
    bar.appendChild(field("Views", views));
    bar.appendChild(field("Uploaded", uploaded));
    bar.appendChild(field("Sort", sort));
    bar.appendChild(status);
    bar.appendChild(count);
    bar.appendChild(restore);

    const stats = document.createElement("div");
    stats.className = "ytcs-stats";

    const grid = document.createElement("div");
    grid.className = "ytcs-grid";

    wrap.appendChild(bar);
    wrap.appendChild(stats);
    wrap.appendChild(grid);

    ui = { wrap, bar, kw, duration, views, uploaded, sort, status, count, stats, grid };

    for (const el of [kw, duration, views, uploaded, sort]) {
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

  async function loadCatalog() {
    if (state.loading) return;
    state.loading = true;
    ui.grid.classList.add("ytcs-busy");
    ui.status.textContent = "loading… 0";
    try {
      const cat = await fetchCatalog((n) => (ui.status.textContent = "loading… " + n));
      state.catalog = cat;
      const vpds = cat.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
      state.medianVpd = median(vpds);
      ui.status.textContent = cat.length + " loaded";
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
    if (launcher) launcher.textContent = "✕ Close filters";
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
    setTimeout(ensureUi, 300);
  });
  setInterval(ensureUi, 1500);
  ensureUi();
})();
