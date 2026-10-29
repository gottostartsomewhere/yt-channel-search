/*
 * node tools/store-shots.js mute|playlist [--light]
 *
 * Chrome Web Store screenshots (1280x800) of the real extension on live YouTube, signed out, in a throwaway
 * profile: the content scripts loaded into the page the way the browser check does it. Dark by default, because
 * YouTube ignores prefers-color-scheme when signed out; its dark theme is the `dark` attribute on <html>.
 *   mute      the ⋮ menu on a search result, Needle's row under the pointer  -> docs/shot-mute-dark.png
 *   playlist  the panel on a public course playlist: total length            -> docs/shot-playlist-length-dark.png
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..") + "/";
const OUT = ROOT + "docs/";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DARK = !process.argv.includes("--light");
const read = (f) => fs.readFileSync(ROOT + f, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = JSON.parse(read("manifest.json"));
const iso = manifest.content_scripts.find((c) => c.run_at === "document_idle" && !c.world).js;

// chrome.* stood in for, inside the content scripts' own scope
const STUB = `
  const __store = { sync: {}, local: { omniIntroSeen: true } }, __listeners = [];
  const __area = (name) => ({
    get(d, cb) { const out = {}; const keys = d === null ? Object.keys(__store[name]) : typeof d === "string" ? [d] : Array.isArray(d) ? d : Object.keys(d || {});
      for (const k of keys) out[k] = k in __store[name] ? __store[name][k] : (d && typeof d === "object" && !Array.isArray(d) ? d[k] : undefined);
      setTimeout(() => cb && cb(out), 0); },
    set(o, cb) { const ch = {}; for (const k in o) { ch[k] = { newValue: o[k] }; __store[name][k] = o[k]; } setTimeout(() => { for (const fn of __listeners) fn(ch, name); cb && cb(); }, 0); },
    remove(k, cb) { delete __store[name][k]; setTimeout(() => cb && cb(), 0); },
  });
  const chrome = { runtime: { id: "shot", lastError: null, getManifest: () => ({ version: ${JSON.stringify(manifest.version)} }), sendMessage() {}, onMessage: { addListener() {} } },
    storage: { sync: __area("sync"), local: __area("local"), onChanged: { addListener: (fn) => __listeners.push(fn) } } };
`;
const BUNDLE = "(function () {\n" + STUB + iso.map((f) => "\n" + read(f)).join("\n") + "\n})();\n" + read("src/navigate.js") + "\n1;";
// YouTube's ad slots, and the Shorts shelf it drops into search (strangers' thumbnails, often lurid), neither of
// which belongs in a store listing
const NO_ADS = `ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-search-pyv-renderer, ytd-promoted-video-renderer,
  ytd-banner-promo-renderer, #masthead-ad, ytd-statement-banner-renderer, ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
  ytd-reel-shelf-renderer, grid-shelf-view-model { display: none !important; }`;

async function rig(url) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "needle-shot-")), args: ["--lang=en-US", "--hide-scrollbars"] });
  const p = await b.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", String(e.message).slice(0, 160)));
  // content scripts are exempt from YouTube's CSP (Trusted Types included); code put into the page is not
  await p.setBypassCSP(true);
  await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  await p.evaluateOnNewDocument(read("src/arrive.js") + "\n" + read("src/cards.js") + "\n" + read("src/feedmap.js"));
  // YouTube's own appearance setting (f6=400 is Dark), so every part of the page is drawn dark from the start; the
  // attribute below only catches anything that slips through
  await p.setCookie({ name: "PREF", value: DARK ? "f6=400&hl=en" : "hl=en", domain: ".youtube.com", path: "/" });
  await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  if (DARK) await p.evaluate(() => { for (const el of [document.documentElement, document.querySelector("ytd-app"), document.querySelector("ytd-masthead")]) if (el) el.setAttribute("dark", ""); });
  await sleep(2500);
  await p.addStyleTag({ content: read("styles.css") + "\n" + NO_ADS });
  await p.evaluate(BUNDLE);
  await sleep(2000);
  return { b, p };
}
const out = (name) => OUT + name + (DARK ? "-dark" : "") + ".png";

const SHOTS = {
  async mute() {
    const { b, p } = await rig("https://www.youtube.com/results?search_query=" + (process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "deep+sea+documentary"));
    // a result near the top, its ⋮ button
    const btn = await p.evaluate(() => {
      for (const a of document.querySelectorAll("ytd-video-renderer a#thumbnail[href*='/watch?v=']")) {
        const r0 = a.getBoundingClientRect();
        if (r0.top < 100 || r0.top > 300) continue;
        const bt = [...a.closest("ytd-video-renderer").querySelectorAll("button")].find((x) => x.getBoundingClientRect().width > 0 && /action|more/i.test(x.getAttribute("aria-label") || ""));
        if (!bt) continue;
        const r = bt.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    });
    if (!btn) throw new Error("no result in view");
    await p.mouse.click(btn.x, btn.y);
    for (let i = 0; i < 40 && !(await p.$(".ytcs-ytrow")); i++) await sleep(250);
    await sleep(600);
    const it = await p.evaluate(() => { const el = document.querySelector(".ytcs-ytrow"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.35, y: r.y + r.height / 2, text: el.innerText.trim() }; });
    if (!it) throw new Error("no Mute row in the menu");
    console.log("row:", it.text);
    await p.mouse.move(it.x, it.y);
    await sleep(500);
    await p.screenshot({ path: out("shot-mute") });
    await b.close();
    return out("shot-mute");
  },
  async playlist() {
    // a real course playlist, found the way anyone would: YouTube's search, Playlists filter
    const finder = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--lang=en-US"] });
    const fp = await finder.newPage();
    await fp.goto("https://www.youtube.com/results?search_query=crash+course+astronomy&sp=EgIQAw%253D%253D", { waitUntil: "networkidle2", timeout: 60000 });
    const list = await fp.evaluate(() => { const a = document.querySelector("a[href*='list=PL']"); return a ? new URL(a.href).searchParams.get("list") : ""; });
    await finder.close();
    if (!list) throw new Error("no playlist found");
    const { b, p } = await rig("https://www.youtube.com/playlist?list=" + list);
    const l = await p.evaluate(() => { const x = document.querySelector(".ytcs-launcher"); if (!x) return null; const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (!l) throw new Error("no launcher");
    await p.mouse.click(l.x, l.y);
    for (let i = 0; i < 60; i++) { await sleep(500); if (/Total length/.test(await p.evaluate(() => (document.querySelector(".ytcs-stats") || {}).innerText || ""))) break; }
    await p.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll("*")) if (el.scrollTop) el.scrollTop = 0; });
    await p.mouse.move(1270, 790);
    // the panel's thumbnails are lazy, and a headless page that never scrolls can leave them unloaded: ask for the
    // ones on screen now, and wait until each has arrived
    await p.evaluate(() => { for (const im of document.querySelectorAll(".ytcs-thumb img")) { im.loading = "eager"; const s = im.src; im.src = ""; im.src = s; } });
    for (let i = 0; i < 60; i++) {
      const ready = await p.evaluate(() => { const on = [...document.querySelectorAll(".ytcs-thumb img")].filter((im) => { const r = im.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
        return on.length > 0 && on.every((im) => im.complete && im.naturalWidth > 0); });
      if (ready) break;
      await sleep(250);
    }
    await sleep(800);
    console.log("stats:", (await p.evaluate(() => (document.querySelector(".ytcs-stats") || {}).innerText || "")).replace(/\s+/g, " "));
    await p.screenshot({ path: out("shot-playlist-length") });
    await b.close();
    return out("shot-playlist-length");
  },
};

(async () => {
  const name = process.argv[2];
  if (!SHOTS[name]) throw new Error("which shot? " + Object.keys(SHOTS).join(", "));
  console.log("saved", await SHOTS[name]());
})().catch((e) => { console.error(e.message); process.exit(1); });
