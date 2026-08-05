/*
 * Reading a channel from a server, with no session and no browser.
 *
 * Same approach as the extension, different constraints. The extension rides
 * the user's own session same-origin, so it also sees watch progress. Here
 * there is no session, which is fine: monitoring only needs public numbers.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FALLBACK_VER = "2.20240710.01.00";

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
      else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
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
    const j = sliceBalancedJson(html, brace);
    if (j) { try { return JSON.parse(j); } catch (e) { /* keep looking */ } }
    from = i + marker.length;
  }
}

function deepFind(obj, key) {
  if (obj == null || typeof obj !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const k in obj) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const f = deepFind(v, key);
      if (f != null) return f;
    }
  }
  return null;
}

function parseDuration(t) {
  if (!t) return 0;
  return String(t).split(":").reduce((s, p) => s * 60 + (parseInt(p, 10) || 0), 0);
}

function parseViews(t) {
  if (!t) return 0;
  t = String(t).toLowerCase();
  if (t.includes("no views")) return 0;
  const m = t.match(/([\d.,]+)\s*([kmb]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return 0;
  n *= { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return Math.round(n);
}

function parseRelativeDays(t) {
  if (!t) return null;
  const m = String(t).match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!m) return null;
  const map = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
  return parseInt(m[1], 10) * map[m[2].toLowerCase()];
}

function lockupDuration(lvm) {
  const tvm = lvm.contentImage && lvm.contentImage.thumbnailViewModel;
  for (const o of (tvm && tvm.overlays) || []) {
    const badges =
      (o.thumbnailBottomOverlayViewModel && o.thumbnailBottomOverlayViewModel.badges) ||
      (o.thumbnailOverlayBadgeViewModel && o.thumbnailOverlayBadgeViewModel.thumbnailBadges) || [];
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
  let viewsText = "", publishedText = "";
  for (const row of (cmv && cmv.metadataRows) || []) {
    for (const part of row.metadataParts || []) {
      const c = part.text && part.text.content;
      if (!c) continue;
      if (/view/i.test(c)) viewsText = c;
      else if (/ago|streamed|premiered/i.test(c)) publishedText = c;
    }
  }
  return { viewsText, publishedText };
}

function parseItems(arr) {
  const videos = [];
  let token = null;
  for (const it of arr || []) {
    const content = it.richItemRenderer && it.richItemRenderer.content;
    if (content && content.lockupViewModel) {
      const l = content.lockupViewModel;
      if (l.contentType && l.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") continue;
      if (!l.contentId) continue;
      const lmv = l.metadata && l.metadata.lockupMetadataViewModel;
      const { viewsText, publishedText } = lockupMeta(l);
      videos.push({
        id: l.contentId,
        title: (lmv && lmv.title && lmv.title.content) || "",
        seconds: parseDuration(lockupDuration(l)),
        views: parseViews(viewsText),
        publishedText,
        days: parseRelativeDays(publishedText),
      });
    } else if (it.continuationItemRenderer) {
      const ce = it.continuationItemRenderer.continuationEndpoint;
      token = (ce && ce.continuationCommand && ce.continuationCommand.token) || null;
    }
  }
  return { videos, token };
}

/*
 * Monitoring only cares about recent uploads, so this stops after a couple of
 * pages by default rather than walking a decade of back catalogue every hour.
 */
async function readChannel(handle, opts) {
  opts = opts || {};
  const maxPages = opts.maxPages == null ? 2 : opts.maxPages;
  const url = "https://www.youtube.com/" + handle.replace(/^\/?/, "") + "/videos";

  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(handle + ": HTTP " + res.status);
  const html = await res.text();

  if (/consent\.youtube\.com/i.test(html)) throw new Error(handle + ": hit a consent wall");

  const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  const ver = (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] || FALLBACK_VER;
  if (!apiKey) throw new Error(handle + ": no API key in page");

  const data = findJson(html, "ytInitialData");
  if (!data) throw new Error(handle + ": no ytInitialData");
  const grid = deepFind(data, "richGridRenderer");
  if (!grid || !grid.contents) throw new Error(handle + ": no video grid");

  let { videos, token } = parseItems(grid.contents);
  const all = videos.slice();

  let pages = 0;
  while (token && pages < maxPages) {
    pages++;
    const r = await fetch("https://www.youtube.com/youtubei/v1/browse?key=" + apiKey + "&prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": ver,
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: ver } },
        continuation: token,
      }),
    });
    if (!r.ok) break;
    const items = deepFind(await r.json(), "continuationItems");
    if (!items) break;
    const next = parseItems(items);
    all.push(...next.videos);
    token = next.token;
    if (!next.videos.length) break;
  }

  return all;
}

module.exports = { readChannel, parseViews, parseDuration, parseRelativeDays };
