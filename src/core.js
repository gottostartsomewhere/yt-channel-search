/*
 * Needle for YouTube
 * Configuration, parsers, and the InnerTube catalogue reader.
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
  /*
   * Off by default, and it stays off until someone deliberately turns it on.
   *
   * Reading history past the first page means signing the request with the
   * SAPISID cookie, the same way youtube.com's own scripts do. Nothing leaves
   * the device and it is the user's own session, but reading an auth cookie is
   * exactly the shape of thing a malicious extension does, and this source is
   * published for anyone to read. So it is a choice somebody makes, not a
   * default they discover afterwards. Documented in PRIVACY.md.
   */
  deepHistory: false,
  /*
   * Your Watch Later, Liked and history in YouTube's own search bar. On by
   * default, unlike deepHistory, because it reads nothing the browser does not
   * already send: page one of each list, fetched with the ordinary session
   * cookies, exactly as if you had opened those pages. No cookie is read and
   * nothing is signed unless deepHistory is also on. Stays on this device.
   */
  librarySearch: true,
  // The row of clickable operator examples under the search bar. A setting
  // rather than a one-way dismissal, so it can be turned back on in the popup.
  filterTips: true,
  /*
   * Reads the whole catalogues of the channels you watch most, one every ten
   * minutes at most while YouTube is open, so in:channels can search them. The
   * data is public and stays on this device; the switch exists because it is
   * reading in the background, which deserves a way to say no.
   */
  channelIndex: true,
};
const cfg = Object.assign({}, DEFAULTS);

// Settings changed in the popup apply to open tabs straight away, instead of
// waiting for a reload that nobody would think to do.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const k in changes) if (k in DEFAULTS) cfg[k] = changes[k].newValue;
  });
} catch (e) { /* no extension context */ }

