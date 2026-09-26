/*
 * Needle for YouTube
 * Your library (Watch Later, Liked, watch history) and the query grammar the
 * search bar understands.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

/*
 * ---- the cache ---------------------------------------------------------------
 *
 * The search bar's dropdown has to answer inside a keystroke, so it cannot go
 * to the network. The three lists are read once, kept in IndexedDB, and
 * refreshed at most every few hours, and only when somebody actually clicks into
 * the search bar. Nobody who never uses it pays for it.
 *
 * Refreshing reads page one of each list the way opening those pages would.
 * Past page one needs a signed request, which only happens with deep reading on.
 */
const LIB_KEY = "__library";
const LIB_TTL = 3 * 3600 * 1000;
const LIB_NAMES = { wl: "Watch Later", hist: "watch history", liked: "Liked videos", channels: "channels you watch" };
const LIB_ORDER = ["wl", "hist", "liked"];

const library = { wl: [], hist: [], liked: [], at: 0, loaded: false, refreshing: null };
const libListeners = [];

function onLibraryChange(fn) {
  libListeners.push(fn);
}

/*
 * There is deliberately no signed-in check. Reading the cookie to find out
 * would break the promise that page-one reading touches no cookie, and the
 * masthead's markup is not stable enough to guess from: a wrong guess there
 * silently disables this for signed-in people, which is the expensive failure.
 * Signed out, the lists come back empty and the TTL stops it trying again for
 * three hours, which is the cheap one.
 */
function libraryEmpty() {
  return !library.wl.length && !library.hist.length && !library.liked.length;
}

async function loadLibrary() {
  if (!library.loaded) {
    const rec = await idbGet(LIB_KEY);
    if (rec) {
      library.wl = rec.wl || [];
      library.hist = rec.hist || [];
      library.liked = rec.liked || [];
      library.at = rec.at || 0;
    }
    library.loaded = true;
  }
  if (Date.now() - library.at > LIB_TTL) refreshLibrary();
  return library;
}

function refreshLibrary() {
  if (library.refreshing) return library.refreshing;
  if (!cfg.librarySearch) return Promise.resolve(library);

  library.refreshing = (async () => {
    // Each list on its own. One failing keeps its previous copy rather than
    // emptying the dropdown for the other two.
    const read = async (fn, prev) => {
      try { return await fn(); } catch (e) { return prev; }
    };
    const wl = await read(() => fetchPlaylist("WL", cfg.deepHistory), library.wl);
    const liked = await read(() => fetchPlaylist("LL", cfg.deepHistory), library.liked);
    const hist = await read(() => fetchHistory(() => {}, cfg.deepHistory), library.hist);

    library.wl = wl.filter((v) => v.playable !== false);
    library.liked = liked.filter((v) => v.playable !== false);
    library.hist = hist;
    library.at = Date.now();
    await idbPut(LIB_KEY, { wl: library.wl, hist: library.hist, liked: library.liked, at: library.at });
    for (const fn of libListeners) {
      try { fn(); } catch (e) { /* a listener must not stop the others */ }
    }
  })().finally(() => { library.refreshing = null; });
  return library.refreshing;
}

/*
 * ---- the grammar -----------------------------------------------------------
 *
 * Plain words search. Anything else is a filter:
 *
 *   <20m  >45m  <1h  >90s         length (a bare number is minutes)
 *   >100k  >1m views  <5k         view count (k and b are always views; m is
 *                                 minutes unless "views" follows it)
 *   is:unwatched  is:watched      watch state (is:started for half-watched,
 *   unwatched                     and bare "unwatched" as a shortcut)
 *   is:fresh                      nothing you were shown in an earlier search
 *   in:wl  in:history  in:liked   only that list
 *   in:channels                   only the channels you watch, whole catalogues
 *   @veritasium  -@mrbeast        from that channel, or never from it
 *   -shorts                       leave out anything mentioning this
 *   sort:views  sort:newest       order (also longest, shortest, oldest)
 *   after:2023  before:2020-06    upload date (a year, a month, or a day)
 *   date:today  date:week         upload date, YouTube's own windows (also
 *                                 month and year)
 *   watched:august  watched:week  when you watched it (also today, yesterday,
 *                                 last-week, month, last-month, 2026-08)
 *   lang:en  lang:hi              language of the title
 *   is:live is:4k is:hd is:hdr    YouTube's own feature filters, passed straight
 *   is:360 is:vr180 is:3d         through to its search (so they narrow what
 *   has:subtitles is:short        YouTube returns, and only that)
 *   is:movie is:creative-commons
 *
 * The one ambiguity is "m". ">1m" on its own is one minute, because length is
 * what people filter on far more often, and "views" after it switches it to a
 * million. Guessing the other way would make "<20m" mean twenty million views.
 *
 * Watch state needs the is: prefix because the bare words are real searches.
 * "getting started with rust" would otherwise become a filter and send YouTube
 * "getting with rust". "unwatched" alone is exempt because almost nobody
 * searches for it, and it is the one people will reach for first.
 */
