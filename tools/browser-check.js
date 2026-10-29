/*
 * node tools/browser-check.js [--notify] [--public] [--signin] [--only=word] [--edits]
 *
 * The other half of the daily check. tools/canary.js reads YouTube's data the
 * way Needle does; this opens YouTube in a real Chrome and checks what only
 * exists on a live page:
 *
 *   - the elements Needle attaches to (the search box, feed cards, result
 *     thumbnails, filter chips), on every kind of page it works on;
 *   - Mute hiding the right cards and nothing else, and staying fast on a long
 *     scroll;
 *   - "Mute channel everywhere" in the ⋮ menu: there, clickable, muting, and
 *     the menu closing after;
 *   - Shorts named through YouTube's oEmbed, so a muted channel's Shorts go too;
 *   - Undo after a mute, muted words, a filter typed into YouTube's own bar,
 *     Copy a link through the share page and back, the / key, the popup, and
 *     every bit of Needle's text readable in light and dark;
 *   - signed in: Watch Later, Liked videos, history and subscriptions read the
 *     way the panel and the search bar read them, deep reading included, the
 *     search bar's dropdown of your own videos, the panel on your history and
 *     Watch Later, Mute from Home, and Home's feed cards.
 *
 * Also the rest of the panel (Free time, Copy links, Play, Insights with Compare
 * and Watchlist), Follow and is:fresh, the muted list's import and export, and
 * signed in: the Subscriptions panel, in:playlists, finished videos hidden.
 *
 * Nothing that changes the account runs unless asked: --edits removes a video
 * from Watch Later and unlikes one, and puts each back (Undo, the archive),
 * checking YouTube's own copy of the list both times, and looks for deleted
 * videos without removing them. The daily check never passes it.
 *
 * Chrome will not load an unpacked extension under automation, so Needle's own
 * source files are put into the page instead, in the order the extension loads
 * them. What is checked is the shipped code, not a copy.
 *
 * The signed-in checks use a Chrome profile of their own, outside the repo, in
 * %LOCALAPPDATA%\NeedleCheck. Sign in to YouTube in it once:
 *     node tools/browser-check.js --signin
 * Until then those checks are skipped and the log says so. Nothing in that
 * profile leaves this computer.
 *
 * Appends to tools/canary-log.txt like the data check. Exit 1 if anything
 * failed; with --notify a failure pops a Windows notification.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const puppeteer = require("./node_modules/puppeteer-core");
const { notify } = require("./canary");

const ROOT = path.join(__dirname, "..");
const LOG = path.join(__dirname, "canary-log.txt");
const CHROME = process.env.NEEDLE_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PROFILE = path.join(process.env.LOCALAPPDATA || os.homedir(), "NeedleCheck", "profile");
const YT = "https://www.youtube.com";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").split("\r\n").join("\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The selectors Needle attaches with, read from its source so this follows the code.
function selectorFrom(file, name) {
  const m = read(file).match(new RegExp("const " + name + " = \"([^\"]+)\""));
  if (!m) throw new Error(name + " not found in " + file);
  return m[1];
}
const SEARCH_INPUT = "yt-searchbox input[name='search_query']";
const SEARCH_BUTTON = "yt-searchbox button.ytSearchboxComponentSearchButton";
const SEL = {
  badge: selectorFrom("src/omnibar.js", "BADGE_SELECTOR"),
  feed: selectorFrom("src/omnibar.js", "FEED_CARD"),
  screen: selectorFrom("src/panel.js", "SCREEN_CARDS"),
  chips: selectorFrom("src/panel.js", "YT_FILTER_CONTROLS"),
};

// Mute as the extension runs it: cards.js and feedmap.js at document start in
// the page, then memory.js's mute half and mute.js, with the few things they
// borrow from the rest of the extension stood in for.
const MEM = read("src/memory.js");
const MUTE_CODE = `
  var omni = { showMuted: false }; var state = { active: false }; function applyView() {}
  function scheduleBadges() { clearTimeout(window.__needleT); window.__needleT = setTimeout(() => { const t = performance.now(); muteScan(); (window.__needlePasses = window.__needlePasses || []).push(performance.now() - t); }, 200); }
  function omniIcon() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); return s; }
  function toast(msg, action, onAction) { window.__needleToast = msg; window.__needleUndo = onAction || null; } function renderMuteNote() {}
  var chrome = { storage: { local: { set() {}, get() {} }, sync: { get() {} }, onChanged: { addListener() {} } } };
  // As omnibar.js's watchForCards: a pass whenever YouTube adds cards.
  new MutationObserver(() => scheduleBadges()).observe(document.querySelector("ytd-page-manager") || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
` + MEM.slice(MEM.indexOf("const muted = {"), MEM.indexOf("// ---- followed searches")) + "\n" + read("src/mute.js") + "\nmuteScan(); 1;";
const AT_START = read("src/cards.js") + "\n" + read("src/feedmap.js");
/*
 * The whole extension, for checks on the panel itself: every content script the
 * manifest loads at document_idle, in its order, in one scope of their own with
 * chrome.* stood in for. Content scripts are exempt from the page's CSP (YouTube
 * enforces Trusted Types); code put into the page is not, so those pages are
 * opened with CSP bypassed, which is the exemption the real extension has.
 */
const MANIFEST = JSON.parse(read("manifest.json"));
const FULL = "(function () {\n" + `
  const __store = { sync: __SYNC__, local: __LOCAL__ }, __listeners = [];
  const __area = (name) => ({
    get(d, cb) { const out = {}; const keys = d === null ? Object.keys(__store[name]) : typeof d === "string" ? [d] : Array.isArray(d) ? d : Object.keys(d || {});
      for (const k of keys) out[k] = k in __store[name] ? __store[name][k] : (d && typeof d === "object" && !Array.isArray(d) ? d[k] : undefined);
      setTimeout(() => cb && cb(out), 0); },
    set(o, cb) { for (const k in o) __store[name][k] = o[k]; setTimeout(() => cb && cb(), 0); },
    remove(k, cb) { delete __store[name][k]; setTimeout(() => cb && cb(), 0); },
  });
  const chrome = { runtime: { id: "check", lastError: null, getManifest: () => ({ version: ${JSON.stringify(MANIFEST.version)} }),
      sendMessage() {}, onMessage: { addListener() {} } },
    storage: { sync: __area("sync"), local: __area("local"), onChanged: { addListener: (fn) => __listeners.push(fn) } } };
` + MANIFEST.content_scripts.find((c) => c.run_at === "document_idle" && !c.world).js.map((f) => read(f)).join("\n") +
  // for the checks only: the lists the search bar reads, so one can type a word that is in them
  "\nwindow.__needleCheck = { library: typeof library !== 'undefined' ? library : null, pageVideoChannel: typeof pageVideoChannel === 'function' ? pageVideoChannel : null, store: __store };\n})();\n" + read("src/navigate.js") + "\n1;";
// The whole extension with the popup's settings as given (unset ones take their defaults), and what it has kept
// in local storage from earlier visits.
const fullWith = (sync, local) => FULL.replace("__SYNC__", JSON.stringify(sync || {})).replace("__LOCAL__", JSON.stringify(local || {}));

// core.js in a scope of its own, so none of its names meet YouTube's.
const CORE = `window.__needleCore = (function () { ${read("src/core.js")}
  ; cfg.maxVideos = 400; return { cfg, fetchPlaylist, fetchHistory, fetchSubscriptions }; })(); 1;`;

// ---- a page ------------------------------------------------------------------------------
// `withNeedle`: false (YouTube alone), true (Mute's code), "full" (the whole extension), or { sync, local } (the
// whole extension with those popup settings and that much kept from earlier visits).
async function open(browser, url, withNeedle) {
  const full = withNeedle === "full" || (withNeedle && typeof withNeedle === "object");
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  await p.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  if (full) await p.setBypassCSP(true);
  if (withNeedle) await p.evaluateOnNewDocument((full ? read("src/arrive.js") + "\n" : "") + AT_START);
  await p.goto(YT + url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2500);
  if (withNeedle) {
    await p.addStyleTag({ content: read("styles.css") });
    await p.evaluate(full ? fullWith(withNeedle.sync, withNeedle.local) : MUTE_CODE);
    await sleep(1200);
  }
  return p;
}

async function counts(p, sels) {
  return p.evaluate((sels) => {
    const out = {};
    for (const [k, s] of Object.entries(sels)) out[k] = document.querySelectorAll(s).length;
    return out;
  }, sels);
}

// Problems with what a page has of each selector, given the least each needs.
function needAtLeast(got, min) {
  return Object.entries(min).filter(([k, n]) => got[k] < n).map(([k, n]) => `${k} ${got[k]} (need ${n})`);
}