// "first 138 results" -> "First 138 results". For status and state text only:
// channel names and titles keep whatever case their owners gave them.
function cap(s) {
  s = String(s || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/*
 * A run of short facts ("First 138 results", "Watch progress partial") as
 * separate spans that CSS spaces apart. They used to be joined with " · ",
 * which on a line of three or four facts read as punctuation noise.
 */
function factsInto(el, parts) {
  el.textContent = "";
  for (const p of parts) {
    if (!p) continue;
    const s = document.createElement("span");
    s.className = "ytcs-fact";
    s.textContent = p;
    el.appendChild(s);
  }
  return el;
}

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
const VELOCITY_FLOOR = 200; // a video needs this much measured growth to be a candidate
const MIN_MEASURED = 5; // moving videos needed before a channel's median is worth trusting
// How far back "recent" reaches for a channel with no second reading yet.
const RECENT_DAYS = 90;
const OUTLIER_RATIO = 1.5; // floor: never call anything slower than this an outlier
const OUTLIER_MADS = 2; // and it must also sit this many MADs above the channel median

/*
 * Listing view counts carry two significant figures. A video showing 2.4M moves
 * in steps of 100,000, so growth below that is invisible and a single step
 * across a boundary is indistinguishable from 100,000 real views. Treating
 * those as measurements produces confident nonsense: the server prototype threw
 * 76x alerts that were pure rounding.
 *
 * Requiring three steps puts the error at roughly a third. The honest cost is
 * that ordinary movement on large videos is invisible, which for outlier
 * detection is the right trade. Exact counts need the Data API.
 */
const MIN_STEPS = 3;

function roundingStep(views) {
  if (views < 1000) return 1;
  return Math.pow(10, Math.floor(Math.log10(views)) - 1);
}

function beyondRounding(gained, views) {
  return gained >= roundingStep(views) * MIN_STEPS;
}

// "1 channels" reads like a bug even when the number is right.
function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

/*
 * A rate, which unlike a view count is routinely below one.
 *
 * Rounding these to whole numbers printed "0 median views/day" on a small
 * older channel and "0 views/day" on individual cards, which reads as missing
 * data rather than as the true answer. A video with 451 views over six years
 * really is doing a fifth of a view a day, and saying so is more use than
 * saying nothing. Anything under a tenth is reported as a bound, since another
 * decimal there is noise.
 */
function fmtRate(v) {
  if (!v || v < 0) return "0";
  if (v >= 1) return fmtCompact(Math.round(v));
  if (v >= 0.05) return v.toFixed(1);
  return "<0.1";
}

// "1 views/day" is the same bug as "1 channels", one decimal further along.
function rateText(v, unit) {
  const s = fmtRate(v);
  return s + " view" + (s === "1" ? "" : "s") + "/" + unit;
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

// A view count with the word "views" dropped, the way playlist pages print it:
// "68M", "1.2K", "950". Only ever trusted beside an upload date.
const BARE_COUNT = /^[\d.,]+\s*[KMB]?$/i;

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

/*
 * relative "2 years ago" -> approximate days since upload.
 *
 * Search results abbreviate: "5y ago", "4mo ago", "13d ago", "16h ago". The
 * long-form-only version returned null for every one of them, which silently
 * took every search result out of the date filter and the per-day sorts. A bare
 * "m" is left unmatched on purpose, since it could be minutes or months.
 */
function parseRelativeDays(t) {
  if (!t) return null;
  const m = String(t).match(/(\d+)\s*(years?|yrs?|y|months?|mos?|weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|seconds?|secs?|s)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  const per = u[0] === "y" ? 365 : u.startsWith("mo") ? 30 : u[0] === "w" ? 7 : u[0] === "d" ? 1
    : u[0] === "h" ? 1 / 24 : u.startsWith("mi") ? 1 / 1440 : 1 / 86400;
  return n * per;
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
  const channel = runsText(vr.ownerText) || runsText(vr.longBylineText) || runsText(vr.shortBylineText);
  const handle = handleFrom(vr.ownerText || vr.longBylineText || vr.shortBylineText);
  return { id, title, channel, handle, durationText, seconds, views, publishedText, days, progress: overlayProgress(vr) };
}

function runsText(t) {
  if (!t) return "";
  if (t.simpleText) return t.simpleText;
  return (t.runs || []).map((r) => r.text).join("");
}

/*
 * A collaboration puts "Throwdown and 2 more" where the channel name goes and
 * moves the real list into a dialog. Keeping the first name is right for search,
 * since typing "throwdown" should find it, and wrong only for an exact channel
 * filter, which nothing does yet.
 */
function cleanChannel(s) {
  return String(s || "").replace(/\s+and\s+\d+\s+more$/i, "").trim();
}

// "@mkbhd" from the link on the channel name, or "" where there is none.
function handleFrom(node) {
  const url = node ? deepFind(node, "canonicalBaseUrl") : null;
  const m = typeof url === "string" && url.match(/^\/@([^/?]+)/);
  return m ? m[1].toLowerCase() : "";
}

/*
 * Does a typed "@something" mean this video's channel. Handles and display
 * names rarely agree ("@mkbhd" is "Marques Brownlee"), so the handle is checked
 * where the payload carries one, and the name is checked with its spaces and
 * punctuation squeezed out, so "@letsgetrusty" still finds "Let's Get Rusty".
 */
function matchChannel(v, typed) {
  const c = String(typed || "").toLowerCase();
  if (!c) return true;
  const name = (v.channel || "").toLowerCase();
  const squash = (s) => s.replace(/[^a-z0-9]/g, "");
  return name.includes(c) || (squash(c) && squash(name).includes(squash(c))) || (!!v.handle && v.handle.includes(c));
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
  /*
   * With two or more rows the first is the channel. A channel's own grid has
   * only the views-and-date row, since the channel is the page, so it stays
   * empty there. The part is still checked against the views and date shapes
   * before being taken, so a layout change costs the channel name, never the
   * view counts. That also stops a channel called "The Review" landing in views.
   */
  const head = rows.length >= 2 && rows[0].metadataParts && rows[0].metadataParts[0];
  const first = (head && head.text && head.text.content) || "";
  /*
   * Playlist pages, Watch Later included, shorten the count to a bare "68M"
   * with no "views" after it: ["MrBeast"], ["68M", "6d ago"]. Reading only
   * "…views" left every video in Watch Later at 0 views. A bare count is taken
   * only from the row that also holds the date, and only when nothing says
   * "views", so a stray "4K" somewhere else is never read as one.
   */
  const DATE = /ago|streamed|premiered/i;
  const looksLikeStat = (c) => /^[\d.,]+\s*[KMB]?\s+views?$|^no views$/i.test(c) || BARE_COUNT.test(c.trim()) || DATE.test(c);
  const channelText = first && !looksLikeStat(first) ? first : "";
  const handle = channelText ? handleFrom(head) : "";
  let bare = "";
  for (const row of rows) {
    const parts = (row.metadataParts || []).filter((p) => !(channelText && p === head));
    const texts = parts.map((p) => (p.text && p.text.content) || "");
    const hasDate = texts.some((c) => DATE.test(c));
    for (const c of texts) {
      if (!c) continue;
      if (/view/i.test(c)) viewsText = c;
      else if (DATE.test(c)) publishedText = c;
      else if (hasDate && BARE_COUNT.test(c.trim())) bare = c;
    }
  }
  if (!viewsText && bare) viewsText = bare;
  return { viewsText, publishedText, channelText, handle };
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
  const { viewsText, publishedText, channelText, handle } = lockupMeta(lvm);
  return {
    id,
    title,
    channel: cleanChannel(channelText),
    handle,
    durationText,
    seconds,
    views: parseViews(viewsText),
    publishedText,
    days: parseRelativeDays(publishedText),
    progress: lockupProgress(lvm),
  };
}

// ---- video mapping (shortsLockupViewModel, the /shorts tab) --------------
/*
 * Shorts lockups are a different shape and, more importantly, a poorer one.
 * They carry an id, a title and a view count, and that is all: no upload date
 * and no duration anywhere in the payload.
 *
 * So everything downstream that depends on age (views per day, the per-year
 * charts, recency filters) or on length has nothing to work with. Those fields
 * are left empty rather than zero-filled with plausible-looking numbers, and
 * `isShort` marks the row so shorts can be kept off the main catalogue. Merging
 * them in would quietly move every median in the product, since shorts and
 * long-form have completely different view dynamics.
 *
 * Measured velocity still works on shorts: snapshot diffing never needed dates.
 */
function shortsVideoId(slvm) {
  const cmd = slvm.onTap && slvm.onTap.innertubeCommand;
  const reel = cmd && cmd.reelWatchEndpoint;
  if (reel && reel.videoId) return reel.videoId;
  // entityId is "shorts-shelf-item-<id>". A fallback for when the tap command
  // shape moves, which it does more often than the entity key.
  const m = /^shorts-shelf-item-(.+)$/.exec(slvm.entityId || "");
  return m ? m[1] : null;
}

function mapShortsLockup(slvm) {
  const id = shortsVideoId(slvm);
  if (!id) return null;
  const meta = slvm.overlayMetadata || {};
  return {
    id: id,
    title: (meta.primaryText && meta.primaryText.content) || "",
    isShort: true,
    durationText: "",
    seconds: 0,
    views: parseViews((meta.secondaryText && meta.secondaryText.content) || ""),
    publishedText: "",
    days: 0,
    progress: 0,
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
      } else if (content.shortsLockupViewModel) {
        const v = mapShortsLockup(content.shortsLockupViewModel);
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

/*
 * ---- catalogue fetcher (the core primitive) --------------------------------
 *
 * The messages thrown below are shown to people, not logged, so they say what
 * to do rather than what broke. "Could not parse ytInitialData" was accurate
 * and useless: it named an internal YouTube field to someone who has no idea
 * what that is and no way to act on it. The real cause is almost always a
 * stale page or a YouTube change, and reloading fixes the first and rules out
 * the second. The underlying error still reaches the console for anyone
 * debugging.
 */
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

// Fetch the full uploads catalogue for any channel's /videos URL (used by compare too).
async function fetchCatalogFrom(url, onProgress) {
  if (!url) throw new Error("That is not a channel page.");

  const html = await (await fetch(url, { credentials: "same-origin" })).text();
  const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  if (!apiKey) throw new Error("Could not read this channel. Try reloading the page.");
  const clientVersion =
    (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] ||
    (html.match(/"clientVersion":"([^"]+)"/) || [])[1] ||
    FALLBACK_VER;

  const data = findJson(html, "ytInitialData");
  if (!data) throw new Error("Could not read this channel. Try reloading the page.");
  const grid = deepFind(data, "richGridRenderer");
  if (!grid || !grid.contents) throw new Error("This channel has no videos tab to read.");

  let { videos, token } = parseItemArray(grid.contents);
  const all = videos.slice();
  onProgress(all.length);

  /*
   * The walk is bounded three ways: a page cap from the user's video limit, a
   * break when a page yields nothing, and a break when the payload stops
   * offering a continuation.
   *
   * Ids are tracked as well, because a repeated continuation token would
   * otherwise re-add the same page. That cannot run forever, since the page
   * cap still holds, but duplicates would land in the catalogue and quietly
   * skew every median and count computed from it. Cheaper to refuse them than
   * to explain the numbers later.
   */
  const seen = new Set(all.map((v) => v.id));
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
    let added = 0;
    for (const v of res.videos) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      all.push(v);
      added++;
    }
    token = res.token;
    onProgress(all.length);
    if (added === 0) break;
  }
  /*
   * Flag a catalogue that stopped at the cap rather than at the end.
   *
   * This matters most in Compare. The walk runs newest first, so a truncated
   * read is not a random sample of a channel, it is its recent half, and the
   * medians drawn from it sit higher than the channel's real ones. Setting a
   * capped 1800 beside a complete 448 and printing both as though they
   * described whole catalogues would be quietly wrong, so the panes that use
   * this say when it happened.
   */
  all.truncated = !!token && pages >= maxPages;
  return all;
}

/*
 * ---- watch history ---------------------------------------------------------
 *
 * History is the same InnerTube walk as a channel catalogue with two
 * differences, and both of them bite.
 *
 * FIRST: continuations need a signed request. Cookies alone are not enough for
 * anything account-private, so an unsigned POST comes back as the signed-out
 * page ("Keep track of what you watch"), not as an error. YouTube's own
 * JavaScript signs these with an Authorization: SAPISIDHASH header derived from
 * the SAPISID cookie, and a content script on youtube.com can compute the same
 * thing. Page one does not need it, because the browser fetched that HTML with
 * the full session attached; every page after does.
 *
 * SECOND: the watch date is not on the item. It lives in the section header
 * above a run of items, so items inherit from whichever header last preceded
 * them, including across a page boundary.
 */
const HISTORY_PATH = "/feed/history";
const HISTORY_ORIGIN = "https://www.youtube.com";

function isHistoryPage() {
  return location.pathname.replace(/\/$/, "") === HISTORY_PATH;
}

async function sapisidHash() {
  const m =
    document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/) ||
    document.cookie.match(/(?:^|;\s*)__Secure-3PAPISID=([^;]+)/);
  if (!m) return null;
  const ts = Math.floor(Date.now() / 1000);
  const bytes = new TextEncoder().encode(ts + " " + m[1] + " " + HISTORY_ORIGIN);
  const buf = await crypto.subtle.digest("SHA-1", bytes);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "SAPISIDHASH " + ts + "_" + hex;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/*
 * Section labels arrive in four shapes and one real trap.
 *
 * "Today" / "Yesterday" / a weekday name for the last week, then dates. The
 * trap is that the dates come in two orders: page one is server-rendered HTML
 * and says "7 Sept", while the continuations are InnerTube JSON and say
 * "Sep 3". Both appeared in the same walk. Bucketing by the raw label would
 * split a single day's viewing across two buckets, so everything normalises to
 * a real Date before it is used for anything.
 *
 * A bare "Sep 3" with no year means the most recent 3 September that is not in
 * the future, which is what YouTube means by it.
 */
function parseWatchDate(label, now) {
  if (!label) return null;
  now = now || new Date();
  const s = String(label).trim().toLowerCase().replace(/,/g, "");

  if (s === "today") return startOfDay(now);
  if (s === "yesterday") return addDays(startOfDay(now), -1);

  const wd = WEEKDAYS.indexOf(s);
  if (wd !== -1) {
    // Weekday names are only used inside the last week, so the most recent past
    // occurrence is unambiguous and never more than 7 days back.
    let d = startOfDay(now);
    for (let i = 0; i < 7; i++) {
      d = addDays(d, -1);
      if (d.getDay() === wd) return d;
    }
    return null;
  }

  const dayFirst = /^\d/.test(s);
  const m = dayFirst
    ? s.match(/^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?$/)
    : s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (!m) return null;

  const day = parseInt(dayFirst ? m[1] : m[2], 10);
  const mon = MONTHS[(dayFirst ? m[2] : m[1]).slice(0, 3)];
  if (mon === undefined || !day) return null;

  if (m[3]) return new Date(parseInt(m[3], 10), mon, day);
  const here = new Date(now.getFullYear(), mon, day);
  return here > startOfDay(now) ? new Date(now.getFullYear() - 1, mon, day) : here;
}

function daysSince(d, now) {
  if (!d) return null;
  return Math.max(0, Math.round((startOfDay(now || new Date()) - d) / 86400000));
}

/*
 * Walks one page of sections, carrying the current header across the call so a
 * section split over a page boundary keeps its date. `carry` is mutated on
 * purpose: the caller owns it for the whole walk.
 */
function parseHistorySections(arr, carry, now) {
  const videos = [];
  for (const it of arr || []) {
    const sec = it.itemSectionRenderer;
    if (!sec) continue;
    const head = deepFind(sec, "itemSectionHeaderRenderer");
    const t = head && head.title;
    const label = t && ((t.runs && t.runs[0] && t.runs[0].text) || t.simpleText);
    if (label) carry.label = label;

    for (const c of sec.contents || []) {
      if (!c.lockupViewModel) continue;
      const v = mapLockup(c.lockupViewModel);
      if (!v) continue;
      v.watchedLabel = carry.label || "";
      v.watchedOn = parseWatchDate(carry.label, now);
      v.watchedDays = daysSince(v.watchedOn, now);
      videos.push(v);
    }
  }
  return videos;
}

async function fetchHistoryContinuation(apiKey, clientVersion, token, auth) {
  const headers = {
    "Content-Type": "application/json",
    "X-YouTube-Client-Name": "1",
    "X-YouTube-Client-Version": clientVersion,
  };
  // Without these the server answers as though nobody is signed in, and returns
  // a perfectly valid 200 containing the logged-out promo instead of history.
  if (auth) {
    headers["Authorization"] = auth;
    headers["X-Origin"] = HISTORY_ORIGIN;
  }
  const res = await fetch(
    location.origin + "/youtubei/v1/browse?key=" + apiKey + "&prettyPrint=false",
    {
      method: "POST",
      credentials: "same-origin",
      headers: headers,
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: clientVersion } },
        continuation: token,
      }),
    }
  );
  return res.json();
}

