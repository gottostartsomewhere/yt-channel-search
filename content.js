/*
 * YouTube Channel Search+  ·  content script
 *
 * YouTube's in-channel search only matches text. To filter by duration, views,
 * or date you need the data first, so this reads the channel's entire uploads
 * catalog through InnerTube, then filters, sorts, and renders it in place of the
 * native video grid.
 */
(function () {
  "use strict";

  if (window.__ytcsLoaded) return;
  window.__ytcsLoaded = true;

  // ---- constants -----------------------------------------------------------
  const MAX_PAGES = 60; // safety cap: ~30 videos/page => ~1800 videos
  const FALLBACK_VER = "2.20240710.01.00";
  const SNAPSHOT_LIMIT = 8; // how many view-count snapshots we keep per channel
  const VELOCITY_FLOOR = 200; // ignore measured growth below this many views as noise
  const MIN_MEASURED = 3; // videos with velocity needed before a channel ranks by it

  // Kept in step with the filter dropdowns so a chart bar can drive the grid.
  const VIEW_BUCKETS = [
    ["<10K", 0, 1e4], ["10-100K", 1e4, 1e5], ["100K-1M", 1e5, 1e6],
    ["1-10M", 1e6, 1e7], ["10M+", 1e7, Infinity],
  ];
  const VIEW_VALUES = ["0-10000", "10000-100000", "100000-1000000", "1000000-10000000", "10000000-"];
  const LEN_BUCKETS = [
    ["<1m", 0, 60], ["1-4m", 60, 240], ["4-20m", 240, 1200],
    ["20-60m", 1200, 3600], ["60m+", 3600, Infinity],
  ];
  const LEN_VALUES = ["0-60", "60-240", "240-1200", "1200-3600", "3600-"];

  // Finer bins than the filter, so the length/performance curve has some shape.
  const LENGTH_CURVE = [
    ["0-2m", 0, 120], ["2-5m", 120, 300], ["5-10m", 300, 600], ["10-15m", 600, 900],
    ["15-20m", 900, 1200], ["20-30m", 1200, 1800], ["30-45m", 1800, 2700],
    ["45-60m", 2700, 3600], ["60m+", 3600, Infinity],
  ];

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
    return fetchCatalogFrom(channelVideosUrl(), onProgress);
  }

  // Fetch the full uploads catalog for any channel's /videos URL (used by compare too).
  async function fetchCatalogFrom(url, onProgress) {
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
  const state = {
    catalog: [], loading: false, active: false, nativeGrid: null, nativeDisplay: "",
    medianVpd: 0, medianViews: 0, view: "grid", newIds: new Set(), cachedAt: 0,
    watchlist: [], nicheItems: [], gapItems: [],
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
    if (sort === "oldest") rows = rows.slice().reverse();
    else if (sort !== "newest" && sorters[sort]) rows = rows.slice().sort(sorters[sort]);
    return rows;
  }

  function applyView() {
    if (!ui) return;
    const rows = filterAndSort();
    renderStats(rows);
    if (state.view === "analytics") renderAnalytics(rows);
    else if (state.view === "titles") renderTitles(rows);
    else if (state.view === "niche") renderNiche();
    else renderGrid(rows);
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
      if (v.gained > 0 && v.sinceDays) {
        const span = v.sinceDays < 1
          ? Math.max(1, Math.round(v.sinceDays * 24)) + "h"
          : Math.round(v.sinceDays) + "d";
        const measured = document.createElement("div");
        measured.className = "ytcs-cmeasured";
        measured.textContent = "+" + fmtCompact(Math.round(v.gained)) + " in the last " + span;
        info.appendChild(measured);
      }
      if (state.medianVpd && vpdVal >= 2 * state.medianVpd) {
        const badge = document.createElement("span");
        badge.className = "ytcs-outlier";
        badge.textContent = (vpdVal / state.medianVpd).toFixed(1) + "×";
        thumb.appendChild(badge);
      }
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

  // ---- IndexedDB cache -----------------------------------------------------
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("ytcs", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("catalogs");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return await new Promise((res, rej) => {
        const rq = db.transaction("catalogs", "readonly").objectStore("catalogs").get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) { return null; }
  }
  async function idbPut(key, val) {
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction("catalogs", "readwrite");
        tx.objectStore("catalogs").put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* cache is best-effort */ }
  }
  function fmtAgo(ms) {
    if (!ms) return "";
    const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  // ---- aggregate stats -----------------------------------------------------
  function statsOf(cat) {
    const n = cat.length;
    const total = cat.reduce((s, v) => s + v.views, 0);
    const medViews = median(cat.map((v) => v.views));
    const avgDur = n ? Math.round(cat.reduce((s, v) => s + v.seconds, 0) / n) : 0;
    const vpds = cat.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
    const medVpd = median(vpds);
    const topVpd = vpds.length ? Math.max.apply(null, vpds) : 0;
    return { n, total, medViews, avgDur, medVpd, topVpd };
  }

  // ---- export --------------------------------------------------------------
  function toCSV(rows) {
    const cols = ["title", "videoId", "url", "durationSeconds", "duration", "views", "published", "approxDaysAgo", "viewsPerDay"];
    const esc = (s) => {
      s = String(s == null ? "" : s);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(",")];
    for (const v of rows) {
      const vpd = v.days ? Math.round(v.views / Math.max(v.days, 1)) : "";
      lines.push([
        esc(v.title), v.id, "https://youtu.be/" + v.id, v.seconds, esc(fmtDuration(v.seconds)),
        v.views, esc(v.publishedText), v.days != null ? Math.round(v.days) : "", vpd,
      ].join(","));
    }
    return lines.join("\n");
  }
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportName(ext) {
    const base = (channelBasePath() || "channel").replace(/[^\w@.-]/g, "_").replace(/^_+/, "");
    return (base || "channel") + "-videos." + ext;
  }
  function exportCSV() { download(exportName("csv"), toCSV(filterAndSort()), "text/csv;charset=utf-8"); }
  function exportJSON() { download(exportName("json"), JSON.stringify(filterAndSort(), null, 2), "application/json"); }

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

  // ---- compare channels ----------------------------------------------------
  function normalizeChannelInput(input) {
    input = (input || "").trim();
    if (!input) return null;
    const m = input.match(/youtube\.com\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/i);
    if (m) return "https://www.youtube.com/" + m[1] + "/videos";
    if (input.charAt(0) === "@") return "https://www.youtube.com/" + input + "/videos";
    if (/^UC[\w-]{20,}$/.test(input)) return "https://www.youtube.com/channel/" + input + "/videos";
    if (/^[\w.-]+$/.test(input)) return "https://www.youtube.com/@" + input + "/videos";
    return null;
  }
  async function runCompare() {
    const raw = ui.cmpInput.value.trim();
    if (!raw) return;
    const url = normalizeChannelInput(raw);
    if (!url) { ui.cmpStatus.textContent = "couldn't parse that channel"; return; }
    ui.cmpBtn.disabled = true;
    ui.cmpStatus.textContent = "loading… 0";
    try {
      const cat = await fetchCatalogFrom(url, (n) => (ui.cmpStatus.textContent = "loading… " + n));
      ui.cmpStatus.textContent = cat.length + " videos";
      const label = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, "").replace(/\/.*$/, "");
      renderCompare(state.catalog, cat, label);
    } catch (e) {
      ui.cmpStatus.textContent = "error: " + e.message;
    } finally {
      ui.cmpBtn.disabled = false;
    }
  }
  function renderCompare(catA, catB, labelB) {
    const a = statsOf(catA), b = statsOf(catB);
    const metrics = [
      ["Videos", String(a.n), String(b.n)],
      ["Total views", fmtCompact(a.total), fmtCompact(b.total)],
      ["Median views", fmtCompact(a.medViews), fmtCompact(b.medViews)],
      ["Avg length", fmtDuration(a.avgDur) || "–", fmtDuration(b.avgDur) || "–"],
      ["Median views/day", fmtCompact(Math.round(a.medVpd)), fmtCompact(Math.round(b.medVpd))],
      ["Top views/day", fmtCompact(Math.round(a.topVpd)), fmtCompact(Math.round(b.topVpd))],
    ];
    const thisLabel = (channelBasePath() || "this channel").replace(/^\//, "");
    const tbl = document.createElement("table");
    tbl.className = "ytcs-cmptable";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    ["", thisLabel, labelB].forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    tbl.appendChild(thead);
    const tb = document.createElement("tbody");
    for (const row of metrics) {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = document.createElement("td");
        td.textContent = cell;
        if (i === 0) td.className = "ytcs-cmpk";
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    ui.cmpResult.innerHTML = "";
    ui.cmpResult.appendChild(tbl);
  }

  // ---- small layout helpers ------------------------------------------------
  function section(title, node) {
    const wrap = document.createElement("div");
    wrap.className = "ytcs-section";
    const h = document.createElement("div");
    h.className = "ytcs-sectitle";
    h.textContent = title;
    wrap.appendChild(h);
    wrap.appendChild(node);
    return wrap;
  }

  function dataTable(headers, rows) {
    const t = document.createElement("table");
    t.className = "ytcs-dtable";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    headers.forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    t.appendChild(thead);
    const tb = document.createElement("tbody");
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      r.forEach((cell, i) => {
        const td = document.createElement("td");
        td.textContent = cell;
        if (i === 0) td.className = "ytcs-dk";
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  // ---- title and format analysis -------------------------------------------
  const STOPWORDS = new Set((
    "the a an and or but of to in on for with at by from up about into over after " +
    "is are was were be been being do does did doing have has had this that these " +
    "those it its you your my our their his her they them we he she who what why " +
    "when where which how all any can will just not no yes get got more most out " +
    "one two new now than then there here"
  ).split(" "));

  function tokenize(title) {
    return String(title)
      .toLowerCase()
      .replace(/[‘’']/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  }

  // Median views of the videos containing each word, versus the overall median.
  function keywordStats(rows, minCount) {
    const buckets = new Map();
    rows.forEach((v) => {
      new Set(tokenize(v.title)).forEach((w) => {
        if (!buckets.has(w)) buckets.set(w, []);
        buckets.get(w).push(v.views);
      });
    });
    const base = median(rows.map((v) => v.views)) || 1;
    const out = [];
    buckets.forEach((views, word) => {
      if (views.length >= minCount) {
        const m = median(views);
        out.push({ word: word, count: views.length, medViews: m, lift: m / base });
      }
    });
    return out.sort((a, b) => b.lift - a.lift);
  }

  const TITLE_PATTERNS = [
    ["Question", (t) => /\?/.test(t)],
    ["Versus / comparison", (t) => /\bvs\.?\b|\bversus\b/i.test(t)],
    ["Numbered or list", (t) => /^\s*\d+\b|\btop\s+\d+\b|\b\d+\s+(things|ways|tips|reasons|rules)\b/i.test(t)],
    ["Bracketed tag", (t) => /\[[^\]]+\]|\([^)]+\)/.test(t)],
    ["First person", (t) => /\b(i|my|me|we)\b/i.test(t)],
    ["Shouted word", (t) => /\b[A-Z]{3,}\b/.test(t)],
    ["Superlative", (t) => /\b(best|worst|ultimate|greatest|craziest|insane)\b/i.test(t)],
    ["How to", (t) => /\bhow to\b/i.test(t)],
  ];

  function patternStats(rows) {
    const base = median(rows.map((v) => v.views)) || 1;
    return TITLE_PATTERNS
      .map((p) => {
        const hit = rows.filter((v) => p[1](v.title));
        const m = hit.length ? median(hit.map((v) => v.views)) : 0;
        return { name: p[0], count: hit.length, medViews: m, lift: hit.length ? m / base : 0 };
      })
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.lift - a.lift);
  }

  function titleLengthStats(rows) {
    const buckets = [["<30", 0, 30], ["30-45", 30, 45], ["45-60", 45, 60], ["60-75", 60, 75], ["75+", 75, Infinity]];
    return buckets.map((b) => {
      const hit = rows.filter((v) => v.title.length >= b[1] && v.title.length < b[2]);
      return { label: b[0], value: hit.length ? Math.round(median(hit.map((v) => v.views))) : 0 };
    });
  }

  function renderTitles(rows) {
    ui.titles.innerHTML = "";
    if (rows.length < 4) {
      ui.titles.appendChild(chartEmpty());
      return;
    }
    ui.titles.appendChild(section("Median views by title length", barChart(titleLengthStats(rows))));

    const kw = keywordStats(rows, 3).slice(0, 20);
    ui.titles.appendChild(section(
      "Words that lift performance",
      kw.length
        ? dataTable(["Word", "Videos", "Median views", "Lift"], kw.map((k) => [
            k.word, String(k.count), fmtCompact(Math.round(k.medViews)), k.lift.toFixed(2) + "x",
          ]))
        : chartEmpty()
    ));

    const pat = patternStats(rows);
    ui.titles.appendChild(section(
      "Title formats",
      pat.length
        ? dataTable(["Format", "Videos", "Median views", "Lift"], pat.map((p) => [
            p.name, String(p.count), fmtCompact(Math.round(p.medViews)), p.lift.toFixed(2) + "x",
          ]))
        : chartEmpty()
    ));
  }

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
        console.error("[Channel Search+] watchlist", key, e);
      }
    }
    outliers.sort((a, b) => b.ratio - a.ratio);
    state.nicheItems = outliers;
    state.gapItems = state.catalog.length ? contentGap(state.catalog, theirVideos, 3) : [];
    const mode = liveChannels
      ? liveChannels + " of " + state.watchlist.length + " live"
      : "baseline set, refresh again later for live velocity";
    ui.nicheStatus.textContent =
      state.watchlist.length + " channels · " + theirVideos.length + " videos · " + outliers.length + " outliers · " + mode;
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
  }

  // ---- view switching ------------------------------------------------------
  function setView(name) {
    state.view = name;
    const panes = { grid: ui.grid, analytics: ui.analytics, titles: ui.titles, niche: ui.niche };
    const tabs = { grid: ui.tabGrid, analytics: ui.tabAnalytics, titles: ui.tabTitles, niche: ui.tabNiche };
    Object.keys(panes).forEach((k) => {
      panes[k].style.display = k === name ? "" : "none";
      tabs[k].classList.toggle("ytcs-tabon", k === name);
    });
    applyView();
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
    bar.appendChild(field("Sort", sort));
    bar.appendChild(status);
    bar.appendChild(count);
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
    cmp.appendChild(cmpHead);
    cmp.appendChild(cmpRow);
    cmp.appendChild(cmpResult);
    analytics.appendChild(cmp);

    // title analysis pane
    const titles = document.createElement("div");
    titles.className = "ytcs-pane";
    titles.style.display = "none";

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

    wrap.appendChild(bar);
    wrap.appendChild(stats);
    wrap.appendChild(grid);
    wrap.appendChild(analytics);
    wrap.appendChild(titles);
    wrap.appendChild(niche);

    ui = {
      wrap, bar, kw, duration, views, uploaded, sort, status, count,
      stats, grid, analytics, charts, titles, niche,
      tabGrid, tabAnalytics, tabTitles, tabNiche,
      cmpInput, cmpBtn, cmpStatus, cmpResult,
      nicheInput, nicheAdd, nicheRefresh, nicheStatus, nicheChips, nicheResults,
    };

    tabGrid.onclick = () => setView("grid");
    tabAnalytics.onclick = () => setView("analytics");
    tabTitles.onclick = () => setView("titles");
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
      ui.status.textContent = state.catalog.length + " cached • " + fmtAgo(state.cachedAt);
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
  setInterval(ensureUi, 1500);
  ensureUi();
})();
