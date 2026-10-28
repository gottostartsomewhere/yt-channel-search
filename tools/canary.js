/*
 * node tools/canary.js [--notify] [--test-alert]
 *
 * The daily check. YouTube changes how it sends its pages without telling
 * anyone, and the first sign used to be a user who quietly uninstalled. This
 * reads a few live public YouTube pages with Needle's own src/core.js, the same
 * code the extension ships, and does two things with them.
 *
 * It checks the videos that come back look right: enough of them, paging past
 * the first page, and the fields Needle needs (length, views, age, who made it)
 * actually filled in. That catches a break.
 *
 * And it records which parts YouTube built each page from, and says when one
 * appears or disappears. YouTube tries a new layout on some people for weeks
 * before everyone gets it, so this is the warning that comes before the break.
 * Each time the shape changes, that day's page is kept in tools/fixtures/, so
 * tools/fixtures-test.js can check every fix against every shape seen so far.
 *
 * Exit 0 when every check passes, 1 when one fails. Each run appends to
 * tools/canary-log.txt. With --notify, a failure or a change also pops a Windows
 * notification, which is how the scheduled run tells you.
 *
 * Public pages only. Watch Later, Liked and history need a signed-in account,
 * so those stay a quick check in your own browser once a week.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadCore, cardKinds, sidebarCards, muteSearchCards, channelShorts } = require("./yt-harness");

const LOG = path.join(__dirname, "canary-log.txt");
const SHAPES = path.join(__dirname, "canary-shapes.json");
const FIXTURES = path.join(__dirname, "fixtures");
const ORIGIN = "https://www.youtube.com";

// The first video the channel check finds, for the watch page check to open,
// and the Shorts the Shorts check finds, for the oEmbed check to ask about.
let someVideo = "";
let someShorts = [];

// The data a page was built from. Now and then YouTube answers a quick run of
// requests with an empty page; one more try a moment later is enough, and a
// second empty one is real.
async function pageData(core, url) {
  for (let i = 0; i < 2; i++) {
    const data = core.findJson(await (await core.fetch(url)).text(), "ytInitialData");
    if (data && Object.keys(data).length) return data;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

/*
 * What a healthy read looks like. `min` is above one page where paging matters,
 * so a read that silently stops after page one fails here instead of passing
 * with 30. `share` is how much of the list must carry a field: a few live
 * streams and premieres have no length, so it is never all of them.
 *
 * `parse` is the same reading done on one saved page, for the fixture tests,
 * and `fixtureMin` what one page should give.
 */