/*
 * The whole readable history, newest first.
 *
 * Page one always works and is roughly 180 videos. Everything past that needs
 * the signature, so without it this returns page one and says so rather than
 * failing: a shorter list is still useful, a thrown error is not.
 */
async function fetchHistory(onProgress, signed) {
  const now = new Date();
  const html = await (await fetch(HISTORY_PATH, { credentials: "same-origin" })).text();
  const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  const clientVersion =
    (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] ||
    (html.match(/"clientVersion":"([^"]+)"/) || [])[1] ||
    FALLBACK_VER;

  const data = findJson(html, "ytInitialData");
  if (!data) throw new Error("Could not read your history. Try reloading the page.");

  const carry = { label: "" };
  const first = deepFind(data, "sectionListRenderer");
  const all = parseHistorySections((first && first.contents) || [], carry, now);
  if (!all.length) throw new Error("No watch history to read. It may be paused or cleared.");
  onProgress(all.length);

  const auth = signed ? await sapisidHash() : null;
  let token = auth ? findContinuationToken(data) : null;

  const seen = new Set(all.map((v) => v.id));
  let pages = 0;
  const maxPages = Math.max(1, Math.ceil(cfg.maxVideos / 180));
  while (token && pages < maxPages) {
    pages++;
    let json;
    try {
      json = await fetchHistoryContinuation(apiKey, clientVersion, token, auth);
    } catch (e) {
      break;
    }
    const items = deepFind(json, "continuationItems");
    if (!items) break;
    let added = 0;
    for (const v of parseHistorySections(items, carry, now)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      all.push(v);
      added++;
    }
    token = findContinuationToken(json);
    onProgress(all.length);
    if (added === 0) break;
  }

  all.truncated = !!token && pages >= maxPages;
  all.shallow = !auth;
  return all;
}

