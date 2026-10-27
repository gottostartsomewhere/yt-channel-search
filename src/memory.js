/*
 * Needle for YouTube
 * What the extension remembers across searches, which YouTube's search does
 * not: what you have already been shown, channels you muted, searches you
 * follow, and an index of the channels you actually watch. Plus the language
 * test behind lang:.
 *
 * Everything here lives on this device. Two small lists, muted channels and
 * followed searches, sit in the browser's synced storage so they follow you
 * between your own computers; nothing reaches the author or anyone else.
 *
 * Loaded as an ordered content script, after library.js, so every module shares
 * one scope. See the js array in manifest.json for the order.
 */

// ---- shown before (is:fresh) --------------------------------------------------
/*
 * YouTube keeps serving the same twenty videos. This remembers which ones it
 * has already put on your screen, so is:fresh can leave them out.
 *
 * "Shown" means actually on screen: a result card counts once most of it has
 * been visible, not when YouTube loads it off the bottom of the page. And a
 * search is judged against what you had seen before it opened, so the videos
 * on this page do not vanish from it the moment you look at them.
 */
const SEEN_KEY = "__seen";
const SEEN_LIMIT = 20000;
const seen = { map: null, before: new Set(), page: "", timer: 0, dirty: false, obs: null, watched: new WeakSet() };

async function loadSeen() {
  if (seen.map) return seen.map;
  const rec = await idbGet(SEEN_KEY);
  seen.map = (rec && rec.ids) || Object.create(null);
  return seen.map;
}

// Called as a results page opens: freeze what counts as "before".
async function beginSeenPage() {
  const map = await loadSeen();
  // A short token per page view, not the URL: it is stored beside every id,
  // and twenty thousand copies of a results URL would be a megabyte of nothing.
  seen.page = Date.now().toString(36);
  seen.before = new Set(Object.keys(map));
}

function markSeen(id) {
  if (!id || !seen.map || !isSearchPage()) return;
  const cur = seen.map[id];
  // Once per page view, however often the card scrolls past.
  if (cur && cur[2] === seen.page) return;
  seen.map[id] = [(cur ? cur[0] : 0) + 1, Date.now(), seen.page];
  seen.dirty = true;
  clearTimeout(seen.timer);
  seen.timer = setTimeout(saveSeen, 3000);
}

async function saveSeen() {
  if (!seen.dirty || !seen.map) return;
  seen.dirty = false;
  const ids = Object.keys(seen.map);
  if (ids.length > SEEN_LIMIT) {
    ids.sort((a, b) => seen.map[a][1] - seen.map[b][1]);
    for (const id of ids.slice(0, ids.length - SEEN_LIMIT)) delete seen.map[id];
  }
  await idbPut(SEEN_KEY, { ids: seen.map });
}

// Watches a card until most of it has been on screen once, then records it.
function observeShown(el, id) {
  if (!id || seen.watched.has(el)) return;
  seen.watched.add(el);
  if (!seen.obs) {
    seen.obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        markSeen(e.target.dataset.ytcsSeen);
        seen.obs.unobserve(e.target);
      }
    }, { threshold: 0.6 });
  }
  el.dataset.ytcsSeen = id;
  seen.obs.observe(el);
}

// Not shown in an earlier search, and not watched or started.
function isFresh(v) {
  if (seen.before.has(v.id)) return false;
  if (watchState(v) !== "new") return false;
  const lib = typeof libraryIndex === "function" ? libraryIndex().get(v.id) : null;
  return !(lib && lib.hist);
}

// ---- muted channels ---------------------------------------------------------------
/*
 * YouTube's "Don't recommend channel" never touches search, and often not even
 * the sidebar. These do: a muted channel leaves search, Home, Subscriptions and
 * the videos beside the one you're watching, and a muted word takes any video
 * whose title has it. Your own lists, a channel's own page and Shorts you open
 * are left alone, since something you went to on purpose is not noise.
 *
 * A channel is kept by up to three things: its UC... id, which never changes,
 * its @handle and its name, for whichever one a card happens to show.
 *
 * Kept in local storage, not sync. Chrome's sync allows about 8KB per list,
 * which is around a hundred channels, and the reason to bring a list over from
 * another blocker is that it is long. Lists kept in sync by older versions move across once.
 */
