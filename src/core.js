/*
 * YouTube Channel Search+
 * Configuration, parsers, and the InnerTube catalog reader.
 * No DOM here: this half only knows how to turn a channel into video records.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- constants -----------------------------------------------------------
const FALLBACK_VER = "2.20240710.01.00";

// Defaults, overridden from the options page. Kept in one place so the
// options form and the runtime cannot drift apart.
const DEFAULTS = {
  maxVideos: 1800,
  finishedAt: 90,
  defaultSort: "newest",
  hideWatched: false,
  autoOpen: false,
};
const cfg = Object.assign({}, DEFAULTS);

function loadSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(DEFAULTS, (got) => {
        if (!chrome.runtime.lastError && got) Object.assign(cfg, got);
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}
const SNAPSHOT_LIMIT = 8; // how many view-count snapshots we keep per channel
const VELOCITY_FLOOR = 200; // ignore measured growth below this many views as noise
const MIN_MEASURED = 3; // videos with velocity needed before a channel ranks by it
const OUTLIER_X = 2; // how far past the channel median earns an outlier badge

// "1 channels" reads like a bug even when the number is right.
function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

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

// Resume-playback overlay: how far through the video this account already is.
function overlayProgress(vr) {
  const overlays = vr.thumbnailOverlays || [];
  for (const o of overlays) {
    const r = o.thumbnailOverlayResumePlaybackRenderer;
    if (r && typeof r.percentDurationWatched === "number") return r.percentDurationWatched;
  }
  return null;
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
  return { id, title, durationText, seconds, views, publishedText, days, progress: overlayProgress(vr) };
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

// Same idea in the lockup shape: a progress bar sits in the bottom overlay.
function lockupProgress(lvm) {
  const tvm = lvm.contentImage && lvm.contentImage.thumbnailViewModel;
  const overlays = (tvm && tvm.overlays) || [];
  for (const o of overlays) {
    const bottom = o.thumbnailBottomOverlayViewModel;
    const bar = bottom && bottom.progressBar && bottom.progressBar.thumbnailOverlayProgressBarViewModel;
    if (bar && typeof bar.startPercent === "number") return bar.startPercent;
  }
  return null;
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
    progress: lockupProgress(lvm),
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
  const maxPages = Math.max(1, Math.ceil(cfg.maxVideos / 30));
  while (token && pages < maxPages) {
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