// Only ever the continuation's own token. A history payload is full of other
// things called `token` (share panels, notification actions), and grabbing the
// first one produced a valid-looking 200 with no videos in it.
function findContinuationToken(o) {
  if (!o || typeof o !== "object") return null;
  if (o.continuationItemRenderer) {
    const ce = o.continuationItemRenderer.continuationEndpoint;
    const t = ce && ce.continuationCommand && ce.continuationCommand.token;
    if (t) return t;
  }
  for (const k in o) {
    const r = findContinuationToken(o[k]);
    if (r) return r;
  }
  return null;
}

// The two things every InnerTube POST needs, read off any youtube.com page.
function innertubeConfig(html) {
  return {
    apiKey: (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1],
    clientVersion:
      (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] ||
      (html.match(/"clientVersion":"([^"]+)"/) || [])[1] ||
      FALLBACK_VER,
  };
}

/*
 * ---- your own playlists: Watch Later and Liked ------------------------------
 *
 * Same wall as history. Page one comes back with the HTML, which the browser
 * fetched with the session attached, and that is the first 100. Anything past
 * it is a continuation and needs the SAPISIDHASH signature, so it only happens
 * when deep reading is switched on.
 *
 * These lists still use the older playlistVideoRenderer on most accounts, with
 * the lockup shape turning up on some, so both are read.
 */