// `ver` goes up with every change, so Mute can tell a card it already judged needs judging again.
const muted = { list: [], words: [], ver: 0 };
const MUTE_MAX = 5000;

function onMutedChange() {
  muted.ver++;
  if (typeof muteScan === "function") muteScan();
}

function loadMuted() {
  try {
    chrome.storage.local.get({ muted: null, mutedWords: [] }, (got) => {
      if (chrome.runtime.lastError || !got) return;
      muted.words = got.mutedWords || [];
      if (got.muted) {
        muted.list = got.muted;
        onMutedChange();
        return;
      }
      // Once: whatever an older version kept in sync comes across.
      chrome.storage.sync.get({ muted: [] }, (old) => {
        muted.list = (old && old.muted) || [];
        chrome.storage.local.set({ muted: muted.list });
        onMutedChange();
      });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(changes.muted || changes.mutedWords)) return;
      if (changes.muted) muted.list = changes.muted.newValue || [];
      if (changes.mutedWords) muted.words = changes.mutedWords.newValue || [];
      onMutedChange();
    });
  } catch (e) { /* no extension context */ }
}

function saveMuted() {
  muted.ver++;
  try { chrome.storage.local.set({ muted: muted.list, mutedWords: muted.words }); } catch (e) { /* ignore */ }
}

/*
 * Whether a video is muted, given whatever is known about who made it: ids,
 * handles and names (arrays, since a collab has two of each) and its title.
 * Ids and handles are trusted first; a name is only compared when one side
 * knows nothing better, because two channels can share a name and only one of
 * them was muted.
 */
function muteReason(who) {
  if (!muted.list.length && !muted.words.length) return "";
  const ids = who.channelIds || [], handles = who.handles || [];
  const names = (who.names || []).map((n) => String(n).toLowerCase().trim()).filter(Boolean);
  for (const m of muted.list) {
    const sure = (m.channelId && ids.includes(m.channelId)) || (m.handle && handles.includes(m.handle));
    if (sure) return "channel";
    const knowsBetter = (m.channelId || m.handle) && (ids.length || handles.length);
    if (!knowsBetter && m.name && names.includes(m.name)) return "channel";
  }
  if (who.title && muted.words.length && mutedWordIn(who.title)) return "word";
  return "";
}

// The panel's own cards: one channel each, and a title.
function isMuted(v) {
  return !!muteReason({ channelIds: v.channelId ? [v.channelId] : [], handles: v.handle ? [v.handle] : [], names: v.channel ? [v.channel] : [], title: v.title });
}

/*
 * A word matches as a whole word, any case, so muting "AI" leaves "AIRBUS" and
 * "said" alone. A phrase matches as written. Letters in any script count as
 * letters, so it works for titles that are not in English.
 */
let wordsRe = null, wordsSig = "";
function mutedWordIn(title) {
  const sig = muted.words.join("\u0001");
  if (sig !== wordsSig) {
    wordsSig = sig;
    const parts = muted.words.map((w) => String(w).trim()).filter(Boolean)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    wordsRe = parts.length ? new RegExp("(?<![\\p{L}\\p{N}])(?:" + parts.join("|") + ")(?![\\p{L}\\p{N}])", "iu") : null;
  }
  return !!wordsRe && wordsRe.test(title);
}

// What a muted channel looks like stored: lowercase name and handle, its id as is.
function muteEntry(name, handle, channelId) {
  return {
    name: String(name || "").toLowerCase().trim(),
    handle: String(handle || "").toLowerCase().replace(/^@/, "").trim(),
    channelId: /^UC[\w-]{22}$/.test(channelId || "") ? channelId : "",
  };
}

function sameChannel(a, b) {
  return (a.channelId && a.channelId === b.channelId) || (a.handle && a.handle === b.handle) ||
    (!a.channelId && !a.handle && !b.channelId && !b.handle && a.name && a.name === b.name);
}