// The ⋮ button on the first card in view of a kind ("video" or "short"); null if none.
async function menuButton(p, kind) {
  return p.evaluate((kind) => {
    for (const x of document.querySelectorAll("[data-needle-card]")) x.removeAttribute("data-needle-card");
    for (const a of document.querySelectorAll(MUTE_VIDEO_LINK)) {
      const r0 = a.getBoundingClientRect(), short = a.getAttribute("href").startsWith("/shorts/");
      if (r0.top < 90 || r0.bottom > 800 || r0.width < 40 || (kind === "short") !== short || a.closest(MUTE_NEVER) || a.closest("[data-ytcs-muted]")) continue;
      const id = muteLinkId(a), card = muteCard(a, id);
      const b = [...card.querySelectorAll("button, [role=button]")].find((x) => !x.closest("a") && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().top < 860 && /action|more|menu/i.test(x.getAttribute("aria-label") || ""));
      if (!b) continue;
      card.setAttribute("data-needle-card", id);
      const r = b.getBoundingClientRect();
      return { id, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  }, kind);
}

async function menuItem(p, waitMs) {
  for (let t = 0; t < waitMs; t += 150) {
    await sleep(150);
    const it = await p.evaluate(() => {
      const el = document.querySelector(".ytcs-ytrow");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: el.textContent, onTop: el.contains(at), x: r.x + r.width / 2, y: r.y + r.height / 2, owner: el.__needle && el.__needle.owner };
    });
    if (it) return it;
  }
  return null;
}

const menuOpen = (p) => p.evaluate(() => [...document.querySelectorAll("[role=menu]")].some((m) => m.getBoundingClientRect().height > 0));

// Opens a card's ⋮, checks Needle's item, clicks it; returns problems.
async function muteThroughMenu(p, kind, expect) {
  let btn = await menuButton(p, kind);
  // YouTube puts the Shorts shelf anywhere in the results: bring the first one into view and look again.
  if (!btn && kind === "short") {
    await p.evaluate(() => { const a = document.querySelector("a[href^='/shorts/']"); if (a) window.scrollTo(0, a.getBoundingClientRect().top + window.scrollY - 250); });
    await sleep(1500);
    btn = await menuButton(p, kind);
  }
  if (!btn) return ["no " + kind + " with a ⋮ menu in view"];
  await p.mouse.click(btn.x, btn.y);
  const it = await menuItem(p, 10000);
  if (!it) {
    const opened = await menuOpen(p);
    await p.keyboard.press("Escape");
    return [opened ? "the menu opened without Needle's item" : "no menu opened"];
  }
  const problems = [];
  if (!it.text.includes(expect)) problems.push(`item says "${it.text}"`);
  if (!it.onTop) problems.push("item is covered: a click would miss it");
  if (!it.owner || !(it.owner.channelId || it.owner.handle)) problems.push("item does not know the channel");
  await p.mouse.click(it.x, it.y);
  await sleep(900);
  const after = await p.evaluate((id) => ({ n: muted.list.length, toast: window.__needleToast || "", hidden: !!document.querySelector("[data-needle-card='" + id + "'][data-ytcs-muted]") }), btn.id);
  if (expect.startsWith("Mute")) {
    if (!after.n) problems.push("clicking it muted nothing");
    if (!after.hidden) problems.push("the card stayed");
  }
  if (!after.toast) problems.push("no toast");
  if (await menuOpen(p)) problems.push("the menu stayed open");
  return problems;
}

// Presses the panel's button and waits for at least `min` videos; false if it never opened.
async function openPanel(p, min, ms = 30000) {
  const l = await p.evaluate(() => { const x = document.querySelector(".ytcs-launcher"); if (!x) return null; const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (!l) return false;
  await p.mouse.click(l.x, l.y);
  for (let t = 0; t < ms; t += 1000) {
    await sleep(1000);
    if (await p.evaluate((min) => (document.querySelector(".ytcs-grid") || { children: [] }).children.length >= min, min)) return true;
  }
  return false;
}
const panelCount = (p) => p.evaluate(() => { const m = ((document.querySelector(".ytcs-wrap") || {}).innerText || "").match(/(\d[\d,]*) of (\d[\d,]*)/); return m ? { shown: +m[1].replace(/,/g, ""), of: +m[2].replace(/,/g, "") } : null; });
// The lengths of the cards the panel is showing, in seconds.
const shownSeconds = (p) => p.evaluate(() => [...document.querySelectorAll(".ytcs-grid .ytcs-dur")].map((d) => d.textContent.trim().split(":").reduce((a, x) => a * 60 + (+x || 0), 0)));
// Opens one of the panel's filter menus ("+ Length", "+ Free time"...) and picks the option with that text.
async function pickInMenu(p, slot, option) {
  const opened = await p.evaluate((slot) => { const b = [...document.querySelectorAll(".ytcs-wrap button")].find((x) => x.textContent.includes(slot) && x.getBoundingClientRect().width > 0); if (!b) return false; b.click(); return true; }, slot);
  if (!opened) return `no ${slot} menu`;
  await sleep(500);
  const o = await p.evaluate((option) => { const el = [...document.querySelectorAll(".ytcs-menu [role=option]")].find((x) => x.textContent.trim() === option && x.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, option);
  if (!o) return `no "${option}" in the ${slot} menu`;
  await p.mouse.click(o.x, o.y);
  await sleep(1200);
  return "";
}
// What the panel's Export menu copies with that option, caught on its way to the clipboard.
async function exportCopy(p, option) {
  await p.evaluate(() => { window.__copied = ""; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
  await p.evaluate(() => { const x = [...document.querySelectorAll(".ytcs-wrap button")].find((e) => /^Export/.test(e.textContent.trim())); if (x) x.click(); });
  await sleep(500);
  await p.evaluate((option) => { const o = [...document.querySelectorAll(".ytcs-menu [role=option]")].find((e) => e.textContent.includes(option)); if (o) o.click(); }, option);
  await sleep(1000);
  return p.evaluate(() => window.__copied || "");
}
// The ids in one of your own lists ("WL", "LL"), first page, as YouTube has them right now.
async function listIds(b, key) {
  const p = await open(b, "/feed/library");
  await p.evaluate(CORE);
  const ids = await p.evaluate(async (k) => (await window.__needleCore.fetchPlaylist(k, false)).map((v) => v.id), key);
  await p.close();
  return ids;
}

/*
 * The worst text contrast inside Needle's own UI on the page, by WCAG's formula: every visible element with text
 * of its own, against the first background behind it that is actually painted. 4.5 is the AA line for body text;
 * under 3 is unreadable.
 */
const CONTRAST = (roots) => {
  const rgb = (c) => (c.match(/[\d.]+/g) || [0, 0, 0, 0]).map(Number);
  const lum = (c) => { const [r, g, b] = rgb(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const opaque = (c) => { const a = rgb(c); return a.length < 4 || a[3] > 0.5; };
  const page = document.documentElement.hasAttribute("dark") ? "rgb(15, 15, 15)" : "rgb(255, 255, 255)";
  const bgOf = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "transparent" && opaque(c)) return c; } return page; };
  const out = [];
  for (const root of document.querySelectorAll(roots)) {
    for (const el of root.querySelectorAll("*")) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || cs.visibility === "hidden" || +cs.opacity < 0.4) continue;
      const a = lum(cs.color), b = lum(bgOf(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      out.push({ ratio: Math.round(ratio * 10) / 10, what: (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : el.tagName.toLowerCase()) + " \"" + el.textContent.trim().slice(0, 24) + "\"" });
    }
  }
  out.sort((x, y) => x.ratio - y.ratio);
  return { n: out.length, worst: out.slice(0, 3) };
};

// The popup's view of Chrome: its two storage areas (with What's new set, as after an update) and the active tab,
// a channel unless given; `reply` is what the page answers when asked. Where it sends the tab lands in __popupNav.
const popupStub = (url = "https://www.youtube.com/@veritasium/videos", reply = null) => `(() => {
  const store = { sync: {}, local: { whatsNew: "2.3.0" } };
  const area = (n) => ({
    get(d, cb) { const out = {}; const keys = d === null ? Object.keys(store[n]) : typeof d === "string" ? [d] : Array.isArray(d) ? d : Object.keys(d || {});
      for (const k of keys) out[k] = k in store[n] ? store[n][k] : (d && typeof d === "object" && !Array.isArray(d) ? d[k] : undefined);
      setTimeout(() => cb && cb(out), 0); },
    set(o, cb) { Object.assign(store[n], o); setTimeout(() => cb && cb(), 0); },
    remove(k, cb) { delete store[n][k]; setTimeout(() => cb && cb(), 0); },
  });
  window.__popupStore = store;
  window.__popupNav = {};
  window.chrome = { runtime: { lastError: null, getManifest: () => ({ version: "2.3.0" }), sendMessage() {}, onMessage: { addListener() {} } },
    storage: { sync: area("sync"), local: area("local"), onChanged: { addListener() {} } },
    tabs: { query: (q, cb) => cb([{ id: 1, url: ${JSON.stringify(url)}, active: true }]), sendMessage: (id, m, cb) => setTimeout(() => cb && cb(${JSON.stringify(reply)}), 0),
      update: (id, o) => { window.__popupNav.update = o.url; }, create: (o) => { window.__popupNav.create = o.url; } } };
})();`;

// ---- the checks --------------------------------------------------------------------------
// Each returns { problems: [...], detail }.
const PUBLIC = [
  {
    name: "search page: what Needle attaches to",
    run: async (b) => {
      const p = await open(b, "/results?search_query=space+documentary");
      const got = await counts(p, { searchbox: SEARCH_INPUT, searchButton: SEARCH_BUTTON, results: "ytd-search ytd-section-list-renderer", thumbnails: SEL.badge, chips: SEL.chips });
      await p.close();
      return { problems: needAtLeast(got, { searchbox: 1, searchButton: 1, results: 1, thumbnails: 10, chips: 1 }), detail: JSON.stringify(got) };
    },
  },
  {
    name: "channel page: what Needle attaches to",
    run: async (b) => {
      const p = await open(b, "/@veritasium/videos");
      const got = await counts(p, { searchbox: SEARCH_INPUT, primary: "ytd-browse #primary", feedCards: SEL.feed, chips: SEL.chips });
      await p.close();
      return { problems: needAtLeast(got, { searchbox: 1, primary: 1, feedCards: 10, chips: 1 }), detail: JSON.stringify(got) };
    },
  },
  {
    name: "watch page: what Needle attaches to",
    run: async (b) => {
      const p = await open(b, "/watch?v=NiCgcUTL9_Q");
      const got = await counts(p, { searchbox: SEARCH_INPUT, player: "#movie_player", metadata: "ytd-watch-metadata", sidebarThumbs: SEL.badge });
      await p.close();
      return { problems: needAtLeast(got, { searchbox: 1, player: 1, metadata: 1, sidebarThumbs: 5 }), detail: JSON.stringify(got) };
    },
  },
  {
    name: "playlist page: what Needle attaches to",
    run: async (b) => {
      const p = await open(b, "/playlist?list=UUHnyfMqiRRG1u-2MsSQLbXA");
      const got = await counts(p, { searchbox: SEARCH_INPUT, cards: SEL.screen });
      await p.close();
      return { problems: needAtLeast(got, { searchbox: 1, cards: 10 }), detail: JSON.stringify(got) };
    },
  },
  {
    name: "panel on a playlist: reads it all, length in view",
    run: async (b) => {
      // Crash Course Astronomy: a public course of 48 videos.
      const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
      const l = await p.evaluate(() => { const x = document.querySelector(".ytcs-launcher"); if (!x) return null; const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (!l) { await p.close(); return { problems: ["no Needle button on the page"] }; }
      await p.mouse.click(l.x, l.y);
      let r = null;
      for (let t = 0; t < 25000; t += 1000) {
        await sleep(1000);
        r = await p.evaluate(() => {
          const head = document.querySelector(".ytcs-chrome"), stats = document.querySelector(".ytcs-stats"), grid = document.querySelector(".ytcs-grid");
          if (!head || !stats) return { panel: false };
          const hr = head.getBoundingClientRect(), sr = stats.getBoundingClientRect();
          const length = (stats.innerText.match(/Total length\s*([^\n]+)/) || [])[1] || "";
          return { panel: true, videos: grid ? grid.children.length : 0, length, covered: sr.top < hr.bottom - 1 && sr.bottom > hr.top };
        });
        if (r.length && r.videos >= 40) break;
      }
      // A filter typed the way the box's placeholder suggests, and left there: no space, no Enter.
      let typed = null;
      if (r && r.panel) {
        await p.click(".ytcs-wrap input");
        await p.keyboard.type("<11m", { delay: 80 });
        await sleep(1800);
        typed = await p.evaluate(() => {
          const n = (document.querySelector(".ytcs-wrap").innerText.match(/(\d+) of (\d+)/) || []).slice(1).map(Number);
          const len = [...document.querySelectorAll(".ytcs-stats .ytcs-stat")].map((t) => t.textContent).find((t) => /Total length/.test(t)) || "";
          return { shown: n[0], of: n[1], length: len.replace("Total length", "").trim() };
        });
      }
      await p.close();
      const problems = [];
      if (!r || !r.panel) problems.push("the panel did not open");
      else {
        if (r.videos < 40) problems.push(`${r.videos} of 48 videos read`);
        if (!r.length) problems.push("no Total length");
        if (r.covered) problems.push("the length line is hidden under the panel's header");
        if (!typed || !(typed.shown > 0 && typed.shown < typed.of)) problems.push(`"<11m" typed and left: ${typed ? typed.shown + " of " + typed.of : "no count"}`);
        else if (typed.length === r.length) problems.push("the total did not follow the typed filter");
      }
      return { problems, detail: JSON.stringify({ ...r, typed }) };
    },
  },
  {
    name: "panel menus: picking an option filters the list",
    run: async (b) => {
      const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
      await p.evaluate(() => document.querySelector(".ytcs-launcher").click());
      for (let t = 0; t < 25000; t += 1000) { await sleep(1000); if (await p.evaluate(() => (document.querySelector(".ytcs-grid") || { children: [] }).children.length >= 40)) break; }
      const count = () => p.evaluate(() => +((document.querySelector(".ytcs-wrap").innerText.match(/(\d+) of \d+/) || [])[1] || 0));
      const before = await count();
      // "+ Length", as a person opens it, then its second option
      const opened = await p.evaluate(() => { const b = [...document.querySelectorAll(".ytcs-wrap button")].find((x) => /Length/.test(x.textContent) && x.getBoundingClientRect().width > 0); if (!b) return false; b.click(); return true; });
      await sleep(600);
      const opt = await p.evaluate(() => { const o = [...document.querySelectorAll(".ytcs-menu [role=option]")].filter((x) => x.getBoundingClientRect().width > 0)[1]; if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: o.textContent.trim() }; });
      if (opt) await p.mouse.click(opt.x, opt.y);
      await sleep(1200);
      const after = await count();
      await p.close();
      const problems = [];
      if (!opened) problems.push("no Length menu in the panel");
      else if (!opt) problems.push("the Length menu opened with no options");
      else if (after === before) problems.push(`picked "${opt.text}" and the list stayed at ${before}`);
      return { problems, detail: JSON.stringify({ before, picked: opt && opt.text, after }) };
    },
  },
  {
    name: "panel on a channel: header stays in reach, under YouTube's tabs",
    run: async (b) => {
      const p = await open(b, "/@veritasium/videos", "full");
      const l = await p.evaluate(() => { const x = document.querySelector(".ytcs-launcher"); if (!x) return null; const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (!l) { await p.close(); return { problems: ["no Needle button on the page"] }; }
      await p.mouse.click(l.x, l.y);
      for (let t = 0; t < 30000; t += 1000) {
        await sleep(1000);
        if (await p.evaluate(() => (document.querySelector(".ytcs-grid") || { children: [] }).children.length >= 60)) break;
      }
      await p.evaluate(() => window.scrollBy(0, 2000));
      await sleep(2000);
      const r = await p.evaluate(() => {
        const head = document.querySelector(".ytcs-chrome");
        if (!head) return null;
        const hr = head.getBoundingClientRect();
        // Whatever YouTube keeps fixed across the top of the page at the header's place.
        const at = document.elementFromPoint(hr.left + 20, hr.top + 8);
        return { videos: document.querySelector(".ytcs-grid").children.length, headTop: Math.round(hr.top), onTop: head.contains(at) };
      });
      await p.close();
      const problems = [];
      if (!r) problems.push("the panel did not open");
      else {
        if (r.videos < 60) problems.push(`only ${r.videos} videos read`);
        if (r.headTop < 40 || r.headTop > 160) problems.push(`scrolled, the header is at ${r.headTop}px, not held under the masthead`);
        else if (!r.onTop) problems.push("scrolled, something of YouTube's covers the header");
      }
      return { problems, detail: r ? JSON.stringify(r) : "" };
    },
  },
  {
    name: "Mute on search: hides that channel only, stays fast",
    run: async (b) => {
      const p = await open(b, "/results?search_query=space+documentary", true);
      // Mute whoever made the first result, by what YouTube's data says.
      const target = await p.evaluate(() => {
        for (const a of document.querySelectorAll("a[href*='/watch?v=']")) {
          const o = muteOwners.get(muteLinkId(a));
          if (o && o.channelIds.length && !a.closest(MUTE_NEVER)) {
            muted.list = [muteEntry(o.names[0] || "", o.handles[0] || "", o.channelIds[0])];
            muted.ver++;
            return o.channelIds[0];
          }
        }
        return "";
      });
      if (!target) { await p.close(); return { problems: ["YouTube's data named no channel on the page"] }; }
      for (let i = 0; i < 4; i++) { await p.evaluate(() => window.scrollBy(0, 3500)); await sleep(1800); }
      await p.evaluate(() => muteScan());
      const r = await p.evaluate((target) => {
        const hidden = [...document.querySelectorAll("[data-ytcs-muted]")];
        const wrong = hidden.filter((c) => {
          const o = muteOwners.get(c.getAttribute("data-ytcs-vid")) || { channelIds: [] };
          return !o.channelIds.includes(target) || c.querySelector("#movie_player, ytd-comments, ytd-watch-metadata");
        });
        const passes = window.__needlePasses || [];
        return { owners: muteOwners.size, hidden: hidden.length, wrong: wrong.length, slowest: Math.round(Math.max(0, ...passes)), avg: passes.length ? Math.round(passes.reduce((a, b) => a + b, 0) / passes.length) : 0 };
      }, target);
      await p.close();
      const problems = [];
      if (!r.hidden) problems.push("nothing hidden");
      if (r.wrong) problems.push(r.wrong + " hidden that should not be");
      if (r.owners < 40) problems.push("only " + r.owners + " videos named after scrolling: the fetch reader may be broken");
      if (r.avg > 40 || r.slowest > 120) problems.push(`slow: ${r.avg}ms a pass, slowest ${r.slowest}ms`);
      return { problems, detail: JSON.stringify(r) };
    },
  },
  {
    name: "⋮ menu on search: Mute channel everywhere",
    run: async (b) => {
      const p = await open(b, "/results?search_query=space+documentary", true);
      const url = p.url();
      const problems = await muteThroughMenu(p, "video", "Mute channel");
      if (p.url() !== url) problems.push("the click navigated away");
      await p.close();
      return { problems };
    },
  },
  {
    name: "⋮ menu beside a video, and none on the player's own",
    run: async (b) => {
      const p = await open(b, "/watch?v=NiCgcUTL9_Q", true);
      const problems = await muteThroughMenu(p, "video", "Mute channel");
      const own = await p.evaluate(() => {
        const m = document.querySelector("ytd-watch-metadata");
        const btn = m && [...m.querySelectorAll("button")].find((x) => /more actions/i.test(x.getAttribute("aria-label") || "") && x.getBoundingClientRect().width > 0);
        if (!btn) return null;
        btn.scrollIntoView({ block: "center" });
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (own) {
        await p.mouse.click(own.x, own.y);
        if (await menuItem(p, 1200)) problems.push("Needle's item appeared on the player's own ⋮");
      }
      await p.close();
      return { problems };
    },
  },
  {
    name: "Shorts: named by oEmbed, a muted channel's Shorts all go",
    run: async (b) => {
      const p = await open(b, "/results?search_query=veritasium+shorts", true);
      const problems = await muteThroughMenu(p, "short", "Mute channel");
      await sleep(2500);
      const r = await p.evaluate(() => {
        const handle = (muted.list.slice(-1)[0] || {}).handle;
        const seen = new Set(), out = { same: 0, sameHidden: 0, other: 0, otherHidden: 0, unnamed: 0 };
        for (const a of document.querySelectorAll("a[href^='/shorts/']")) {
          const id = muteLinkId(a);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const h = ((muteOwners.get(id) || {}).handles || [])[0];
          const hidden = muteCard(a, id).hasAttribute("data-ytcs-muted");
          if (!h) out.unnamed++;
          else if (h === handle) { out.same++; if (hidden) out.sameHidden++; }
          else { out.other++; if (hidden) out.otherHidden++; }
        }
        return out;
      });
      await p.close();
      if (r.unnamed) problems.push(r.unnamed + " Shorts nobody could name");
      if (!r.same || r.sameHidden < r.same) problems.push(`${r.sameHidden} of the muted channel's ${r.same} Shorts hidden`);
      if (r.otherHidden) problems.push(r.otherHidden + " other channels' Shorts hidden");
      return { problems, detail: JSON.stringify(r) };
    },
  },
  {
    name: "⋮ menu on a channel page: Unmute",
    run: async (b) => {
      const p = await open(b, "/@veritasium/videos", true);
      await p.evaluate(() => { muted.list = [muteEntry("Veritasium", "veritasium", "UCHnyfMqiRRG1u-2MsSQLbXA")]; muted.ver++; window.scrollBy(0, 300); });
      await sleep(1500);
      const problems = await muteThroughMenu(p, "video", "Unmute channel");
      if (await p.evaluate(() => muted.list.length)) problems.push("still muted after Unmute");
      await p.close();
      return { problems };
    },
  },
  {
    name: "Undo: a mute taken back brings the cards back",
    run: async (b) => {
      const p = await open(b, "/results?search_query=space+documentary", true);
      const problems = await muteThroughMenu(p, "video", "Mute channel");
      const undo = await p.evaluate(() => typeof window.__needleUndo === "function");
      if (!undo) problems.push("the toast offered no Undo");
      else {
        await p.evaluate(() => window.__needleUndo());
        await sleep(900);
        const r = await p.evaluate(() => ({ n: muted.list.length, hidden: document.querySelectorAll("[data-ytcs-muted]").length }));
        if (r.n) problems.push("still muted after Undo");
        if (r.hidden) problems.push(r.hidden + " cards still hidden after Undo");
      }
      await p.close();
      return { problems };
    },
  },
  {
    name: "muted words: a title with the word goes, nothing else does",
    run: async (b) => {
      const p = await open(b, "/results?search_query=space+documentary", true);
      for (let i = 0; i < 2; i++) { await p.evaluate(() => window.scrollBy(0, 3000)); await sleep(1500); }
      const r = await p.evaluate(() => {
        // a word some of the titles on the page share, and some don't
        const titles = new Map();
        for (const [id, o] of muteOwners) if (o.title) titles.set(id, o.title);
        const count = new Map();
        for (const t of titles.values()) for (const w of new Set(t.toLowerCase().match(/\p{L}{5,}/gu) || [])) count.set(w, (count.get(w) || 0) + 1);
        const pick = [...count].filter(([, n]) => n >= 2 && n <= titles.size / 2).sort((a, b) => b[1] - a[1])[0];
        if (!pick) return { word: null, titles: titles.size };
        muted.words = [pick[0]];
        muted.ver++;
        muteScan();
        const re = new RegExp("(?<![\\p{L}\\p{N}])" + pick[0] + "(?![\\p{L}\\p{N}])", "iu");
        const seen = new Set();
        let should = 0, gone = 0, wrong = 0;
        for (const a of document.querySelectorAll(MUTE_VIDEO_LINK)) {
          if (a.closest(MUTE_NEVER)) continue;
          const id = muteLinkId(a), t = titles.get(id);
          if (!id || !t || seen.has(id)) continue;
          seen.add(id);
          const card = muteCard(a, id);
          if (!card) continue;
          const hidden = card.hasAttribute("data-ytcs-muted");
          if (re.test(t)) { should++; if (hidden) gone++; } else if (hidden) wrong++;
        }
        return { word: pick[0], should, gone, wrong };
      });
      await p.close();
      const problems = [];
      if (!r.word) problems.push(`no word to mute among ${r.titles} titles`);
      else {
        if (!r.should) problems.push(`no card on the page has "${r.word}"`);
        else if (r.gone < r.should) problems.push(`${r.gone} of ${r.should} cards with "${r.word}" hidden`);
        if (r.wrong) problems.push(r.wrong + " cards without the word hidden");
      }
      return { problems, detail: JSON.stringify(r) };
    },
  },
  {
    // The length goes to YouTube's own filter, so every result it sends is already short; the views are Needle's
    // to apply, so those cut the list.
    name: "search bar: a typed filter cuts YouTube's results",
    run: async (b) => {
      const p = await open(b, "/", "full");
      await p.click(SEARCH_INPUT);
      await p.keyboard.type("black holes <20m >1m views", { delay: 50 });
      await sleep(700);
      await p.keyboard.press("Enter");
      let r = null;
      for (let t = 0; t < 30000; t += 1000) {
        await sleep(1000);
        r = await p.evaluate(() => {
          const m = ((document.querySelector(".ytcs-wrap") || {}).innerText || "").match(/(\d[\d,]*) of (\d[\d,]*)/);
          if (location.pathname !== "/results" || !m) return null;
          const secs = [...document.querySelectorAll(".ytcs-grid .ytcs-dur")].map((d) => d.textContent.trim().split(":").reduce((a, x) => a * 60 + (+x || 0), 0));
          return { shown: +m[1].replace(/,/g, ""), of: +m[2].replace(/,/g, ""), cards: secs.length, over: secs.filter((s) => s >= 1200).length };
        });
        if (r && r.cards) break;
      }
      await p.close();
      const problems = [];
      if (!r) problems.push("the results page never showed Needle's filtered list");
      else {
        if (!r.cards) problems.push("the filtered list is empty");
        if (r.over) problems.push(`${r.over} of ${r.cards} results are 20 minutes or longer`);
        if (r.shown >= r.of) problems.push(`">1m views" cut nothing: ${r.shown} of ${r.of}`);
      }
      return { problems, detail: JSON.stringify(r) };
    },
  },
  {
    name: "share: Copy a link makes a link that opens the same view",
    run: async (b) => {
      const p = await open(b, "/@veritasium/videos", "full");
      const problems = [];
      if (!(await openPanel(p, 60))) { await p.close(); return { problems: ["the panel did not open"] }; }
      await p.evaluate(() => { navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
      await p.click(".ytcs-wrap input");
      await p.keyboard.type(">30m ", { delay: 60 });
      await sleep(1500);
      await p.evaluate(() => { const x = [...document.querySelectorAll(".ytcs-wrap button")].find((e) => /^Export/.test(e.textContent.trim())); if (x) x.click(); });
      await sleep(600);
      await p.evaluate(() => { const o = [...document.querySelectorAll(".ytcs-menu [role=option]")].find((e) => /link to this filter/i.test(e.textContent)); if (o) o.click(); });
      await sleep(1200);
      const link = await p.evaluate(() => window.__copied || "");
      await p.close();
      if (!link) return { problems: ["Copy a link copied nothing"] };
      const h = new URLSearchParams(link.split("#")[1] || "");
      if (!link.startsWith("https://gottostartsomewhere.github.io/needle/f/#")) problems.push("the link does not go to the share page: " + link.slice(0, 80));
      if (h.get("k") !== "channel" || h.get("p") !== "/@veritasium/videos") problems.push(`the link names ${h.get("k")} ${h.get("p")}`);
      if (!/>30m/.test(h.get("q") || "")) problems.push(`the filter is missing from the link: q=${h.get("q")}`);
      // the share page itself, live, turns it into a YouTube link Needle opens with the filter
      const s = await b.newPage();
      await s.goto(link, { waitUntil: "networkidle2", timeout: 60000 });
      const page = await s.evaluate(() => ({ heading: (document.getElementById("fh") || {}).textContent || "", open: (document.getElementById("fopen") || {}).href || "" }));
      await s.close();
      if (/broken/i.test(page.heading)) problems.push("the share page says the link is broken");
      if (!page.open.startsWith("https://www.youtube.com/@veritasium/videos#needle=")) problems.push("the share page's Open goes to " + page.open.slice(0, 80));
      // and Needle, opened from that link, puts the same filter on the same channel
      let opened = null;
      if (page.open.startsWith("https://www.youtube.com/")) {
        const y = await open(b, page.open.slice("https://www.youtube.com".length), "full");
        for (let t = 0; t < 30000 && !(opened && opened.shown < opened.of); t += 1000) { await sleep(1000); opened = await panelCount(y); }
        await y.close();
        if (!opened) problems.push("YouTube opened from the share link without Needle's panel");
        else if (!(opened.shown < opened.of)) problems.push(`opened from the link, the filter was not applied: ${opened.shown} of ${opened.of}`);
      }
      return { problems, detail: JSON.stringify({ q: h.get("q"), opened }) };
    },
  },
  {
    // In the panel (a click on its stats line), / goes to its search box and j walks the cards. Outside it, the keys
    // stay YouTube's.
    name: "keyboard: / and j in the panel",
    run: async (b) => {
      const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
      if (!(await openPanel(p, 40))) { await p.close(); return { problems: ["the panel did not open"] }; }
      const inside = async () => { const s = await p.evaluate(() => { const r = document.querySelector(".ytcs-stats").getBoundingClientRect(); return { x: r.right - 20, y: r.top + r.height / 2 }; }); await p.mouse.click(s.x, s.y); };
      const where = () => p.evaluate(() => { const a = document.activeElement, grid = [...(document.querySelector(".ytcs-grid") || { children: [] }).children];
        return { box: !!(a && a.tagName === "INPUT" && a.closest(".ytcs-wrap")), card: grid.findIndex((c) => c === a || c.contains(a)) }; });
      await inside();
      await p.keyboard.press("/");
      await sleep(300);
      const slash = await where();
      await p.keyboard.press("Escape");
      await inside();
      await p.keyboard.press("j");
      await sleep(200);
      const j1 = await where();
      await p.keyboard.press("j");
      await sleep(200);
      const j2 = await where();
      await p.close();
      const problems = [];
      if (!slash.box) problems.push("/ did not go to the panel's search box");
      if (j1.card !== 0) problems.push(`j went to card ${j1.card}, not the first`);
      else if (j2.card !== 1) problems.push(`j again went to card ${j2.card}, not the second`);
      return { problems, detail: JSON.stringify({ slash, j1, j2 }) };
    },
  },
  {
    name: "light and dark: Needle's text is readable in both",
    run: async (b) => {
      const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
      if (!(await openPanel(p, 40))) { await p.close(); return { problems: ["the panel did not open"] }; }
      const theme = (dark) => p.evaluate((dark) => { for (const el of [document.documentElement, document.querySelector("ytd-app"), document.querySelector("ytd-masthead")]) if (el) el.toggleAttribute("dark", dark); }, dark);
      const out = {};
      for (const [name, dark] of [["light", false], ["dark", true]]) {
        await theme(dark);
        await sleep(600);
        out[name] = await p.evaluate(CONTRAST, ".ytcs-wrap, .ytcs-launcher");
      }
      // the search bar's dropdown, in the theme the page is in
      await p.click(SEARCH_INPUT);
      await sleep(1200);
      out.dropdown = await p.evaluate(CONTRAST, ".ytcs-omni");
      await p.close();
      const problems = [];
      for (const [k, v] of Object.entries(out)) {
        if (k !== "dropdown" && v.n < 20) problems.push(`${k}: only ${v.n} text elements found`);
        const w = v.worst[0];
        if (w && w.ratio < 3) problems.push(`${k}: ${w.what} is ${w.ratio}:1, unreadable`);
      }
      return { problems, detail: Object.entries(out).map(([k, v]) => `${k} worst ${v.worst[0] ? v.worst[0].ratio + ":1 " + v.worst[0].what : "n/a"}`).join("; ") };
    },
  },
  {
    name: "popup: opens clean, What's new, settings, a muted word saves",
    run: async (b) => {
      const p = await b.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e.message).slice(0, 100)));
      await p.evaluateOnNewDocument(popupStub());
      await p.goto("file:///" + path.join(ROOT, "popup.html").replace(/\\/g, "/"), { waitUntil: "load" });
      await sleep(800);
      const r = await p.evaluate(() => {
        const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getBoundingClientRect().height > 0; };
        return { whatsnew: vis("whatsnew"), open: vis("open"), settings: ["librarySearch", "deepHistory", "maxVideos"].every(vis), mutedEmpty: vis("mutedEmpty"), wordForm: vis("wordForm") };
      });
      await p.type("#wordInput", "crypto");
      await p.evaluate(() => document.getElementById("wordForm").requestSubmit());
      await sleep(600);
      const saved = await p.evaluate(() => ({ stored: (window.__popupStore.local.mutedWords || []).includes("crypto"), listed: /crypto/.test(document.getElementById("mutedWords").textContent) }));
      await p.close();
      const problems = errors.map((e) => "error: " + e);
      if (!r.whatsnew) problems.push("What's new is not shown after an update");
      if (!r.open || !r.settings) problems.push("the popup's controls are missing");
      if (!r.mutedEmpty) problems.push("the empty muted list has no explanation");
      if (!saved.stored) problems.push("a muted word was not saved");
      if (!saved.listed) problems.push("a muted word does not show in the list");
      return { problems, detail: JSON.stringify({ ...r, ...saved }) };
    },
  },
  {
    // Home, a video, and off YouTube: the popup's button goes somewhere the panel works instead of greying out.
    name: "popup: on Home, on a video and off YouTube, the button goes somewhere",
    run: async (b) => {
      const problems = [], detail = {};
      for (const [name, url, reply, label, goes] of [
        ["Home", "https://www.youtube.com/", null, "Search your Watch Later", ["update", "https://www.youtube.com/playlist?list=WL#needle="]],
        ["video", "https://www.youtube.com/watch?v=NiCgcUTL9_Q", { path: "/@veritasium", name: "Veritasium" }, "Search Veritasium's videos", ["update", "https://www.youtube.com/@veritasium/videos#needle="]],
        ["off YouTube", "https://example.com/", null, "Open YouTube", ["create", "https://www.youtube.com/"]],
      ]) {
        const p = await b.newPage();
        const errors = [];
        p.on("pageerror", (e) => errors.push(String(e.message).slice(0, 100)));
        await p.evaluateOnNewDocument(popupStub(url, reply));
        await p.goto("file:///" + path.join(ROOT, "popup.html").replace(/\\/g, "/"), { waitUntil: "load" });
        await sleep(500);
        const r = await p.evaluate(() => ({ text: document.getElementById("open").textContent, disabled: document.getElementById("open").disabled, also: document.getElementById("also").children.length }));
        await p.click("#open");
        await sleep(300);
        const nav = await p.evaluate(() => window.__popupNav);
        await p.close();
        detail[name] = { ...r, nav };
        for (const e of errors) problems.push(`${name}: error ${e}`);
        if (r.text !== label) problems.push(`${name}: the button says "${r.text}"`);
        if (r.disabled) problems.push(`${name}: the button is greyed out`);
        if (nav[goes[0]] !== goes[1]) problems.push(`${name}: it goes to ${nav[goes[0]] || "nowhere"}`);
        if (name !== "off YouTube" && r.also !== 2) problems.push(`${name}: ${r.also} other lists offered`);
      }
      return { problems, detail: JSON.stringify(detail) };
    },
  },
  {
    // What those buttons rely on, live: "#needle=" opens the panel as the page lands, and a video names its channel.
    name: "arriving with #needle= opens the panel; a video names its channel",
    run: async (b) => {
      const problems = [];
      const p = await open(b, "/@veritasium/videos#needle=", "full");
      let c = null;
      for (let t = 0; t < 30000 && !(c && c.of >= 60); t += 1000) { await sleep(1000); c = await panelCount(p); }
      await p.close();
      if (!c) problems.push("the panel did not open on arrival");
      else if (c.shown !== c.of) problems.push(`it opened filtered: ${c.shown} of ${c.of}`);
      const w = await open(b, "/watch?v=NiCgcUTL9_Q", "full");
      const ch = await w.evaluate(() => window.__needleCheck.pageVideoChannel && window.__needleCheck.pageVideoChannel());
      await w.close();
      if (!ch || !/^\/(@[^/]+|channel\/UC[\w-]{22})$/.test(ch.path) || !ch.name) problems.push("the video page did not name its channel: " + JSON.stringify(ch));
      return { problems, detail: JSON.stringify({ opened: c, channel: ch }) };
    },
  },
  {
    // YouTube's hover preview is one page-wide player: on search results it used to start a promoted video across the
    // panel's header. Open, the panel keeps it away; closed, YouTube has it back.
    name: "search results: YouTube's hover preview stays off the panel",
    run: async (b) => {
      const p = await open(b, "/results?search_query=black+holes", "full");
      if (!(await openPanel(p, 20))) { await p.close(); return { problems: ["the panel did not open"] }; }
      await p.click(".ytcs-wrap input");
      await p.keyboard.type("<20m ", { delay: 40 });
      await sleep(3000);
      const r = await p.evaluate(() => {
        const head = document.querySelector(".ytcs-head").getBoundingClientRect();
        const onTop = [0.1, 0.3, 0.5].every((fx) => { const e = document.elementFromPoint(head.left + head.width * fx, head.top + head.height / 2); return !!(e && e.closest(".ytcs-head")); });
        const v = document.querySelector("#video-preview");
        return { onTop, previewShown: !!v && getComputedStyle(v).display !== "none" && !!v.querySelector("video") };
      });
      await p.evaluate(() => document.querySelector(".ytcs-restore").click());
      await sleep(500);
      const after = await p.evaluate(() => document.documentElement.hasAttribute("data-ytcs-panel"));
      await p.close();
      const problems = [];
      if (!r.onTop) problems.push("something of YouTube's covers the panel's header");
      if (r.previewShown) problems.push("YouTube's hover preview is showing with the panel open");
      if (after) problems.push("closed, the page still keeps YouTube's preview off");
      return { problems, detail: JSON.stringify({ ...r, keptOffAfterClose: after }) };
    },
  },
  {
    // Until the panel has been opened once, the button says what it does on the page, then folds back to the mark.
    name: "needle button: says what it does until the panel is first opened",
    run: async (b) => {
      const problems = [], detail = {};
      const look = (p) => p.evaluate(() => { const l = document.querySelector(".ytcs-launcher"); return l ? { intro: l.classList.contains("ytcs-launcher-intro"), text: l.textContent.trim(), width: Math.round(l.getBoundingClientRect().width) } : null; });
      // A browser that has never used Needle: the checks before this one opened the panel on channels, which leaves
      // them cached, and a cached channel is how the button knows someone has used it.
      const wipe = await open(b, "/");
      await wipe.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("ytcs"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
      await wipe.close();
      for (const [url, label] of [["/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "Search this playlist"], ["/@veritasium/videos", "Search this channel"]]) {
        const p = await open(b, url, "full");
        await sleep(600);
        const first = await look(p);
        detail[label] = first;
        if (!first) { problems.push(`${url}: no button`); await p.close(); continue; }
        if (!first.intro || first.text !== label) problems.push(`${url}: the button says "${first.text}"`);
        if (label === "Search this channel") {
          await sleep(9500);
          const later = await look(p);
          detail.later = later;
          if (later.intro || later.text) problems.push("it did not fold back to the mark");
          // opening the panel is remembered, so it never labels itself again
          await p.click(".ytcs-launcher");
          await sleep(1500);
          const kept = await p.evaluate(() => window.__needleCheck.store.local.launcherIntro || {});
          detail.kept = kept;
          if (!kept.opened) problems.push("opening the panel was not remembered");
          // and the channel it read is saved, which is what tells the button below someone has used Needle
          const cached = () => p.evaluate(() => new Promise((r) => { const q = indexedDB.open("ytcs"); q.onsuccess = () => { try { const g = q.result.transaction("catalogs").objectStore("catalogs").getAllKeys(); g.onsuccess = () => r(g.result); g.onerror = () => r([]); } catch (e) { r([]); } }; q.onerror = () => r([]); }));
          for (let t = 0; t < 40000; t += 1000) { if ((await cached()).some((k) => String(k).startsWith("/"))) break; await sleep(1000); }
          detail.cached = (await cached()).filter((k) => String(k).startsWith("/"));
        }
        await p.close();
      }
      // once opened, after three pages, or for anyone who used Needle before 2.3.1 (the rating ask counted a use):
      // just the mark, and the last is remembered so it is not worked out again
      for (const [why, local] of [["opened before", { launcherIntro: { shown: 1, opened: true } }], ["shown three times", { launcherIntro: { shown: 3, opened: false } }],
        ["used before this version", { rateAsk: { opens: 4, days: 2, done: false } }]]) {
        const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", { local });
        await sleep(800);
        const s = await look(p);
        const kept = await p.evaluate(() => window.__needleCheck.store.local.launcherIntro || {});
        await p.close();
        if (!s || s.intro || s.text) problems.push(`${why}: it still labels itself`);
        if (why === "used before this version" && !kept.opened) problems.push("a past use was not taken as having opened it");
      }
      // and someone whose only trace is a channel the panel read: the channel just opened above is now cached
      {
        const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
        await sleep(800);
        const s = await look(p);
        await p.close();
        if (!s || s.intro || s.text) problems.push("with a channel already read: it still labels itself");
      }
      return { problems, detail: JSON.stringify(detail) };
    },
  },
  {
    name: "popup: a muted list exports, and imports back",
    run: async (b) => {
      const p = await b.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e.message).slice(0, 100)));
      await p.evaluateOnNewDocument(popupStub());
      await p.evaluateOnNewDocument(() => { const real = URL.createObjectURL; URL.createObjectURL = (blob) => { window.__blob = blob; return real.call(URL, blob); }; HTMLAnchorElement.prototype.click = function () { window.__downloaded = this.download; }; });
      await p.goto("file:///" + path.join(ROOT, "popup.html").replace(/\\/g, "/"), { waitUntil: "load" });
      await sleep(600);
      // a file the way another blocker's export looks: a handle, a channel id, a word
      const file = path.join(os.tmpdir(), "needle-import-check.txt");
      fs.writeFileSync(file, "# from another blocker\n@veritasium\nUCYO_jab_esuFRV4b17AJtAw\nword: drama\n");
      await (await p.$("#muteFile")).uploadFile(file);
      await p.evaluate(() => document.getElementById("muteFile").dispatchEvent(new Event("change")));
      await sleep(900);
      const imported = await p.evaluate(() => { const s = window.__popupStore.local; return { channels: (s.muted || []).map((m) => m.handle || m.channelId), words: s.mutedWords || [], listed: document.getElementById("muted").children.length }; });
      await p.click("#muteExport");
      await sleep(600);
      const exported = await p.evaluate(async () => ({ name: window.__downloaded || "", text: window.__blob ? await window.__blob.text() : "" }));
      await p.close();
      fs.rmSync(file, { force: true });
      const problems = errors.map((e) => "error: " + e);
      if (!imported.channels.includes("veritasium") || !imported.channels.includes("UCYO_jab_esuFRV4b17AJtAw")) problems.push("import missed a channel: " + imported.channels.join(", "));
      if (!imported.words.includes("drama")) problems.push("import missed the word");
      if (imported.listed < 2) problems.push("imported channels are not listed");
      if (exported.name !== "needle-muted.txt") problems.push("export saved no file");
      else if (!/@veritasium/.test(exported.text) || !/word: drama/.test(exported.text)) problems.push("the exported file is missing what was imported");
      return { problems, detail: JSON.stringify({ imported, exportedLines: exported.text.split("\n").filter(Boolean).length }) };
    },
  },
  {
    name: "panel: Free time leaves only what fits",
    run: async (b) => {
      const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
      if (!(await openPanel(p, 40))) { await p.close(); return { problems: ["the panel did not open"] }; }
      const before = await panelCount(p);
      const err = await pickInMenu(p, "Free time", "10 min free");
      const after = await panelCount(p), secs = await shownSeconds(p);
      await p.close();
      const problems = err ? [err] : [];
      if (!err) {
        if (!after || !(after.shown < before.shown)) problems.push(`10 min free left ${after && after.shown} of ${before && before.shown}`);
        if (secs.some((s) => s > 600)) problems.push(`${secs.filter((s) => s > 600).length} videos longer than 10 minutes left`);
        if (!secs.length) problems.push("nothing fits 10 minutes");
      }
      return { problems, detail: JSON.stringify({ before, after, longest: Math.max(0, ...secs) }) };
    },
  },
  {
    name: "panel: Copy links (for NotebookLM) copies what is shown",
    run: async (b) => {
      const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
      if (!(await openPanel(p, 40))) { await p.close(); return { problems: ["the panel did not open"] }; }
      await p.click(".ytcs-wrap input");
      await p.keyboard.type("<11m ", { delay: 60 });
      await sleep(1500);
      const shown = await panelCount(p);
      const text = await exportCopy(p, "Copy links");
      await p.close();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const links = lines.filter((l) => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(l));
      const problems = [];
      if (!lines.length) problems.push("nothing copied");
      else if (links.length !== lines.length) problems.push(`${lines.length - links.length} lines are not plain video links`);
      if (shown && links.length !== shown.shown) problems.push(`${links.length} links copied for ${shown.shown} videos shown`);
      return { problems, detail: JSON.stringify({ shown: shown && shown.shown, links: links.length }) };
    },
  },
  {
    name: "panel: Play opens what is shown as a playlist",
    run: async (b) => {
      const p = await open(b, "/playlist?list=PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", "full");
      if (!(await openPanel(p, 40))) { await p.close(); return { problems: ["the panel did not open"] }; }
      await p.click(".ytcs-wrap input");
      await p.keyboard.type("<11m ", { delay: 60 });
      await sleep(1500);
      const ids = await p.evaluate(() => [...document.querySelectorAll(".ytcs-grid > [data-id]")].map((c) => c.dataset.id));
      const nav = p.waitForNavigation({ timeout: 30000 }).catch(() => null);
      await p.evaluate(() => { const x = [...document.querySelectorAll(".ytcs-wrap button")].find((e) => e.textContent.trim() === "Play"); if (x) x.click(); });
      await nav;
      await sleep(4000);
      const at = new URL(p.url());
      const r = { path: at.pathname, v: at.searchParams.get("v"), list: at.searchParams.get("list") || "" };
      await p.close();
      const problems = [];
      if (r.path !== "/watch") problems.push("Play went to " + r.path);
      else {
        if (!r.list) problems.push("the video plays without a playlist after it");
        if (r.v !== ids[0]) problems.push("it starts on a video that was not first in the list");
      }
      return { problems, detail: JSON.stringify({ ...r, first: ids[0], shown: ids.length }) };
    },
  },
  {
    name: "Insights: overview, Compare and Watchlist on a channel",
    run: async (b) => {
      const p = await open(b, "/@veritasium/videos", "full");
      if (!(await openPanel(p, 60))) { await p.close(); return { problems: ["the panel did not open"] }; }
      const problems = [], detail = {};
      const click = (sel, text) => p.evaluate((sel, text) => { const x = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text && e.getBoundingClientRect().width > 0); if (x) x.click(); return !!x; }, sel, text);
      if (!(await click(".ytcs-tab", "Insights"))) problems.push("no Insights tab");
      await sleep(2000);
      detail.overview = await p.evaluate(() => { const c = document.querySelector(".ytcs-charts"); return c ? { parts: c.children.length, numbers: (c.innerText.match(/\d/g) || []).length } : null; });
      if (!detail.overview || !detail.overview.parts || detail.overview.numbers < 10) problems.push("the overview drew no charts");
      // Compare: another channel's whole catalogue, lined up against this one
      if (!(await click(".ytcs-sub", "Compare"))) problems.push("no Compare");
      else {
        await sleep(400);
        await p.evaluate(() => { const i = [...document.querySelectorAll(".ytcs-insights .ytcs-textin")].find((e) => e.getBoundingClientRect().width > 0); i.focus(); });
        await p.keyboard.type("@3blue1brown", { delay: 40 });
        await click(".ytcs-primary", "Compare");
        let cmp = "";
        for (let t = 0; t < 90000 && cmp.length < 80; t += 2000) { await sleep(2000); cmp = await p.evaluate(() => (document.querySelector(".ytcs-cmpresult") || {}).innerText || ""); }
        detail.compare = cmp.length;
        if (cmp.length < 80) problems.push("Compare showed nothing for @3blue1brown");
      }
      // Watchlist: track a channel, refresh, get its standouts back
      if (!(await click(".ytcs-sub", "Watchlist"))) problems.push("no Watchlist");
      else {
        await sleep(400);
        await p.evaluate(() => { const i = [...document.querySelectorAll(".ytcs-insights .ytcs-textin")].find((e) => e.getBoundingClientRect().width > 0); i.value = ""; i.focus(); });
        await p.keyboard.type("@3blue1brown", { delay: 40 });
        await click(".ytcs-primary", "Track");
        await sleep(1500);
        const chips = await p.evaluate(() => (document.querySelector(".ytcs-chips") || {}).innerText || "");
        if (!/3blue1brown/i.test(chips)) problems.push("Track did not add the channel");
        await click(".ytcs-insights button", "Refresh all");
        let res = "";
        for (let t = 0; t < 120000 && res.length < 40; t += 2000) { await sleep(2000); res = await p.evaluate(() => (document.querySelector(".ytcs-nresults") || {}).innerText || ""); }
        detail.watchlist = res.length;
        if (res.length < 40) problems.push("Refresh all brought nothing back");
      }
      await p.close();
      return { problems, detail: JSON.stringify(detail) };
    },
  },
  {
    name: "search: Follow a search, and is:fresh leaves out what you've seen",
    run: async (b) => {
      const p = await open(b, "/", "full");
      const search = async (q) => { await p.click(SEARCH_INPUT, { clickCount: 3 }); await p.keyboard.press("Backspace"); await p.keyboard.type(q, { delay: 40 }); await sleep(500); await p.keyboard.press("Enter"); };
      const problems = [], detail = {};
      // a search with a filter can be followed, and unfollowed
      await search("black holes <20m");
      let count = null;
      for (let t = 0; t < 30000 && !count; t += 1000) { await sleep(1000); count = await panelCount(p); }
      const label = () => p.evaluate(() => { const x = document.querySelector(".ytcs-followbtn"); return x && x.style.display !== "none" ? x.textContent.trim() : null; });
      const l0 = await label();
      await p.evaluate(() => document.querySelector(".ytcs-followbtn").click());
      await sleep(400);
      const l1 = await label();
      await p.evaluate(() => document.querySelector(".ytcs-followbtn").click());
      await sleep(400);
      const l2 = await label();
      detail.follow = [l0, l1, l2];
      if (!l0) problems.push("no Follow on a filtered search");
      else if (l1 === l0) problems.push("Follow did not change to following");
      else if (l2 !== l0) problems.push("pressing it again did not unfollow");
      // what is on screen now counts as seen; the same search with is:fresh leaves it out
      await search("black holes");
      await sleep(4000);
      for (let i = 0; i < 4; i++) { await p.evaluate(() => window.scrollBy(0, 700)); await sleep(1200); }
      await sleep(3000);
      await search("black holes is:fresh");
      let fresh = null;
      for (let t = 0; t < 30000 && !fresh; t += 1000) { await sleep(1000); fresh = await panelCount(p); }
      detail.fresh = fresh;
      if (!fresh) problems.push("is:fresh opened no filtered list");
      else if (!(fresh.shown < fresh.of)) problems.push(`is:fresh left ${fresh.shown} of ${fresh.of}: nothing seen was left out`);
      await p.close();
      return { problems, detail: JSON.stringify(detail) };
    },
  },
];

// Signed in: the lists only an account has, read with Needle's own readers.
const SIGNED_IN = [
  {
    name: "signed in: Home feed cards",
    run: async (b) => {
      const p = await open(b, "/");
      const got = await counts(p, { searchbox: SEARCH_INPUT, feedCards: SEL.feed, thumbnails: SEL.badge });
      await p.close();
      return { problems: needAtLeast(got, { searchbox: 1, feedCards: 8 }), detail: JSON.stringify(got) };
    },
  },
  {
    name: "signed in: Watch Later, Liked, history, subscriptions",
    run: async (b) => {
      const p = await open(b, "/feed/library");
      await p.evaluate(CORE);
      const r = await p.evaluate(async () => {
        const c = window.__needleCore;
        const sum = (list) => {
          const ok = list.filter((v) => v.playable !== false);
          const share = (f) => (ok.length ? Math.round((100 * ok.filter(f).length) / ok.length) : 0);
          return { n: ok.length, title: share((v) => v.title && v.title !== "(no title)"), length: share((v) => v.seconds > 0), shallow: !!list.shallow };
        };
        const out = {};
        const tryRead = async (k, fn) => { try { out[k] = sum(await fn()); } catch (e) { out[k] = { error: String(e && e.message || e).slice(0, 120) }; } };
        await tryRead("watchLater", () => c.fetchPlaylist("WL", false));
        await tryRead("watchLaterDeep", () => c.fetchPlaylist("WL", true));
        await tryRead("liked", () => c.fetchPlaylist("LL", false));
        await tryRead("likedDeep", () => c.fetchPlaylist("LL", true));
        await tryRead("history", () => c.fetchHistory(() => {}, false));
        await tryRead("historyDeep", () => c.fetchHistory(() => {}, true));
        await tryRead("subscriptions", () => c.fetchSubscriptions(() => {}, false));
        return out;
      });
      await p.close();
      const problems = [];
      for (const [k, v] of Object.entries(r)) {
        if (v.error) { problems.push(`${k} threw: ${v.error}`); continue; }
        if (!v.n) problems.push(`${k}: nothing read`);
        else if (v.title < 95) problems.push(`${k}: titles on only ${v.title}%`);
        if (v.n && k !== "subscriptions" && v.length < 80) problems.push(`${k}: lengths on only ${v.length}%`);
      }
      // Deep reading signs its requests; if the signing breaks, it silently stops at
      // page one. Only a list longer than one page can show it (a short Watch Later can't).
      if (r.watchLater && r.watchLater.shallow && r.watchLaterDeep && !(r.watchLaterDeep.n > r.watchLater.n)) problems.push("deep reading read no further into Watch Later");
      if (r.liked && r.liked.shallow && r.likedDeep && !(r.likedDeep.n > r.liked.n)) problems.push("deep reading read no further into Liked videos");
      if (r.history && r.historyDeep && !(r.historyDeep.n > r.history.n)) problems.push("deep reading read no further into history");
      const short = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.error ? "error" : v.n]));
      return { problems, detail: JSON.stringify(short) };
    },
  },
  {
    name: "signed in: the search bar brings up your own videos as you type",
    run: async (b) => {
      const p = await open(b, "/", "full");
      // a word a few of your own saved, watched or liked videos share, from the lists Needle read
      let word = null;
      for (let t = 0; t < 30000 && !word; t += 1000) {
        await sleep(1000);
        word = await p.evaluate(() => {
          const L = window.__needleCheck && window.__needleCheck.library;
          if (!L || L.wl.length + L.hist.length < 20) return null;
          const stop = new Set("the,and,for,with,this,that,from,your,what,how,why,you,are,was,official,video,full,part,new,best,into,about,make,made,will,when,have".split(","));
          const count = new Map();
          for (const v of L.wl.concat(L.hist, L.liked)) for (const w of new Set(v.title.toLowerCase().split(/[^a-z0-9]+/))) if (w.length >= 4 && !stop.has(w)) count.set(w, (count.get(w) || 0) + 1);
          const best = [...count].filter(([, n]) => n >= 3 && n <= 12).sort((a, b) => b[1] - a[1])[0];
          return best ? best[0] : null;
        });
      }
      if (!word) { await p.close(); return { problems: ["Needle read too little of your lists to search them"] }; }
      await p.click(SEARCH_INPUT);
      await p.keyboard.type(word, { delay: 70 });
      await sleep(2500);
      const r = await p.evaluate(() => {
        const box = document.querySelector(".ytcs-omni");
        const text = box ? box.innerText : "";
        return { open: !!box && box.getBoundingClientRect().height > 0, rows: box ? box.querySelectorAll("[role=option], .ytcs-omni-row").length : 0,
          sections: ["In your Watch Later", "You watched", "Liked"].filter((s) => text.includes(s)) };
      });
      await p.close();
      const problems = [];
      if (!r.open) problems.push(`typed "${word}": no dropdown`);
      else {
        if (r.rows < 2) problems.push(`typed "${word}": ${r.rows} rows`);
        if (!r.sections.length) problems.push(`typed "${word}": none of your lists in the dropdown`);
      }
      return { problems, detail: JSON.stringify({ word, ...r }) };
    },
  },
  {
    name: "signed in: the panel on your history and Watch Later",
    run: async (b) => {
      const problems = [], detail = {};
      for (const [name, url, stat] of [["history", "/feed/history", "Average length"], ["Watch Later", "/playlist?list=WL", "Total length"]]) {
        const p = await open(b, url, "full");
        if (!(await openPanel(p, 20))) { problems.push(`${name}: the panel did not open`); await p.close(); continue; }
        const before = await panelCount(p);
        const stats = await p.evaluate(() => (document.querySelector(".ytcs-stats") || {}).innerText || "");
        await p.click(".ytcs-wrap input");
        await p.keyboard.type("<20m", { delay: 80 });
        await sleep(1800);
        const after = await panelCount(p);
        await p.close();
        detail[name] = { before, after };
        if (!stats.includes(stat)) problems.push(`${name}: no ${stat} in the stats line`);
        if (!after || !before) problems.push(`${name}: no count`);
        else if (!(after.shown < before.shown)) problems.push(`${name}: "<20m" left ${after.shown} of ${before.shown}`);
      }
      return { problems, detail: JSON.stringify(detail) };
    },
  },
  {
    name: "signed in: Mute from a Home card",
    run: async (b) => {
      const p = await open(b, "/", true);
      const problems = await muteThroughMenu(p, "video", "Mute channel");
      await p.close();
      return { problems };
    },
  },
  {
    // Every main-thread freeze over 50ms while a word is typed into your whole history, deep reading on. Over 150ms is
    // a stall you can feel; drawing 600 cards on every key used to cost 273ms before off-screen cards were skipped.
    name: "signed in: typing in your whole history stays smooth",
    run: async (b) => {
      const p = await open(b, "/feed/history", { sync: { deepHistory: true } });
      if (!(await openPanel(p, 20))) { await p.close(); return { problems: ["the panel did not open"] }; }
      let last = -1, since = Date.now();
      for (const t0 = Date.now(); Date.now() - t0 < 120000; await sleep(500)) {
        const c = await panelCount(p);
        const n = c ? c.of : 0;
        if (n !== last) { last = n; since = Date.now(); } else if (n > 0 && Date.now() - since > 3000) break;
      }
      await p.click(".ytcs-wrap input");
      await p.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: "longtask" }); });
      await p.keyboard.type("minecraft", { delay: 120 });
      await sleep(1500);
      const r = { videos: last, longTasks: await p.evaluate(() => window.__long), result: await panelCount(p) };
      await p.close();
      const worst = Math.max(0, ...r.longTasks);
      const problems = [];
      if (r.videos < 1000) problems.push(`only ${r.videos} videos read: too few to measure`);
      if (worst > 150) problems.push(`typing froze the page for ${worst}ms`);
      return { problems, detail: JSON.stringify({ ...r, worst }) };
    },
  },
  {
    name: "signed in: the panel on your subscriptions",
    run: async (b) => {
      const p = await open(b, "/feed/subscriptions", "full");
      if (!(await openPanel(p, 20))) { await p.close(); return { problems: ["the panel did not open"] }; }
      const before = await panelCount(p);
      await p.click(".ytcs-wrap input");
      await p.keyboard.type("<20m", { delay: 80 });
      await sleep(1800);
      const after = await panelCount(p), secs = await shownSeconds(p);
      await p.close();
      const problems = [];
      if (!before || !after) problems.push("no count");
      else if (!(after.shown < before.shown)) problems.push(`"<20m" left ${after.shown} of ${before.shown}`);
      if (secs.some((s) => s >= 1200)) problems.push(`${secs.filter((s) => s >= 1200).length} videos of 20 minutes or more left`);
      return { problems, detail: JSON.stringify({ before, after }) };
    },
  },
  {
    name: "signed in: in:playlists searches your saved playlists",
    run: async (b) => {
      const p = await open(b, "/", "full");
      await p.click(SEARCH_INPUT);
      await p.keyboard.type("in:playlists ", { delay: 60 });
      // the first ask reads every playlist in your library, which takes a moment
      let r = null;
      for (let t = 0; t < 40000; t += 2000) {
        await sleep(2000);
        r = await p.evaluate(() => { const box = document.querySelector(".ytcs-omni"); const text = box ? box.innerText : ""; return { section: text.includes("In your playlists"), rows: box ? box.querySelectorAll("[role=option], .ytcs-omni-row").length : 0, text: text.replace(/\s+/g, " ").slice(0, 140) }; });
        if (r.section && r.rows) break;
      }
      await p.close();
      return { problems: r && r.section && r.rows ? [] : ["no videos from your playlists: " + (r ? r.text : "no dropdown")], detail: JSON.stringify({ rows: r && r.rows }) };
    },
  },
  {
    name: "signed in: finished videos hidden on Home and Subscriptions",
    run: async (b) => {
      const problems = [], detail = {};
      for (const [name, url] of [["Home", "/"], ["Subscriptions", "/feed/subscriptions"]]) {
        const p = await open(b, url, { sync: { feedWatched: "hide" } });
        for (let i = 0; i < 3; i++) { await p.evaluate(() => window.scrollBy(0, 2500)); await sleep(1500); }
        await sleep(1500);
        detail[name] = await p.evaluate(() => {
          const cards = [...document.querySelectorAll("ytd-rich-item-renderer")];
          const marked = cards.filter((c) => c.getAttribute("data-ytcs-feed") === "hide");
          return { cards: cards.length, hidden: marked.length, stillShowing: marked.filter((c) => c.getBoundingClientRect().height > 0).length };
        });
        await p.close();
        if (detail[name].stillShowing) problems.push(`${name}: ${detail[name].stillShowing} finished videos still showing`);
      }
      if (!detail.Home.hidden && !detail.Subscriptions.hidden) problems.push("no finished video was hidden on either page");
      return { problems, detail: JSON.stringify(detail) };
    },
  },
];

/*
 * Signed in, and changing the account: run only with --edits, never by the daily check. Each one does the thing
 * and then takes it back the way a person would (Undo, the archive, Like again), and checks both against what
 * YouTube itself then says is in the list.
 */
async function pickFirstAndAct(p) {
  await p.evaluate(() => document.querySelector(".ytcs-selectbtn").click());
  await sleep(600);
  const first = await p.evaluate(() => { const c = document.querySelector(".ytcs-grid > [data-id]"); if (!c) return null; const r = c.getBoundingClientRect(); return { id: c.dataset.id, x: r.x + r.width / 2, y: r.y + Math.min(60, r.height / 2) }; });
  if (!first) return { error: "no card to pick" };
  await p.mouse.click(first.x, first.y);
  await sleep(400);
  // the action, then the confirmation the bar asks for (the first time, "Allow and …")
  await p.evaluate(() => document.querySelector(".ytcs-selbar .ytcs-danger").click());
  await sleep(400);
  await p.evaluate(() => document.querySelector(".ytcs-selbar .ytcs-danger").click());
  let toast = "";
  for (let t = 0; t < 20000 && !toast; t += 500) { await sleep(500); toast = await p.evaluate(() => (document.querySelector(".ytcs-toast") || {}).innerText || ""); }
  return { id: first.id, toast };
}
const clickToastUndo = (p) => p.evaluate(() => { const x = document.querySelector(".ytcs-toast button"); if (x) x.click(); return !!x; });

const EDITS = [
  {
    name: "edits: remove from Watch Later, then Undo",
    run: async (b) => {
      const p = await open(b, "/playlist?list=WL", "full");
      if (!(await openPanel(p, 20))) { await p.close(); return { problems: ["the panel did not open"] }; }
      const r = await pickFirstAndAct(p);
      if (r.error) { await p.close(); return { problems: [r.error] }; }
      const problems = [];
      if (!/Removed 1 video/.test(r.toast)) problems.push("toast: " + (r.toast || "none"));
      const gone = !(await listIds(b, "WL")).includes(r.id);
      if (!gone) problems.push("YouTube still has it in Watch Later");
      if (!(await clickToastUndo(p))) problems.push("no Undo on the toast");
      await sleep(4000);
      await p.close();
      const back = (await listIds(b, "WL")).includes(r.id);
      if (!back) problems.push("Undo did not put it back: " + r.id);
      return { problems, detail: JSON.stringify({ id: r.id, gone, back }) };
    },
  },
  {
    name: "edits: remove from Watch Later, put back from Removed earlier",
    run: async (b) => {
      const p = await open(b, "/playlist?list=WL", "full");
      if (!(await openPanel(p, 20))) { await p.close(); return { problems: ["the panel did not open"] }; }
      const r = await pickFirstAndAct(p);
      if (r.error) { await p.close(); return { problems: [r.error] }; }
      const problems = [];
      const gone = !(await listIds(b, "WL")).includes(r.id);
      if (!gone) problems.push("YouTube still has it in Watch Later");
      // after the toast: Select, "Removed earlier", pick it, put it back
      await p.evaluate(() => document.querySelector(".ytcs-selectbtn").click());
      await sleep(1500);
      const opened = await p.evaluate(() => { const x = [...document.querySelectorAll(".ytcs-selbar button")].find((e) => /^Removed earlier/.test(e.textContent)); if (x) x.click(); return !!x; });
      if (!opened) problems.push("no Removed earlier in the bar");
      await sleep(1500);
      const card = await p.evaluate((id) => { const c = document.querySelector(`.ytcs-grid > [data-id="${id}"]`); if (!c) return null; const q = c.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + Math.min(60, q.height / 2) }; }, r.id);
      if (!card) problems.push("it is not in the archive");
      else {
        await p.mouse.click(card.x, card.y);
        await sleep(400);
        await p.evaluate(() => { const x = document.querySelector(".ytcs-selbar .ytcs-primarybtn"); if (x) x.click(); });
        await sleep(400);
        await p.evaluate(() => { const x = document.querySelector(".ytcs-selbar .ytcs-primarybtn"); if (x) x.click(); });
        await sleep(5000);
      }
      await p.close();
      const back = (await listIds(b, "WL")).includes(r.id);
      if (!back) problems.push("putting it back from the archive did not: " + r.id);
      return { problems, detail: JSON.stringify({ id: r.id, gone, back }) };
    },
  },
  {
    name: "edits: unlike from Liked videos, then Undo likes it again",
    run: async (b) => {
      const p = await open(b, "/playlist?list=LL", "full");
      if (!(await openPanel(p, 20))) { await p.close(); return { problems: ["the panel did not open"] }; }
      await sleep(1500);
      const can = await p.evaluate(() => { const x = document.querySelector(".ytcs-selectbtn"); return !!x && x.style.display !== "none"; });
      if (!can) { await p.close(); return { problems: ["no Select on Liked videos"] }; }
      const r = await pickFirstAndAct(p);
      if (r.error) { await p.close(); return { problems: [r.error] }; }
      const problems = [];
      if (!/Unliked 1 video/.test(r.toast)) problems.push("toast: " + (r.toast || "none"));
      const gone = !(await listIds(b, "LL")).includes(r.id);
      if (!gone) problems.push("YouTube still has it in Liked videos");
      if (!(await clickToastUndo(p))) problems.push("no Undo on the toast");
      await sleep(4000);
      await p.close();
      const back = (await listIds(b, "LL")).includes(r.id);
      if (!back) problems.push("Undo did not like it again: " + r.id);
      return { problems, detail: JSON.stringify({ id: r.id, gone, back }) };
    },
  },
  {
    name: "edits: find the deleted videos hiding in Watch Later",
    run: async (b) => {
      const p = await open(b, "/playlist?list=WL", "full");
      // YouTube's own count of what it hides: "3 unavailable videos are hidden"
      const hiddenByYouTube = await p.evaluate(() => { const m = document.body.innerText.match(/(\d+) unavailable videos? (?:are|is) hidden/i); return m ? +m[1] : 0; });
      if (!(await openPanel(p, 20))) { await p.close(); return { problems: ["the panel did not open"] }; }
      await p.evaluate(() => document.querySelector(".ytcs-selectbtn").click());
      await sleep(600);
      await p.evaluate(() => { const x = [...document.querySelectorAll(".ytcs-selbar button")].find((e) => e.textContent.trim() === "Find deleted videos"); if (x) x.click(); });
      await sleep(600);
      await p.evaluate(() => { const x = [...document.querySelectorAll(".ytcs-selbar button")].find((e) => e.textContent.trim() === "Allow and look"); if (x) x.click(); });
      let bar = "";
      for (let t = 0; t < 30000; t += 1000) { await sleep(1000); bar = await p.evaluate(() => document.querySelector(".ytcs-selbar").innerText.replace(/\s+/g, " ")); if (!/Looking/.test(bar) && bar) break; }
      // removing them can't be undone, so it stops at the question
      await p.evaluate(() => { const x = [...document.querySelectorAll(".ytcs-selbar button")].find((e) => e.textContent.trim() === "Cancel"); if (x) x.click(); });
      await p.close();
      const found = /No deleted or private videos/.test(bar) ? 0 : +((bar.match(/(\d+) deleted or private videos?/) || [])[1] || -1);
      const problems = [];
      if (found < 0) problems.push("it never said what it found: " + bar.slice(0, 120));
      else if (found < hiddenByYouTube) problems.push(`YouTube hides ${hiddenByYouTube} unavailable videos here and Needle found ${found}`);
      return { problems, detail: JSON.stringify({ hiddenByYouTube, found, bar: bar.slice(0, 120) }) };
    },
  },
];