function mapPlaylistVideo(pvr) {
  if (!pvr || !pvr.videoId) return null;
  const durationText = (pvr.lengthText && pvr.lengthText.simpleText) || overlayDuration(pvr) || "";
  const seconds = parseInt(pvr.lengthSeconds, 10) || parseDuration(durationText);
  /*
   * videoInfo is "1.2M views", " • ", "3 years ago" as separate runs, or, on
   * Watch Later now, "1.2M", " • ", "3 yr ago" with the word dropped. Reading
   * only "…views" left all of Watch Later at 0 views. The runs hold nothing but
   * the count and the date, so a bare number there is the count. Failing both,
   * the title's screen-reader label spells it out in full: "2,712,345 views".
   */
  const info = ((pvr.videoInfo && pvr.videoInfo.runs) || []).map((r) => r.text || "");
  const publishedText = info.find((t) => /ago|streamed|premiered/i.test(t)) || "";
  const label = (pvr.title && pvr.title.accessibility && pvr.title.accessibility.accessibilityData &&
    pvr.title.accessibility.accessibilityData.label) || "";
  // The label opens with the title, so a title like "I got 100 views" matches
  // first; YouTube's own count is always the last one.
  const spoken = Array.from(label.matchAll(/([\d.,]+)\s+views?\b/gi)).pop();
  const viewsText = info.find((t) => /view/i.test(t)) ||
    info.find((t) => BARE_COUNT.test(t.trim())) ||
    (spoken ? spoken[1] : "");
  return {
    id: pvr.videoId,
    title: runsText(pvr.title) || "(no title)",
    channel: cleanChannel(runsText(pvr.shortBylineText)),
    handle: handleFrom(pvr.shortBylineText),
    durationText,
    seconds,
    views: parseViews(viewsText),
    publishedText,
    days: parseRelativeDays(publishedText),
    progress: overlayProgress(pvr),
    // Deleted and private videos stay in the list as unplayable stubs.
    playable: pvr.isPlayable !== false,
  };
}

function parsePlaylistItems(arr) {
  const videos = [];
  for (const it of arr || []) {
    let v = null;
    if (it.playlistVideoRenderer) v = mapPlaylistVideo(it.playlistVideoRenderer);
    else if (it.lockupViewModel) v = mapLockup(it.lockupViewModel);
    if (v) videos.push(v);
  }
  return videos;
}