// Returns the stored entry, new or the one already there (filled in with
// anything it was missing), or null when there was nothing to go on.
function muteChannel(name, handle, channelId) {
  const entry = muteEntry(name, handle, channelId);
  if (!entry.name && !entry.handle && !entry.channelId) return null;
  const old = muted.list.find((m) => sameChannel(m, entry));
  if (old) {
    const merged = { name: old.name || entry.name, handle: old.handle || entry.handle, channelId: old.channelId || entry.channelId };
    muted.list = muted.list.map((m) => (m === old ? merged : m));
    saveMuted();
    return merged;
  }
  muted.list = muted.list.concat([entry]).slice(-MUTE_MAX);
  saveMuted();
  return entry;
}

function unmuteChannel(entry) {
  muted.list = muted.list.filter((m) => !(m.name === entry.name && m.handle === entry.handle && (m.channelId || "") === (entry.channelId || "")));
  saveMuted();
}

// ---- followed searches -------------------------------------------------------------
/*
 * A search you follow is re-run quietly now and then, and anything new that
 * fits its filters is waiting for you in the search bar ("3 new"). YouTube used
 * to let people subscribe to topics and stopped; this is that, for a search.
 *
 * The definition is just the query as typed, filters and all ("rust async
 * <30m"), so it reads back as what you asked for and syncs in a few bytes.
 * What each one has already shown you lives on this device.
 *
 * A check asks YouTube for this month's uploads matching the query, using its
 * own strict upload-date filter, so what comes back is new by construction and
 * the local filters only have to tighten it. First check sets the baseline:
 * nothing is "new" just because you followed it.
 */
const FOLLOW_KEY = "__follows";
const FOLLOW_EVERY = 6 * 3600 * 1000;
const FOLLOW_MAX = 20;
const follows = { list: [], state: null, running: false, listeners: [] };

function followId(q) {
  return "f" + String(q).trim().toLowerCase().replace(/\s+/g, " ").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
}

function loadFollows() {
  try {
    chrome.storage.sync.get({ follows: [] }, (got) => {
      if (!chrome.runtime.lastError && got) follows.list = got.follows || [];
      followsChanged();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.follows) {
        follows.list = changes.follows.newValue || [];
        followsChanged();
      }
    });
  } catch (e) { /* no extension context */ }
}

async function followState() {
  if (!follows.state) follows.state = (await idbGet(FOLLOW_KEY)) || {};
  return follows.state;
}
async function saveFollowState() {
  await idbPut(FOLLOW_KEY, follows.state || {});
}

function onFollowsChange(fn) { follows.listeners.push(fn); }
function followsChanged() {
  for (const fn of follows.listeners) { try { fn(); } catch (e) { /* keep going */ } }
  updateBadge();
}

function isFollowing(q) {
  const id = followId(q);
  return follows.list.some((f) => f.id === id);
}

async function follow(q) {
  q = String(q).trim();
  if (!q || isFollowing(q)) return;
  const entry = { id: followId(q), q, at: Date.now() };
  follows.list = follows.list.concat([entry]).slice(-FOLLOW_MAX);
  try { chrome.storage.sync.set({ follows: follows.list }); } catch (e) { /* ignore */ }
  followsChanged();
  // The baseline, straight away, so the first real check has something to
  // compare against.
  await checkFollow(entry, true);
}

async function unfollow(q) {
  const id = followId(q);
  follows.list = follows.list.filter((f) => f.id !== id);
  try { chrome.storage.sync.set({ follows: follows.list }); } catch (e) { /* ignore */ }
  const st = await followState();
  delete st[id];
  await saveFollowState();
  followsChanged();
}

// The InnerTube key and client version, published on <html> by navigate.js so
// a check can call the API without first downloading a whole results page.
function pageInnertube() {
  const root = document.documentElement;
  const apiKey = root.getAttribute("data-ytcs-key");
  const clientVersion = root.getAttribute("data-ytcs-ver");
  return apiKey && clientVersion ? { apiKey, clientVersion } : null;
}

