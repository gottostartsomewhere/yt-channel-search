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