const OMNI_SCOPES = {
  wl: "wl", watchlater: "wl", later: "wl", history: "hist", watched: "hist", liked: "liked", likes: "liked",
  channels: "channels", mine: "channels",
};
const OMNI_WATCH = {
  unwatched: "new",
  "is:unwatched": "new", "is:new": "new", "is:unstarted": "new",
  "is:watched": "done", "is:finished": "done", "is:done": "done",
  "is:started": "partial", "is:partial": "partial", "is:half-watched": "partial",
};
const WATCH_WORDS = { new: "Unwatched", done: "Watched", partial: "Started" };
const OMNI_SORTS = {
  views: "views_desc", popular: "views_desc", longest: "duration_desc", long: "duration_desc",
  shortest: "duration_asc", short: "duration_asc", newest: "upload_new", new: "upload_new",
  recent: "upload_new", oldest: "upload_old", old: "upload_old", relevance: "newest",
};
// date: windows, as the widest age in days each covers, named as YouTube does.
const OMNI_DATES = { today: [1, "Today"], week: [7, "This week"], month: [31, "This month"], year: [366, "This year"] };
// YouTube's feature filters by the field number its own dialog uses.
const OMNI_FEATURES = {
  "is:live": [8, "Live"], "is:4k": [14, "4K"], "is:hd": [4, "HD"], "is:hdr": [25, "HDR"],
  "is:360": [15, "360°"], "is:vr180": [26, "VR180"], "is:3d": [7, "3D"], "is:purchased": [9, "Purchased"],
  "has:subtitles": [5, "Subtitles"], "has:cc": [5, "Subtitles"], "has:captions": [5, "Subtitles"],
  "is:creative-commons": [6, "Creative Commons"], "has:location": [23, "Location"],
};
const OMNI_TYPES = { "is:short": [9, "Shorts only"], "is:shorts": [9, "Shorts only"], "is:movie": [4, "Movies only"], "is:movies": [4, "Movies only"] };
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "2023", "2023-06", "2023-06-15" to a local Date, or null.
function parseOmniDate(s) {
  const m = String(s).match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const d = new Date(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
  return isNaN(d) || d > new Date() ? null : d;
}
function ageInDays(d) {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/*
 * watched: values to a range of "days since you watched it", the number every
 * history item already carries, plus the words to show for it. A month name
 * means the most recent one that has started, so in September "watched:august"
 * is last month and "watched:october" is last October.
 */
function watchedRange(value) {
  const today = startOfDay(new Date());
  const span = (from, toExcl, text) => {
    const last = addDays(toExcl, -1);
    return { min: Math.max(0, daysSince(last > today ? today : last, today)), max: daysSince(from, today), text };
  };
  const v = value.toLowerCase();
  if (v === "today") return span(today, addDays(today, 1), "Watched today");
  if (v === "yesterday") return span(addDays(today, -1), today, "Watched yesterday");
  if (v === "week" || v === "this-week") return span(addDays(today, -6), addDays(today, 1), "Watched this week");
  if (v === "last-week") return span(addDays(today, -13), addDays(today, -6), "Watched last week");
  if (v === "month" || v === "this-month") return span(new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1), "Watched this month");
  if (v === "last-month") {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return span(from, new Date(today.getFullYear(), today.getMonth(), 1), "Watched last month");
  }
  let m = v.match(/^([a-z]{3,9})(?:-(\d{4}))?$/);
  if (m) {
    const mi = MONTH_NAMES.findIndex((n) => n.startsWith(m[1]) && m[1].length >= 3);
    if (mi === -1) return null;
    let year = m[2] ? +m[2] : today.getFullYear();
    if (!m[2] && new Date(year, mi, 1) > today) year--;
    const from = new Date(year, mi, 1);
    if (from > today) return null;
    return span(from, new Date(year, mi + 1, 1), "Watched in " + cap(MONTH_NAMES[mi]) + (m[2] ? " " + year : ""));
  }
  m = v.match(/^(\d{4})(?:-(\d{1,2}))?$/);
  if (m) {
    const from = new Date(+m[1], m[2] ? +m[2] - 1 : 0, 1);
    if (from > today) return null;
    const to = m[2] ? new Date(+m[1], +m[2], 1) : new Date(+m[1] + 1, 0, 1);
    return span(from, to, "Watched in " + (m[2] ? cap(MONTH_NAMES[+m[2] - 1]) + " " : "") + m[1]);
  }
  return null;
}

// Says what was typed. ">90s" rounded to "over 2 min" was a different filter.
function fmtLen(sec) {
  if (sec >= 3600 && sec % 3600 === 0) return sec / 3600 + " hr";
  if (sec >= 60 && sec % 60 === 0) return sec / 60 + " min";
  if (sec < 600) return sec + " sec";
  return Math.round(sec / 60) + " min";
}

function parseOmniQuery(raw) {
  const toks = String(raw || "").trim().split(/\s+/).filter(Boolean);
  const f = {
    words: [], chips: [], ops: 0,
    minDur: 0, maxDur: Infinity, minViews: 0, maxViews: Infinity,
    watch: "", scope: "",
    channel: "", notChannels: [], excludes: [], minAge: 0, maxAge: Infinity, sort: "",
    watchedMin: 0, watchedMax: Infinity, watchedText: "",
    lang: "", fresh: false, features: [], type: 0,
  };
  const chip = (text) => { f.chips.push(text); f.ops++; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].toLowerCase();
    const next = (toks[i + 1] || "").toLowerCase();
    let m;

    if ((m = t.match(/^([<>])(\d+(?:\.\d+)?)(k|m|b)?$/)) && (m[3] === "k" || m[3] === "b" || (next === "views" || next === "view"))) {
      const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[3]] || 1;
      const n = Math.round(parseFloat(m[2]) * mult);
      if (m[1] === ">") f.minViews = n; else f.maxViews = n;
      if (next === "views" || next === "view") i++;
      chip((m[1] === ">" ? "Over " : "Under ") + m[2] + (m[3] || "").toUpperCase() + " views");
    } else if ((m = t.match(/^([<>])(\d+(?:\.\d+)?)(s|sec|m|min|h|hr)?$/))) {
      const unit = m[3] || "m";
      const mult = unit[0] === "s" ? 1 : unit[0] === "h" ? 3600 : 60;
      const sec = Math.round(parseFloat(m[2]) * mult);
      if (m[1] === ">") f.minDur = sec; else f.maxDur = sec;
      chip((m[1] === ">" ? "Over " : "Under ") + fmtLen(sec));
    } else if (OMNI_WATCH[t]) {
      f.watch = OMNI_WATCH[t];
      chip(WATCH_WORDS[f.watch]);
    } else if (t === "is:fresh") {
      f.fresh = true;
      chip("Fresh to you");
    } else if ((m = t.match(/^in:([a-z-]+)$/)) && OMNI_SCOPES[m[1]]) {
      f.scope = OMNI_SCOPES[m[1]];
      chip("Only " + LIB_NAMES[f.scope]);
    } else if ((m = t.match(/^-@([\w.\-]{2,})$/))) {
      f.notChannels.push(m[1].toLowerCase());
      chip("Not @" + m[1]);
    } else if ((m = t.match(/^@([\w.\-]{2,})$/))) {
      f.channel = m[1];
      chip("@" + m[1]);
    } else if ((m = t.match(/^-([^\s\d-][^\s]+)$/))) {
      // A leading digit is a number ("-5"), not an exclusion, so it stays a word.
      f.excludes.push(m[1]);
      chip("Without " + m[1]);
    } else if ((m = t.match(/^sort:([a-z]+)$/)) && OMNI_SORTS[m[1]]) {
      f.sort = OMNI_SORTS[m[1]];
      chip("Sorted by " + m[1]);
    } else if ((m = t.match(/^(after|before):(\S+)$/)) && parseOmniDate(m[2])) {
      const age = ageInDays(parseOmniDate(m[2]));
      if (m[1] === "after") f.maxAge = Math.min(f.maxAge, age); else f.minAge = age;
      chip(cap(m[1]) + " " + m[2]);
    } else if ((m = t.match(/^date:([a-z]+)$/)) && OMNI_DATES[m[1]]) {
      f.maxAge = Math.min(f.maxAge, OMNI_DATES[m[1]][0]);
      chip(OMNI_DATES[m[1]][1]);
    } else if ((m = t.match(/^watched:(\S+)$/)) && watchedRange(m[1])) {
      const r = watchedRange(m[1]);
      f.watchedMin = r.min;
      f.watchedMax = r.max;
      f.watchedText = r.text;
      chip(r.text);
    } else if ((m = t.match(/^lang:([a-z]{2})$/)) && typeof LANGS !== "undefined" && LANGS[m[1]]) {
      f.lang = m[1];
      chip(LANGS[m[1]].name + " only");
    } else if (OMNI_FEATURES[t]) {
      if (f.features.indexOf(OMNI_FEATURES[t][0]) === -1) f.features.push(OMNI_FEATURES[t][0]);
      chip(OMNI_FEATURES[t][1]);
    } else if (OMNI_TYPES[t]) {
      f.type = OMNI_TYPES[t][0];
      chip(OMNI_TYPES[t][1]);
    } else {
      f.words.push(toks[i]);
    }
  }
  f.clean = f.words.join(" ");
  /*
   * What YouTube is sent. The channel goes along as a plain word, because
   * "iphone" alone would fill the 200 results with everyone else's iPhone videos
   * and leave the channel filter little to find. Exclusions do not: they are
   * applied here, and YouTube's handling of a minus sign is not documented.
   */
  f.query = f.words.concat(f.channel ? [f.channel] : []).join(" ");
  return f;
}