async function checkFollow(entry, baseline) {
  const f = parseOmniQuery(entry.q);
  if (!f.query) return;
  const it = pageInnertube();
  const ctx = {
    query: f.query, apiKey: it ? it.apiKey : "", clientVersion: it ? it.clientVersion : FALLBACK_VER,
    sessions: {}, seen: new Set(), partial: false, auth: null,
  };
  const plan = searchPlan(decodeSp(compileSp(f)), { minDur: f.minDur, maxDur: f.maxDur, sort: f.sort, maxAge: Math.min(f.maxAge, 31) });
  const got = [];
  try {
    await searchMore(ctx, plan, 100, got, () => {});
  } catch (e) {
    return;
  }
  const st = await followState();
  const rec = st[entry.id] || { seen: [], fresh: [], lastCheck: 0 };
  const known = new Set(rec.seen);
  for (const v of rec.fresh) known.add(v.id);
  const fits = got.filter((v) => passesFilters(v, f));
  if (baseline) {
    rec.seen = fits.map((v) => v.id);
    rec.fresh = [];
  } else {
    const add = fits.filter((v) => !known.has(v.id)).map(slimVideo);
    rec.fresh = add.concat(rec.fresh).slice(0, 50);
  }
  rec.lastCheck = Date.now();
  st[entry.id] = rec;
  await saveFollowState();
  followsChanged();
}

// Just enough of a video to draw a row and a card later.
function slimVideo(v) {
  return {
    id: v.id, title: v.title, channel: v.channel, handle: v.handle, seconds: v.seconds,
    views: v.views, days: v.days, publishedText: v.publishedText, progress: v.progress,
  };
}

// A few at a time, and each at most every six hours, so following twenty
// searches never turns into twenty requests every time YouTube opens.
async function checkFollows() {
  if (follows.running || !follows.list.length) return;
  follows.running = true;
  try {
    const st = await followState();
    const due = follows.list.filter((f) => !st[f.id] || Date.now() - st[f.id].lastCheck > FOLLOW_EVERY);
    for (const entry of due.slice(0, 3)) await checkFollow(entry, !st[entry.id]);
  } finally {
    follows.running = false;
  }
}

// Followed searches with something new, newest first.
async function followsWithNews() {
  const st = await followState();
  return follows.list
    .map((f) => ({ entry: f, fresh: (st[f.id] && st[f.id].fresh) || [], lastCheck: st[f.id] ? st[f.id].lastCheck : 0 }))
    .filter((x) => x.fresh.length)
    .sort((a, b) => b.lastCheck - a.lastCheck);
}

// Opening a followed search's news: they stop being new.
async function markFollowRead(q) {
  const st = await followState();
  const rec = st[followId(q)];
  if (!rec || !rec.fresh.length) return [];
  const ids = rec.fresh.map((v) => v.id);
  rec.seen = rec.seen.concat(ids).slice(-2000);
  rec.fresh = [];
  await saveFollowState();
  followsChanged();
  return ids;
}

// The toolbar icon shows how many new videos are waiting across all of them.
async function updateBadge() {
  const st = await followState();
  let n = 0;
  for (const f of follows.list) n += (st[f.id] && st[f.id].fresh.length) || 0;
  try { chrome.runtime.sendMessage({ type: "ytcs-badge", n }); } catch (e) { /* ignore */ }
}

// ---- channels you watch -----------------------------------------------------------------
/*
 * A private search engine over the creators you actually watch: their whole
 * back catalogues, searched instantly with every filter. YouTube's search ranks
 * every creator against every other, and there is no way to say "only these".
 *
 * The channels come from your own history, the ones you keep returning to, so
 * nothing needs your subscriptions. Their catalogues are read with the same
 * reader the panel uses and land in the same cache, one channel per visit and
 * no more than one every ten minutes, so building it never costs a noticeable
 * burst. After that each one is only re-read once a week.
 */
const INDEX_CHANNELS = 15;
const INDEX_EVERY = 10 * 60 * 1000;
const INDEX_STALE = 7 * 86400000;
const INDEX_LAST_KEY = "indexLast";
const chIndex = { videos: null, at: 0, building: false };

