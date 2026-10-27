/*
 * What the daily check and the fixture tests share: Needle's own src/core.js,
 * loaded outside the browser, and the ways of looking at what YouTube sent.
 *
 * core.js is a content script and expects a youtube.com page around it. loadCore
 * gives it the least of one its readers need: relative URLs go to youtube.com,
 * signed out, as a first-time visitor's would. Every page it fetches is kept, so
 * the check can see the raw reply, not only what Needle made of it.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ORIGIN = "https://www.youtube.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

function loadCore() {
  const captured = [];
  const page = {
    fetch: async (url, opts = {}) => {
      const r = await fetch(/^https?:/.test(url) ? url : ORIGIN + url, {
        method: opts.method || "GET",
        headers: Object.assign({ "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, opts.headers || {}),
        body: opts.body,
      });
      // Pages, not the API calls that page through them: the first reply is the one with the shape.
      if ((opts.method || "GET") !== "GET") return r;
      const text = await r.text();
      captured.push({ url, text });
      return new Response(text, { status: r.status, headers: r.headers });
    },
    location: { origin: ORIGIN, pathname: "/", search: "", href: ORIGIN + "/" },
    document: {
      cookie: "",
      documentElement: { getAttribute: () => null },
      createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    navigator: { userAgent: UA, language: "en-US" },
    chrome: {
      storage: {
        onChanged: { addListener() {} },
        sync: { get: (d, cb) => cb(d) },
        local: { get: (d, cb) => cb(d), set() {} },
      },
      runtime: {},
    },
    console, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, Response, btoa, atob,
    crypto: globalThis.crypto,
  };
  page.window = page.self = page;
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src", "core.js"), "utf8"), page, { filename: "src/core.js" });
  // Enough to prove paging works without reading whole catalogues every morning.
  vm.runInContext("cfg.maxVideos = 300;", page);
  page.captured = captured;
  return page;
}

// Every part name YouTube's reply is built from ("lockupViewModel", "richGridRenderer"...)
// with how many times it appears. Unbounded walk: a page is large, but this runs once a day.
function shapeNames(data) {
  const counts = {};
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    for (const k in o) {
      if (/(Renderer|ViewModel)$/.test(k)) counts[k] = (counts[k] || 0) + 1;
      walk(o[k]);
    }
  })(data);
  return counts;
}

// Everything under `o` that has `key`, depth first.
function findAll(o, key, out = []) {
  if (!o || typeof o !== "object") return out;
  if (Object.prototype.hasOwnProperty.call(o, key)) out.push(o[key]);
  for (const k in o) findAll(o[k], key, out);
  return out;
}

// Every distinct video id anywhere under `o`.
function idsUnder(o, acc = new Set()) {
  if (!o || typeof o !== "object") return acc;
  for (const k in o) {
    const v = o[k];
    if ((k === "videoId" || k === "contentId") && typeof v === "string" && /^[\w-]{11}$/.test(v)) acc.add(v);
    else if (v && typeof v === "object") idsUnder(v, acc);
  }
  return acc;
}

/*
 * The cards in any part of a reply, found by what a card is rather than by what
 * YouTube calls it: the outermost piece that belongs to exactly one video. A
 * list holds many videos, so it is opened up; a card holds one, so it is taken
 * whole. Renaming the wrappers, or adding another layer of them, changes
 * nothing here, which is the point.
 */
function cardsIn(root) {
  const out = [];
  (function visit(o, key) {
    if (!o || typeof o !== "object") return;
    const ids = idsUnder(o);
    if (!ids.size) return;
    if (ids.size === 1 && !Array.isArray(o)) {
      // What YouTube calls this kind of card: the one part it is wrapped in, or
      // failing that the name it sits under.
      const own = Object.keys(o);
      const kind = own.length === 1 && /(Renderer|ViewModel)$/.test(own[0]) ? own[0] : key;
      out.push({ node: o, id: [...ids][0], kind });
      return;
    }
    for (const k in o) visit(o[k], Array.isArray(o) ? key : k);
  })(root, "");
  return out;
}

/*
 * How many cards of each kind a page was built from: "lockupViewModel 30". This
 * is the level YouTube's real redesigns happen at (videoRenderer became
 * lockupViewModel, and a reader built on the old one found nothing), and it
 * stays still from day to day, unlike menus and one-off shelves.
 */
function cardKinds(data) {
  const counts = {};
  for (const c of cardsIn(data)) counts[c.kind] = (counts[c.kind] || 0) + 1;
  return counts;
}

// Who made a card: its /@handle link, or the UC... id of the channel it points to.
function cardChannel(node) {
  const urls = findAll(node, "canonicalBaseUrl").concat(findAll(node, "url")).filter((u) => typeof u === "string");
  const handle = (urls.map((u) => (u.match(/^\/@([^/?]+)/) || [])[1]).find(Boolean)) || "";
  const channelId = findAll(node, "browseId").find((b) => typeof b === "string" && /^UC[\w-]{22}$/.test(b)) || "";
  return { handle: handle.toLowerCase(), channelId };
}

/*
 * The cards on a watch page's sidebar, read by src/cards.js itself: the same
 * file Mute runs in the page. So the check that it still finds whose video each
 * card is, run every morning against live YouTube, is a check of the shipped code.
 */
const { needleCards } = require("../src/cards.js");
function sidebarCards(core, data) {
  const side = core.deepFind(data, "secondaryResults");
  return side ? needleCards(side).map((c) => ({ id: c.id, title: c.title, channelId: c.channelIds[0] || "", handle: c.handles[0] || "" })) : [];
}

// Search results as Mute sees them, also through src/cards.js.
function muteSearchCards(data) {
  return data ? needleCards(data).map((c) => ({ id: c.id, title: c.title, channelId: c.channelIds[0] || "", handle: c.handles[0] || "" })) : [];
}

// The Shorts on a channel's Shorts tab, as Needle maps them.
function channelShorts(core, data) {
  return findAll(data, "shortsLockupViewModel").map((s) => core.mapShortsLockup(s)).filter((v) => v && v.id);
}

module.exports = { ROOT, ORIGIN, UA, loadCore, shapeNames, cardKinds, findAll, idsUnder, cardsIn, cardChannel, sidebarCards, muteSearchCards, channelShorts };