/*
 * The part of a typed query YouTube can apply itself, as its own filter
 * parameter: upload window, features, type, popularity, and length when the
 * range falls inside one of its buckets. Sent with the search, so YouTube's
 * own results page opens already narrowed across its whole index, and the
 * panel only tightens what is left to exact values.
 */
function compileSp(f) {
  const filters = {};
  if (f.maxAge !== Infinity) {
    const d = YT_DATES.find(([, days]) => f.maxAge <= days);
    if (d) filters[YT_F.date] = d[0];
  }
  if (f.minDur || f.maxDur !== Infinity) {
    const hit = YT_LENGTHS.filter(([, lo, hi]) => lo < f.maxDur && hi > f.minDur);
    if (hit.length === 1) filters[YT_F.length] = hit[0][0];
  }
  for (const n of f.features || []) filters[n] = 1;
  if (f.type) filters[YT_F.type] = f.type;
  return encodeSp(f.sort === "views_desc" ? 3 : 0, filters);
}

// What survives a trip through sessionStorage: Infinity does not.
function packFilters(f) {
  const fin = (n) => (n === Infinity ? null : n);
  return {
    words: f.words, chips: f.chips, clean: f.clean, query: f.query, watch: f.watch, scope: f.scope,
    channel: f.channel, notChannels: f.notChannels, excludes: f.excludes, sort: f.sort,
    minDur: f.minDur, maxDur: fin(f.maxDur), minViews: f.minViews, maxViews: fin(f.maxViews),
    minAge: f.minAge, maxAge: fin(f.maxAge),
    watchedMin: f.watchedMin, watchedMax: fin(f.watchedMax), watchedText: f.watchedText,
    lang: f.lang, fresh: f.fresh, features: f.features, type: f.type,
  };
}
function unpackFilters(p) {
  const inf = (n) => (n == null ? Infinity : n);
  return Object.assign({
    channel: "", notChannels: [], excludes: [], sort: "", minAge: 0, watchedMin: 0, watchedText: "",
    lang: "", fresh: false, features: [], type: 0,
  }, p, {
    maxDur: inf(p.maxDur), maxViews: inf(p.maxViews), maxAge: inf(p.maxAge), watchedMax: inf(p.watchedMax),
    ops: p.chips ? p.chips.length : 0,
  });
}