const CHECKS = [
  {
    key: "channel",
    name: "channel videos (@veritasium)",
    read: async (c) => {
      const list = await c.fetchCatalogFrom(ORIGIN + "/@veritasium/videos", () => {});
      if (list[0]) someVideo = list[0].id;
      return list;
    },
    parse: (c, data) => c.parseItemArray(c.deepFind(data, "richGridRenderer").contents).videos,
    min: 60, fixtureMin: 20,
    fields: { title: 0.95, seconds: 0.9, views: 0.9, days: 0.9 },
  },
  {
    key: "playlist",
    name: "public playlist (Veritasium uploads)",
    read: (c) => c.fetchPlaylist("UUHnyfMqiRRG1u-2MsSQLbXA", false, () => {}),
    parse: (c, data) => c.parsePlaylistItems(c.playlistEntries(c.playlistRoot(data)), ""),
    min: 101, fixtureMin: 50,
    fields: { title: 0.95, seconds: 0.9, views: 0.9 },
  },
  {
    key: "search",
    name: "search results (\"total solar eclipse\")",
    read: (c) => c.fetchSearch("total solar eclipse", () => {}, false),
    parse: (c, data) => c.parseSearchItems(c.deepFind(data, "sectionListRenderer").contents).videos,
    min: 20, fixtureMin: 10,
    // `channel`: muting needs to know who made each result.
    fields: { title: 0.95, seconds: 0.8, views: 0.8, days: 0.8, channel: 0.8 },
  },
  {
    key: "sidebar",
    name: "watch page sidebar (what plays next)",
    read: async (c) => {
      if (!someVideo) throw new Error("no video to open: the channel check found none");
      return sidebarCards(c, await pageData(c, "/watch?v=" + someVideo));
    },
    parse: (c, data) => sidebarCards(c, data),
    min: 8, fixtureMin: 8,
    // Mute reads these cards in the page with src/cards.js: who made each, and its title.
    fields: { channel: 0.8, title: 0.8 },
  },
  {
    key: "mutesearch",
    name: "search results as Mute sees them (src/cards.js)",
    // Videos only (sp=EgIQAQ): a Short in search carries no channel in YouTube's
    // data at all, so muting by channel cannot reach Shorts shelves, only words can.
    read: async (c) => muteSearchCards(await pageData(c, "/results?search_query=" + encodeURIComponent("electric cars") + "&sp=EgIQAQ%253D%253D")),
    parse: (c, data) => muteSearchCards(data),
    min: 10, fixtureMin: 10,
    fields: { channel: 0.8, title: 0.95 },
  },
  {
    key: "shorts",
    name: "channel Shorts tab",
    read: async (c) => {
      const list = channelShorts(c, await pageData(c, "/@veritasium/shorts"));
      someShorts = Array.from(list).map((v) => v.id);
      return list;
    },
    parse: (c, data) => channelShorts(c, data),
    min: 10, fixtureMin: 10,
    fields: { title: 0.9 },
  },
  {
    key: "oembed",
    name: "who made a Short (YouTube's oEmbed, for Mute)",
    // Not a page: no shape to track, nothing to save.
    page: false,
    read: async () => {
      if (!someShorts.length) throw new Error("no Shorts to ask about: the Shorts check found none");
      const out = [];
      for (const id of someShorts.slice(0, 5)) {
        const r = await fetch(ORIGIN + "/oembed?format=json&url=" + encodeURIComponent(ORIGIN + "/watch?v=" + id));
        const j = r.ok ? await r.json() : {};
        const h = String(j.author_url || "").match(/\/@([^/?#]+)/);
        out.push({ id, title: j.title || "", channel: j.author_name || "", handle: h ? h[1].toLowerCase() : "" });
      }
      return out;
    },
    min: 5,
    // Mute matches a Short to a muted channel by handle.
    fields: { title: 1, handle: 1 },
  },
];

const has = {
  title: (v) => !!v.title && v.title !== "(no title)",
  seconds: (v) => v.seconds > 0,
  views: (v) => typeof v.views === "number" && v.views >= 0,
  days: (v) => typeof v.days === "number" && v.days >= 0,
  channel: (v) => !!(v.handle || v.channel || v.channelId),
  handle: (v) => !!v.handle,
};

// Problems with a list of videos, or none. Shared with the fixture tests.
function judge(list, min, fields) {
  const videos = Array.from(list || []).filter((v) => v.playable !== false);
  const problems = [];
  if (videos.length < min) problems.push(`${videos.length} videos, expected at least ${min}`);
  const badIds = videos.filter((v) => !/^[\w-]{11}$/.test(v.id)).length;
  if (badIds) problems.push(`${badIds} without a proper video id`);
  for (const [field, share] of Object.entries(fields)) {
    const got = videos.filter(has[field]).length;
    if (videos.length && got / videos.length < share) problems.push(`${field} on only ${got} of ${videos.length}`);
  }
  return { videos, problems };
}

// ---- the shape: which parts each page was built from, and what changed ----------------
/*
 * A part counts once it appears three times on a page, which is what a card or
 * a row does. Content varies from day to day (a search sometimes includes a
 * movie, sometimes not), so a single one-off is not news. "Gone" means a part
 * that was there in each of the last five runs and is not today.
 */
const STRUCTURAL = 3;
const KEEP_RUNS = 5;

function loadShapes() {
  try { return JSON.parse(fs.readFileSync(SHAPES, "utf8")); } catch (e) { return {}; }
}

function compareShape(state, key, counts, today) {
  const names = Object.keys(counts).filter((n) => counts[n] >= STRUCTURAL).sort();
  const s = state[key] || (state[key] = { seen: {}, recent: [] });
  const first = !s.recent.length;
  const added = first ? [] : names.filter((n) => !s.seen[n]);
  const steady = s.recent.length >= KEEP_RUNS ? s.recent[0].filter((n) => s.recent.every((r) => r.includes(n))) : [];
  const gone = steady.filter((n) => !names.includes(n));
  for (const n of names) if (!s.seen[n]) s.seen[n] = today;
  s.recent = s.recent.concat([names]).slice(-KEEP_RUNS);
  return { first, added: added.map((n) => `${n} (${counts[n]})`), gone };
}

function saveFixture(key, data, today) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const file = path.join(FIXTURES, `${key}-${today}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return path.basename(file);
}

// ---- one check ---------------------------------------------------------------------------
/*
 * An empty page (YouTube's quick-run hiccup, see pageData) is not a new shape:
 * it is not compared, not saved as a fixture, and the whole check gets one more
 * try. Only a second empty page counts as a failure, and the log says that is
 * what it was.
 */
async function runCheck(check, shapes, today) {
  const first = await readOnce(check, shapes, today);
  if (first.ok || !first.empty) return first;
  await new Promise((r) => setTimeout(r, 3000));
  const again = await readOnce(check, shapes, today);
  if (again.empty) again.detail = "YouTube sent an empty page twice (" + again.detail + ")";
  return again;
}

async function readOnce(check, shapes, today) {
  const core = loadCore();
  const t0 = Date.now();
  let list, error = null;
  try { list = await check.read(core); } catch (e) { error = e.message; }
  const secs = ((Date.now() - t0) / 1000).toFixed(1) + "s";

  // The first page YouTube sent, raw, for the shape and the fixture.
  const firstHtml = check.page !== false && core.captured[0] && core.captured[0].text;
  const data = firstHtml ? core.findJson(firstHtml, "ytInitialData") : null;
  const empty = check.page !== false && (!data || !Object.keys(data).length);
  let drift = null, fixture = "";
  if (data && !empty) {
    drift = compareShape(shapes, check.key, cardKinds(data), today);
    const haveOne = fs.existsSync(FIXTURES) && fs.readdirSync(FIXTURES).some((f) => f.startsWith(check.key + "-"));
    if (!haveOne || drift.added.length || drift.gone.length) fixture = saveFixture(check.key, data, today);
  }

  if (error) return { ok: false, empty, detail: "threw: " + error, drift, fixture };
  const { videos, problems } = judge(list, check.min, check.fields);
  return {
    ok: !problems.length,
    empty,
    detail: problems.length ? problems.join("; ") : `${videos.length} videos in ${secs}`,
    drift, fixture,
  };
}

// A plain Windows toast, through PowerShell, so it needs nothing installed.
function notify(title, body) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "''");
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(body)}</text></binding></visual></toast>')
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
  } catch (e) { /* a missed toast is not worth failing the run over; the log still has it */ }
}

if (require.main === module) {
  (async () => {
    // Proves the alert reaches the screen, without waiting for YouTube to break something.
    if (process.argv.includes("--test-alert")) {
      notify("Needle check", "Test alert: if you can read this, failures will reach you.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const shapes = loadShapes();
    const lines = [], failed = [], changed = [];
    for (const check of CHECKS) {
      const r = await runCheck(check, shapes, today);
      lines.push(`${stamp}  ${r.ok ? "PASS" : "FAIL"}  ${check.name}: ${r.detail}`);
      if (r.drift && (r.drift.added.length || r.drift.gone.length)) {
        lines.push(`    CHANGED  new: ${r.drift.added.join(", ") || "none"}  gone: ${r.drift.gone.join(", ") || "none"}`);
        changed.push(check.key);
      }
      if (r.drift && r.drift.first) lines.push("    first run for this page: shape recorded");
      if (r.fixture) lines.push(`    saved tools/fixtures/${r.fixture}`);
      if (!r.ok) failed.push(check.key);
    }
    fs.writeFileSync(SHAPES, JSON.stringify(shapes, null, 1));
    for (const l of lines) console.log(l);
    fs.appendFileSync(LOG, lines.join("\n") + "\n");
    if (process.argv.includes("--notify")) {
      if (failed.length) notify("Needle check failed", `YouTube may have broken something: ${failed.join(", ")}. Details in tools\\canary-log.txt`);
      else if (changed.length) notify("YouTube changed a page", `Still working, but the shape changed on: ${changed.join(", ")}. Worth a look before it breaks. tools\\canary-log.txt`);
    }
    process.exit(failed.length ? 1 : 0);
  })();
}

module.exports = { CHECKS, judge, notify };