async function fetchPlaylist(listId, signed) {
  const html = await (await fetch("/playlist?list=" + encodeURIComponent(listId), { credentials: "same-origin" })).text();
  const { apiKey, clientVersion } = innertubeConfig(html);
  const data = findJson(html, "ytInitialData");
  const list = data && deepFind(data, "playlistVideoListRenderer");
  // Signed out, or a list that does not exist: nothing to read, not an error.
  if (!list || !list.contents) return [];

  const all = parsePlaylistItems(list.contents);
  const auth = signed && apiKey ? await sapisidHash() : null;
  let token = auth ? findContinuationToken(list) : null;
  const seen = new Set(all.map((v) => v.id));
  let pages = 0;
  const maxPages = Math.max(1, Math.ceil(cfg.maxVideos / 100));
  while (token && pages < maxPages) {
    pages++;
    let json;
    try {
      json = await fetchHistoryContinuation(apiKey, clientVersion, token, auth);
    } catch (e) {
      break;
    }
    const items = deepFind(json, "continuationItems");
    if (!items) break;
    let added = 0;
    for (const v of parsePlaylistItems(items)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      all.push(v);
      added++;
    }
    token = findContinuationToken(items);
    if (added === 0) break;
  }
  all.truncated = !!token && pages >= maxPages;
  return all;
}

/*
 * ---- search results --------------------------------------------------------
 *
 * The filter engine cannot search YouTube, only the feed a search returns, so
 * this walks that feed and hands over what it finds. Anything the panel says
 * about it has to say "these results", never "YouTube".
 *
 * Shelves ("People also watched", Shorts rows) are skipped. They are YouTube's
 * recommendations sitting inside the results rather than results, and letting
 * them through would put things nobody searched for into a filtered list.
 *
 * ---- how it gets more than a first page's worth --------------------------------
 *
 * The first version stopped at 15 pages, on the assumption that was about 200
 * results. It is not: YouTube pads its pages with Shorts shelves, so a search
 * for "Hired" averaged nine videos a page and stopped at 138, while YouTube
 * still had a continuation to offer 25 pages later. The walk now stops on
 * results, with a page ceiling far above anything a real search reaches.
 *
 * And it can ask YouTube for the right videos rather than just more of them.
 * YouTube's own search filters narrow length into three buckets, and those are
 * strict (checked: "over 20 minutes" returned nothing shorter than 22:41). So
 * when the panel is set to over 45 minutes, the next batch comes from YouTube's
 * "over 20 minutes" results, and nearly all of it survives the panel's filter
 * instead of most of it being thrown away. Sorting by views works the same way.
 * Its upload-date sort and date filters are not used: in September 2026 they
 * returned years-old videos first, so they cannot be trusted to narrow anything.
 *
 * Each combination of YouTube filters is its own session with its own
 * continuation, so "Load more" resumes where that session stopped.
 */
const SEARCH_LIMIT = 200;   // the first read
const SEARCH_STEP = 200;    // each "Load more"
const SEARCH_MAX = 1200;    // the most one search will hold
/*
 * YouTube's three length buckets: its filter code, then the range in seconds.
 * Read off YouTube's own filter dialog (September 2026): under 3 minutes is 4,
 * 3 to 20 is 5, over 20 is 2. The older codes 1 and 3 still answer, but split
 * at 4 minutes, so a "<3m" served from them would miss nothing and waste a lot.
 */
const YT_LENGTHS = [[4, 0, 180], [5, 180, 1200], [2, 1200, Infinity]];

function isSearchPage() {
  return location.pathname === "/results";
}

// Your own lists opened on their own page, as the library scope they share
// with in:wl and in:liked. Other people's playlists are not lists of yours.
const OWN_LISTS = { WL: "wl", LL: "liked" };
function ownListScope() {
  if (location.pathname !== "/playlist") return null;
  return OWN_LISTS[new URLSearchParams(location.search).get("list")] || null;
}

function searchQuery() {
  return new URLSearchParams(location.search).get("search_query") || "";
}

/*
 * YouTube's search filter parameter ("sp" in a results URL) is a small protobuf
 * in base64. Field 1 is the order, field 2 a message of filters keyed by number.
 * The numbers were read off YouTube's own filter dialog (September 2026), where
 * every option carries the parameter it applies, so none of this is guessed.
 */
const YT_F = {
  date: 1, type: 2, length: 3, hd: 4, subtitles: 5, creativeCommons: 6, threeD: 7,
  live: 8, purchased: 9, fourK: 14, vr360: 15, location: 23, hdr: 25, vr180: 26,
};
// Upload windows: YouTube's code, the widest age it covers in days, its name.
const YT_DATES = [[2, 1, "Today"], [3, 7, "This week"], [4, 31, "This month"], [5, 366, "This year"]];
const YT_TYPES = { 1: "Videos", 9: "Shorts", 4: "Movies" };
const YT_LENGTH_LABELS = { 4: "Under 3 minutes", 5: "3 to 20 minutes", 2: "Over 20 minutes" };
const YT_FEATURES = {
  4: "HD", 5: "Subtitles", 6: "Creative Commons", 7: "3D", 8: "Live", 9: "Purchased",
  14: "4K", 15: "360°", 23: "Location", 25: "HDR", 26: "VR180",
};