// ---- matching -------------------------------------------------------------
function passesFilters(v, f) {
  if (f.minDur && !(v.seconds >= f.minDur)) return false;
  if (f.maxDur !== Infinity && !(v.seconds > 0 && v.seconds <= f.maxDur)) return false;
  if (f.minViews && !(v.views >= f.minViews)) return false;
  if (f.maxViews !== Infinity && !(v.views <= f.maxViews)) return false;
  if (f.watch && watchState(v) !== f.watch) return false;
  if (f.channel && !matchChannel(v, f.channel)) return false;
  if (f.notChannels && f.notChannels.some((c) => matchChannel(v, c))) return false;
  if (f.minAge && !(v.days != null && v.days >= f.minAge)) return false;
  if (f.maxAge !== Infinity && !(v.days != null && v.days <= f.maxAge)) return false;
  if (f.watchedMin || f.watchedMax !== Infinity) {
    if (!(typeof v.watchedDays === "number" && v.watchedDays >= f.watchedMin && v.watchedDays <= f.watchedMax)) return false;
  }
  if (f.excludes && f.excludes.length) {
    const hay = (v.title + " " + (v.channel || "")).toLowerCase();
    if (f.excludes.some((w) => hay.includes(w.toLowerCase()))) return false;
  }
  if (f.lang && typeof langMatches === "function" && !langMatches(v.title, f.lang)) return false;
  if (f.fresh && typeof isFresh === "function" && !isFresh(v)) return false;
  return true;
}

