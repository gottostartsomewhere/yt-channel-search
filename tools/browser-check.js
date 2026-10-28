/*
 * node tools/browser-check.js [--notify] [--public] [--signin]
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
 *   - signed in: Watch Later, Liked videos, history and subscriptions read the
 *     way the panel and the search bar read them, deep reading included, and
 *     Home's feed cards.
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
  function toast(msg) { window.__needleToast = msg; } function renderMuteNote() {}
  var chrome = { storage: { local: { set() {}, get() {} }, sync: { get() {} }, onChanged: { addListener() {} } } };
  // As omnibar.js's watchForCards: a pass whenever YouTube adds cards.
  new MutationObserver(() => scheduleBadges()).observe(document.querySelector("ytd-page-manager") || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
` + MEM.slice(MEM.indexOf("const muted = {"), MEM.indexOf("// ---- followed searches")) + "\n" + read("src/mute.js") + "\nmuteScan(); 1;";
const AT_START = read("src/cards.js") + "\n" + read("src/feedmap.js");
// core.js in a scope of its own, so none of its names meet YouTube's.
const CORE = `window.__needleCore = (function () { ${read("src/core.js")}
  ; cfg.maxVideos = 400; return { cfg, fetchPlaylist, fetchHistory, fetchSubscriptions }; })(); 1;`;

// ---- a page ------------------------------------------------------------------------------
async function open(browser, url, withMute) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  await p.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  if (withMute) await p.evaluateOnNewDocument(AT_START);
  await p.goto(YT + url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2500);
  if (withMute) {
    await p.addStyleTag({ content: read("styles.css") });
    await p.evaluate(MUTE_CODE);
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
      const el = document.querySelector(".ytcs-menuitem");
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
  const btn = await menuButton(p, kind);
  if (!btn) return ["no " + kind + " with a ⋮ menu in view"];
  await p.mouse.click(btn.x, btn.y);
  const it = await menuItem(p, kind === "short" ? 4500 : 2000);
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
];

// ---- running them ------------------------------------------------------------------------
async function runAll(browser, checks, stamp, lines, failed) {
  for (const c of checks) {
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
          if (await signedIn(browser)) await runAll(browser, SIGNED_IN, stamp, lines, failed);
          else {
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