// ---- running them ------------------------------------------------------------------------
// --only=word runs just the checks whose name has that word in it (several: --only="word|other")
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).toLowerCase().split("|").filter(Boolean);
async function runAll(browser, checks, stamp, lines, failed) {
  for (const c of checks.filter((c) => !ONLY.length || ONLY.some((w) => c.name.toLowerCase().includes(w)))) {
    let r;
    try { r = await c.run(browser); } catch (e) { r = { problems: ["threw: " + String(e && e.message || e).slice(0, 160)] }; }
    const ok = !r.problems.length;
    lines.push(`${stamp}  ${ok ? "PASS" : "FAIL"}  [browser] ${c.name}${ok ? (r.detail ? ": " + r.detail : "") : ": " + r.problems.join("; ")}`);
    if (!ok) failed.push(c.name);
  }
}

async function signedIn(browser) {
  const p = await browser.newPage();
  await p.goto(YT + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  const cookies = await p.cookies();
  await p.close();
  return cookies.some((c) => c.name === "SAPISID" || c.name === "__Secure-3PAPISID");
}

if (require.main === module) {
  (async () => {
    if (process.argv.includes("--signin")) {
      // Ordinary Chrome on the check's own profile, not an automated one: Google
      // refuses to sign in to a browser under automation.
      fs.mkdirSync(PROFILE, { recursive: true });
      spawn(CHROME, ["--user-data-dir=" + PROFILE, "--no-first-run", "--no-default-browser-check", YT + "/"], { detached: true, stdio: "ignore" }).unref();
      console.log("A Chrome window opened on the check's own profile. Sign in to YouTube there, then close the window.");
      console.log("Profile: " + PROFILE);
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const lines = [], failed = [];

    // Public pages on a fresh profile every time, so nothing carries over.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "needle-check-"));
    let browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: tmp, args: ["--lang=en-US"] });
    try { await runAll(browser, PUBLIC, stamp, lines, failed); } finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }

    if (!process.argv.includes("--public")) {
      if (!fs.existsSync(PROFILE)) {
        lines.push(`${stamp}  SKIP  [browser] signed-in checks: no profile yet. Run once: node tools/browser-check.js --signin`);
      } else {
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: PROFILE, args: ["--lang=en-US"] });
        try {
          if (await signedIn(browser)) {
            await runAll(browser, SIGNED_IN, stamp, lines, failed);
            if (process.argv.includes("--edits")) await runAll(browser, EDITS, stamp, lines, failed);
          } else {
            lines.push(`${stamp}  FAIL  [browser] signed-in checks: the check's profile is signed out. Run: node tools/browser-check.js --signin`);
            failed.push("signed out");
          }
        } finally { await browser.close(); }
      }
    }

    for (const l of lines) console.log(l);
    fs.appendFileSync(LOG, lines.join("\n") + "\n");
    if (process.argv.includes("--notify") && failed.length) {
      notify("Needle browser check failed", `${failed.length} failed: ${failed.slice(0, 3).join("; ")}. Details in tools\\canary-log.txt`);
    }
    process.exit(failed.length ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