// The channels to index: seen in your history at least twice, most frequent first.
function watchedChannels() {
  const counts = new Map();
  for (const v of library.hist.concat(library.liked)) {
    if (!v.handle) continue;
    const c = counts.get(v.handle) || { handle: v.handle, name: v.channel, n: 0 };
    c.n++;
    counts.set(v.handle, c);
  }
  return Array.from(counts.values()).filter((c) => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, INDEX_CHANNELS);
}

async function growIndex() {
  if (!cfg.channelIndex || chIndex.building || document.visibilityState === "hidden") return;
  const last = await new Promise((res) => {
    try { chrome.storage.local.get({ [INDEX_LAST_KEY]: 0 }, (g) => res((g && g[INDEX_LAST_KEY]) || 0)); } catch (e) { res(0); }
  });
  if (Date.now() - last < INDEX_EVERY) return;
  await loadLibrary();
  const want = watchedChannels();
  let pick = null;
  for (const c of want) {
    const rec = await idbGet("/@" + c.handle);
    if (!rec || !rec.fetchedAt || Date.now() - rec.fetchedAt > INDEX_STALE) { pick = c; break; }
  }
  if (!pick) return;
  chIndex.building = true;
  try {
    try { chrome.storage.local.set({ [INDEX_LAST_KEY]: Date.now() }); } catch (e) { /* ignore */ }
    const cat = await fetchCatalogFrom(location.origin + "/@" + pick.handle + "/videos", () => {});
    await persistCatalog("/@" + pick.handle, cat);
    chIndex.videos = null;
  } catch (e) {
    /* one channel failing is not worth surfacing; the next visit tries the next */
  } finally {
    chIndex.building = false;
  }
}

// Every indexed video, each carrying its channel's name, which a channel's own
// grid never includes.
async function indexVideos() {
  if (chIndex.videos && Date.now() - chIndex.at < 60000) return chIndex.videos;
  await loadLibrary();
  const out = [];
  let channels = 0;
  for (const c of watchedChannels()) {
    const rec = await idbGet("/@" + c.handle);
    if (!rec || !rec.videos) continue;
    channels++;
    for (const v of rec.videos) {
      if (v.isShort) continue;
      out.push(Object.assign({}, v, { channel: c.name, handle: c.handle }));
    }
  }
  out.channels = channels;
  chIndex.videos = out;
  chIndex.at = Date.now();
  return out;
}

async function indexStatus() {
  await loadLibrary();
  const want = watchedChannels();
  let done = 0;
  for (const c of want) if (await idbGet("/@" + c.handle)) done++;
  return { done, total: want.length };
}

// ---- language (lang:) ----------------------------------------------------------------------
/*
 * YouTube has no language filter, so results arrive mixed. Titles are judged
 * by the script they are written in, which is reliable: Hindi is Devanagari,
 * Russian Cyrillic, Japanese kana. Between languages sharing an alphabet it can
 * only go by common words, so an English filter drops a title only when it is
 * clearly Spanish or French, never merely because it is short.
 */