function pushVarint(n, out) {
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function encodeSp(sort, filters) {
  const sub = [];
  for (const f of Object.keys(filters).map(Number).sort((a, b) => a - b)) {
    if (!filters[f]) continue;
    pushVarint(f * 8, sub);
    pushVarint(filters[f], sub);
  }
  const top = [];
  if (sort) {
    top.push(0x08);
    pushVarint(sort, top);
  }
  if (sub.length) {
    top.push(0x12);
    pushVarint(sub.length, top);
    for (const b of sub) top.push(b);
  }
  return top.length ? btoa(String.fromCharCode.apply(null, top)) : "";
}

/*
 * The reverse, for a results page whose filters were picked in YouTube's own
 * dialog. Unknown fields are skipped and a malformed value decodes to nothing:
 * this reads a URL anybody can type, so it must never be able to throw.
 */
function decodeSp(sp) {
  const out = { sort: 0, filters: {} };
  if (!sp) return out;
  let bytes;
  try {
    bytes = Array.from(atob(sp), (c) => c.charCodeAt(0));
  } catch (e) {
    return out;
  }
  const read = (arr, i) => {
    let n = 0, mul = 1, b;
    do {
      b = arr[i++];
      if (b === undefined) throw new Error("truncated");
      n += (b & 127) * mul;
      mul *= 128;
    } while (b & 128);
    return [n, i];
  };
  try {
    for (let i = 0; i < bytes.length;) {
      let tag, v, len;
      [tag, i] = read(bytes, i);
      const field = Math.floor(tag / 8), wire = tag & 7;
      if (wire === 0) {
        [v, i] = read(bytes, i);
        if (field === 1) out.sort = v;
      } else if (wire === 2) {
        [len, i] = read(bytes, i);
        const sub = bytes.slice(i, i + len);
        i += len;
        if (field !== 2) continue;
        for (let j = 0; j < sub.length;) {
          let t, sv;
          [t, j] = read(sub, j);
          if ((t & 7) !== 0) break;
          [sv, j] = read(sub, j);
          out.filters[Math.floor(t / 8)] = sv;
        }
      } else {
        break;
      }
    }
  } catch (e) { /* keep whatever decoded before the damage */ }
  return out;
}

// The filters the page was opened with, from YouTube's dialog or from a query
// typed into the search bar and sent on with its filters attached.
function pageSp() {
  return decodeSp(new URLSearchParams(location.search).get("sp") || "");
}

/*
 * Which YouTube requests would serve what is being asked for. `base` is what
 * the page itself is filtered by; the panel's filters add to it or, where they
 * cover the same thing, replace it:
 *
 *   - a length range becomes every YouTube length bucket it overlaps, one
 *     session each, since a request carries only one. All three is none.
 *   - an upload window becomes the smallest of YouTube's that contains it.
 *   - "Most views" becomes YouTube's own view-count order ("Popularity").
 *
 * Videos only, unless the page asked for Shorts or Movies: it drops channels
 * and playlists, which the panel skips anyway, and gives twenty a page, not
 * sixteen.
 */
function searchPlan(base, opts) {
  base = base || { sort: 0, filters: {} };
  opts = opts || {};
  const filters = Object.assign({}, base.filters);
  if ([1, 9, 4].indexOf(filters[YT_F.type]) === -1) filters[YT_F.type] = 1;
  let lengths = [filters[YT_F.length] || 0];
  delete filters[YT_F.length];
  const minDur = opts.minDur || 0;
  const maxDur = opts.maxDur == null ? Infinity : opts.maxDur;
  if (minDur || maxDur !== Infinity) {
    const hit = YT_LENGTHS.filter(([, lo, hi]) => lo < maxDur && hi > minDur).map(([c]) => c);
    lengths = !hit.length || hit.length === YT_LENGTHS.length ? [0] : hit;
  }
  if (opts.maxAge != null && opts.maxAge !== Infinity) {
    const d = YT_DATES.find(([, days]) => opts.maxAge <= days);
    if (d) filters[YT_F.date] = d[0];
  }
  for (const f of opts.features || []) filters[f] = 1;
  if (opts.type) filters[YT_F.type] = opts.type;
  let sort = base.sort || 0;
  if (opts.sort === "views_desc") sort = 3;
  return { sort, filters, lengths };
}

function searchSp(length, plan) {
  const f = Object.assign({}, plan.filters);
  if (length) f[YT_F.length] = length;
  return encodeSp(plan.sort, f);
}

// YouTube's filters on this page, in the words its own dialog uses.
function spLabels(dec) {
  const out = [];
  const f = dec.filters;
  if (f[YT_F.type] && YT_TYPES[f[YT_F.type]] && f[YT_F.type] !== 1) out.push(YT_TYPES[f[YT_F.type]]);
  if (f[YT_F.length] && YT_LENGTH_LABELS[f[YT_F.length]]) out.push(YT_LENGTH_LABELS[f[YT_F.length]]);
  const d = YT_DATES.find(([c]) => c === f[YT_F.date]);
  if (d) out.push(d[2]);
  for (const k in YT_FEATURES) if (f[k]) out.push(YT_FEATURES[k]);
  if (dec.sort === 3) out.push("Popularity");
  return out;
}

// One InnerTube search call: a fresh query with filters, or a continuation.
async function searchPost(ctx, body) {
  const headers = {
    "Content-Type": "application/json",
    "X-YouTube-Client-Name": "1",
    "X-YouTube-Client-Version": ctx.clientVersion,
  };
  if (ctx.auth) {
    headers["Authorization"] = ctx.auth;
    headers["X-Origin"] = HISTORY_ORIGIN;
  }
  const res = await fetch(location.origin + "/youtubei/v1/search?key=" + ctx.apiKey + "&prettyPrint=false", {
    method: "POST",
    credentials: "same-origin",
    headers: headers,
    body: JSON.stringify(Object.assign({ context: { client: { clientName: "WEB", clientVersion: ctx.clientVersion } } }, body)),
  });
  return res.json();
}

function parseSearchItems(arr) {
  const videos = [];
  let token = null;
  for (const it of arr || []) {
    if (it.itemSectionRenderer) {
      for (const c of it.itemSectionRenderer.contents || []) {
        if (c.videoRenderer && c.videoRenderer.videoId) videos.push(mapVideo(c.videoRenderer));
        else if (c.lockupViewModel) {
          const v = mapLockup(c.lockupViewModel);
          if (v) videos.push(v);
        }
      }
    } else if (it.continuationItemRenderer) {
      const ce = it.continuationItemRenderer.continuationEndpoint;
      token = (ce && ce.continuationCommand && ce.continuationCommand.token) || token;
    }
  }
  return { videos, token };
}

/*
 * Pulls up to `want` new videos into `all`, split across the plan's sessions.
 *
 * Watch progress: the very first page arrives as HTML the browser fetched with
 * your session, so it carries your progress. Everything after is an API call,
 * which is anonymous unless deep reading signs it, so "unwatched" can only be
 * trusted on what came from that first page. ctx.partial records that, and the
 * panel says so instead of letting the filter look complete.
 */
async function searchMore(ctx, plan, want, all, onProgress) {
  const sps = plan.lengths.map((l) => searchSp(l, plan));
  const share = Math.ceil(want / sps.length);
  for (const sp of sps) {
    const s = ctx.sessions[sp] || (ctx.sessions[sp] = { token: null, started: false, done: false });
    let got = 0, empty = 0, pages = 0;
    while (!s.done && got < share && all.length < SEARCH_MAX && pages < 60) {
      pages++;
      let items = null;
      try {
        if (!s.started) {
          s.started = true;
          if (!ctx.apiKey) {
            const url = "/results?search_query=" + encodeURIComponent(ctx.query) + "&sp=" + encodeURIComponent(sp);
            const html = await (await fetch(url, { credentials: "same-origin" })).text();
            Object.assign(ctx, innertubeConfig(html));
            const data = findJson(html, "ytInitialData");
            const list = data && deepFind(data, "sectionListRenderer");
            if (!ctx.apiKey || !list) throw new Error("Could not read these results. Try reloading the page.");
            items = list.contents;
          } else {
            const json = await searchPost(ctx, { query: ctx.query, params: sp });
            const list = deepFind(json, "sectionListRenderer");
            items = list && list.contents;
            if (!ctx.auth) ctx.partial = true;
          }
        } else {
          const json = await searchPost(ctx, { continuation: s.token });
          items = deepFind(json, "continuationItems");
          if (!ctx.auth) ctx.partial = true;
        }
      } catch (e) {
        if (!all.length) throw e;
        s.done = true;
        break;
      }
      if (!items) { s.done = true; break; }
      const res = parseSearchItems(items);
      let added = 0;
      for (const v of res.videos) {
        if (ctx.seen.has(v.id)) continue;
        ctx.seen.add(v.id);
        all.push(v);
        added++;
      }
      got += added;
      s.token = res.token;
      if (!s.token) s.done = true;
      onProgress(all.length);
      // A few pages in a row of nothing but shelves and repeats means this
      // session has run dry, whatever its continuation token claims.
      empty = added ? 0 : empty + 1;
      if (empty >= 3) s.done = true;
    }
  }
  return all;
}

// Whether another "Load more" with this plan could find anything.
function searchCanGrow(ctx, plan, have) {
  if (!ctx || have >= SEARCH_MAX) return false;
  return plan.lengths.some((l) => {
    const s = ctx.sessions[searchSp(l, plan)];
    return !s || !s.done;
  });
}

/*
 * The first read of a search. Signed only when deep reading is on, for the same
 * reason as everywhere else. The context rides along on the array so the panel
 * can ask for more from the same sessions later.
 */
async function fetchSearch(query, onProgress, signed, plan) {
  if (!query.trim()) throw new Error("Nothing was searched for.");
  const ctx = {
    query, apiKey: "", clientVersion: FALLBACK_VER, sessions: {}, seen: new Set(), partial: false,
    auth: signed ? await sapisidHash() : null,
  };
  const all = [];
  await searchMore(ctx, plan || searchPlan(pageSp()), SEARCH_LIMIT, all, onProgress);
  all.search = ctx;
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
