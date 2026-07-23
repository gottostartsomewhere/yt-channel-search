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
    medianVpd: 0, view: "grid", newIds: new Set(), cachedAt: 0,
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
    if (state.view === "analytics") renderAnalytics(rows);
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
  function barChart(data) {
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
    });
    return root;
  }
  function scatterChart(points, xMax, xlab) {
    const W = 340, H = 178, pad = { t: 10, r: 10, b: 26, l: 10 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const yMaxLog = Math.log10(Math.max(10, Math.max.apply(null, points.map((p) => p.y))));
    const root = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "ytcs-svg", preserveAspectRatio: "xMidYMid meet" });
    root.appendChild(svg("line", { x1: pad.l, y1: pad.t + ih, x2: pad.l + iw, y2: pad.t + ih, class: "ytcs-axis" }));
    points.forEach((p) => {
      const px = pad.l + (Math.min(p.x, xMax) / xMax) * iw;
      const py = pad.t + ih - (Math.log10(Math.max(1, p.y)) / yMaxLog) * ih;
      root.appendChild(svg("circle", { cx: px, cy: py, r: 2.4, class: "ytcs-dot" }));
    });
    root.appendChild(svgText(pad.l + iw / 2, H - 4, xlab, "ytcs-axlab"));
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

    const viewsData = bucketCounts(rows, [
      ["<1K", 0, 1e3], ["1–10K", 1e3, 1e4], ["10–100K", 1e4, 1e5],
      ["100K–1M", 1e5, 1e6], ["1–10M", 1e6, 1e7], ["10M+", 1e7, Infinity],
    ], (v) => v.views);
    ui.charts.appendChild(chartCard("Views distribution", barChart(viewsData)));

    const lenData = bucketCounts(rows, [
      ["<1m", 0, 60], ["1–4m", 60, 240], ["4–20m", 240, 1200],
      ["20–60m", 1200, 3600], ["60m+", 3600, Infinity],
    ], (v) => v.seconds);
    ui.charts.appendChild(chartCard("Length distribution", barChart(lenData)));

    const pts = rows.filter((v) => v.seconds > 0 && v.views > 0).map((v) => ({ x: v.seconds, y: v.views }));
    const xMax = pts.length ? Math.max.apply(null, pts.map((p) => p.x)) : 3600;
    ui.charts.appendChild(chartCard("Length vs views (log)", pts.length ? scatterChart(pts, xMax, "video length →") : chartEmpty()));
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

  // ---- view toggle ---------------------------------------------------------
  function setView(name) {
    state.view = name;
    const analytics = name === "analytics";
    ui.grid.style.display = analytics ? "none" : "";
    ui.analytics.style.display = analytics ? "" : "none";
    ui.tabGrid.classList.toggle("ytcs-tabon", !analytics);
    ui.tabAnalytics.classList.toggle("ytcs-tabon", analytics);
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
      ["title_az", "Title A→Z"],
    ]);

    const status = document.createElement("span");
    status.className = "ytcs-status";
    const count = document.createElement("span");
    count.className = "ytcs-count";

    // view tabs
    const tabGrid = document.createElement("button");
    tabGrid.className = "ytcs-tab ytcs-tabon";
    tabGrid.textContent = "Grid";
    const tabAnalytics = document.createElement("button");
    tabAnalytics.className = "ytcs-tab";
    tabAnalytics.textContent = "Analytics";
    const tabs = document.createElement("div");
    tabs.className = "ytcs-tabs";
    tabs.appendChild(tabGrid);
    tabs.appendChild(tabAnalytics);

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

    wrap.appendChild(bar);
    wrap.appendChild(stats);
    wrap.appendChild(grid);
    wrap.appendChild(analytics);

    ui = {
      wrap, bar, kw, duration, views, uploaded, sort, status, count,
      stats, grid, analytics, charts, tabGrid, tabAnalytics,
      cmpInput, cmpBtn, cmpStatus, cmpResult,
    };

    tabGrid.onclick = () => setView("grid");
    tabAnalytics.onclick = () => setView("analytics");
    cmpBtn.onclick = () => runCompare();
    cmpInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runCompare(); });

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

  function recomputeMedianVpd() {
    const vpds = state.catalog.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
    state.medianVpd = median(vpds);
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
      recomputeMedianVpd();
      ui.status.textContent = state.catalog.length + " cached • " + fmtAgo(state.cachedAt);
      applyView();
      return;
    }
    await refreshCatalog();
  }

  // Always re-fetch; diff against the cached ids to flag new uploads.
  async function refreshCatalog() {
    if (state.loading) return;
    state.loading = true;
    ui.grid.classList.add("ytcs-busy");
    ui.status.textContent = "loading… 0";
    const key = channelBasePath();
    let oldIds = null;
    const prev = key ? await idbGet(key) : null;
    if (prev && prev.ids) oldIds = new Set(prev.ids);
    try {
      const cat = await fetchCatalog((n) => (ui.status.textContent = "loading… " + n));
      state.catalog = cat;
      state.cachedAt = Date.now();
      recomputeMedianVpd();
      state.newIds = oldIds ? new Set(cat.filter((v) => !oldIds.has(v.id)).map((v) => v.id)) : new Set();
      if (key) idbPut(key, { channel: key, fetchedAt: state.cachedAt, videos: cat, ids: cat.map((v) => v.id) });
      const newN = state.newIds.size;
      ui.status.textContent = cat.length + " loaded" + (newN ? " • " + newN + " new" : "");
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