const LANGS = {
  en: { name: "English", script: "latin" }, es: { name: "Spanish", script: "latin" },
  pt: { name: "Portuguese", script: "latin" }, fr: { name: "French", script: "latin" },
  de: { name: "German", script: "latin" }, it: { name: "Italian", script: "latin" },
  id: { name: "Indonesian", script: "latin" },
  hi: { name: "Hindi", script: "devanagari" }, mr: { name: "Marathi", script: "devanagari" },
  bn: { name: "Bengali", script: "bengali" }, ta: { name: "Tamil", script: "tamil" },
  te: { name: "Telugu", script: "telugu" }, kn: { name: "Kannada", script: "kannada" },
  ml: { name: "Malayalam", script: "malayalam" }, gu: { name: "Gujarati", script: "gujarati" },
  pa: { name: "Punjabi", script: "gurmukhi" }, ur: { name: "Urdu", script: "arabic" },
  ar: { name: "Arabic", script: "arabic" }, ru: { name: "Russian", script: "cyrillic" },
  uk: { name: "Ukrainian", script: "cyrillic" }, el: { name: "Greek", script: "greek" },
  he: { name: "Hebrew", script: "hebrew" }, th: { name: "Thai", script: "thai" },
  ko: { name: "Korean", script: "hangul" }, ja: { name: "Japanese", script: "japanese" },
  zh: { name: "Chinese", script: "han" },
};
const SCRIPTS = [
  ["latin", /[A-Za-z\u00C0-\u024F]/], ["devanagari", /[\u0900-\u097F]/], ["bengali", /[\u0980-\u09FF]/],
  ["gurmukhi", /[\u0A00-\u0A7F]/], ["gujarati", /[\u0A80-\u0AFF]/], ["tamil", /[\u0B80-\u0BFF]/],
  ["telugu", /[\u0C00-\u0C7F]/], ["kannada", /[\u0C80-\u0CFF]/], ["malayalam", /[\u0D00-\u0D7F]/],
  ["thai", /[\u0E00-\u0E7F]/], ["cyrillic", /[\u0400-\u04FF]/], ["greek", /[\u0370-\u03FF]/],
  ["hebrew", /[\u0590-\u05FF]/], ["arabic", /[\u0600-\u06FF\u0750-\u077F]/], ["hangul", /[\uAC00-\uD7AF\u1100-\u11FF]/],
  ["kana", /[\u3040-\u30FF]/], ["han", /[\u4E00-\u9FFF]/],
];
const LANG_STOPWORDS = {
  en: "the and you your with this that how what why for are was from have will not can all about best",
  es: "el la los las que por para con una del como más pero muy este esta cómo qué",
  pt: "o os as que não uma com para como mais pelo pela você isso muito são",
  fr: "le la les des une est pour que qui dans avec pas sur comment vous cette",
  de: "der die das und ist nicht mit ein eine für auf wie ich sie auch dem",
  it: "il lo gli della che non una per con come sono questo anche",
  id: "yang dan di ini itu dengan untuk tidak dari cara apa ada",
};
const LANG_STOPSETS = Object.fromEntries(Object.entries(LANG_STOPWORDS).map(([k, v]) => [k, new Set(v.split(" "))]));

function dominantScript(text) {
  const counts = {};
  for (const ch of String(text)) {
    for (const [name, re] of SCRIPTS) {
      if (re.test(ch)) { counts[name] = (counts[name] || 0) + 1; break; }
    }
  }
  // Kana decides Japanese even beside Han, which Japanese titles always mix in.
  if (counts.kana) return "japanese";
  let best = "", n = 0;
  for (const k in counts) if (counts[k] > n) { best = k; n = counts[k]; }
  return best;
}

// Which Latin-script language a title is clearly in, or "" when it is not clear.
function latinGuess(text) {
  const words = String(text).toLowerCase().match(/[a-zà-öø-ÿ']+/g) || [];
  const score = {};
  for (const w of words) for (const k in LANG_STOPSETS) if (LANG_STOPSETS[k].has(w)) score[k] = (score[k] || 0) + 1;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return "";
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return "";
  return ranked[0][1] >= 2 || !ranked[1] ? ranked[0][0] : "";
}

function langMatches(title, code) {
  const lang = LANGS[code];
  if (!lang) return true;
  const script = dominantScript(title);
  if (!script) return true;
  if (lang.script !== "latin") return script === lang.script;
  if (script !== "latin") return false;
  const guess = latinGuess(title);
  return !guess || guess === code;
}

// ---- wiring --------------------------------------------------------------------------------
if (!window.__ytcsMemoryLoaded) {
  window.__ytcsMemoryLoaded = true;
  loadMuted();
  loadFollows();
  // Quiet work, well after the page has settled and only while it is being
  // looked at: follow checks and one step of the channel index.
  setTimeout(() => {
    checkFollows();
    growIndex();
  }, 8000);
  setInterval(() => {
    checkFollows();
    growIndex();
  }, 15 * 60 * 1000);
  window.addEventListener("pagehide", () => { saveSeen(); });
}