/*
 * Typo-tolerant matching, for your own lists. "What was that video" is asked
 * from memory, and memory spells "borow checker". A word of four letters or
 * more may be one edit off a word in the title, eight or more two edits off,
 * or a mistyped start of a longer word. Exact matches always rank first.
 */
function editWithin(a, b, k) {
  if (Math.abs(a.length - b.length) > k) return false;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const c = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(c);
      if (c < rowMin) rowMin = c;
    }
    if (rowMin > k) return false;
    prev = cur;
  }
  return prev[b.length] <= k;
}

// 2 if every word is in the text as typed, 1 if some only nearly, 0 if not.
function matchScore(v, words, fuzzy) {
  if (!words.length) return 2;
  const hay = (v.title + " " + (v.channel || "")).toLowerCase();
  let hayWords = null;
  let score = 2;
  for (const raw of words) {
    const w = raw.toLowerCase();
    if (hay.includes(w)) continue;
    if (!fuzzy || w.length < 4) return 0;
    const k = w.length >= 8 ? 2 : 1;
    hayWords = hayWords || hay.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
    const near = hayWords.some((hw) => editWithin(w, hw, k) || (hw.length > w.length && editWithin(w, hw.slice(0, w.length), k)));
    if (!near) return 0;
    score = 1;
  }
  return score;
}

function matchesWords(v, words, fuzzy) {
  return matchScore(v, words, fuzzy) > 0;
}

/*
 * Grouped matches, each video once. A video can sit in Watch Later and in
 * history at the same time, and showing it twice in an eight-row dropdown
 * wastes a quarter of it, so the first list in LIB_ORDER that has it wins.
 * watched: only makes sense of history, the one list that knows when.
 */
function matchLibrary(f, perGroup) {
  const watchedAsked = f.watchedMin || f.watchedMax !== Infinity;
  const lists = f.scope && f.scope !== "channels" ? [f.scope] : watchedAsked ? ["hist"] : LIB_ORDER;
  const seenIds = new Set();
  const groups = [];
  for (const key of lists) {
    const exact = [], near = [];
    for (const v of library[key]) {
      if (seenIds.has(v.id)) continue;
      const s = matchScore(v, f.words, true);
      if (!s || !passesFilters(v, f)) continue;
      seenIds.add(v.id);
      (s === 2 ? exact : near).push(v);
    }
    let hits = exact.concat(near);
    if (perGroup) hits = hits.slice(0, perGroup);
    if (hits.length) groups.push({ key, name: LIB_NAMES[key], videos: hits });
  }
  return groups;
}

/*
 * The channels you watch, searched from whatever the index has loaded. Exact
 * words only here: across thousands of videos, near misses are mostly noise.
 */
function matchIndex(f, limit) {
  const all = typeof chIndex !== "undefined" && chIndex.videos;
  if (!all || (!f.words.length && !f.channel)) return [];
  const out = [];
  const libIds = new Set(library.wl.concat(library.hist, library.liked).map((v) => v.id));
  for (const v of all) {
    if (libIds.has(v.id)) continue;
    if (!matchScore(v, f.words, false) || !passesFilters(v, f)) continue;
    out.push(v);
    if (limit && out.length >= limit) break;
  }
  return out;
}

/*
 * What the bar shows before anything is typed. Half-watched first, since
 * finishing something is the likeliest reason to have opened YouTube, then the
 * newest things saved to Watch Later and never started. Watch Later is stored
 * in the list's own order, oldest additions first, hence the reverse.
 */
function libraryIdle() {
  const seenIds = new Set();
  const partial = [];
  for (const key of ["hist", "wl", "liked"]) {
    for (const v of library[key]) {
      if (partial.length >= 2) break;
      if (seenIds.has(v.id) || watchState(v) !== "partial") continue;
      seenIds.add(v.id);
      partial.push(v);
    }
  }
  const fresh = library.wl.slice().reverse()
    .filter((v) => !seenIds.has(v.id) && watchState(v) === "new")
    .slice(0, 2);
  const groups = [];
  if (partial.length) groups.push({ key: "partial", name: "Pick up where you left off", videos: partial });
  if (fresh.length) groups.push({ key: "wl", name: "Saved to Watch Later, never started", videos: fresh });
  return groups;
}

// For the panel, when the query was scoped with in:.
async function libraryCatalog(scope) {
  if (scope === "channels") return (await indexVideos()).slice();
  await loadLibrary();
  if (!library[scope].length && library.refreshing) await library.refreshing;
  if (!library[scope].length) await refreshLibrary();
  return library[scope].slice();
}
