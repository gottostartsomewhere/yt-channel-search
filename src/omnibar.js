/*
 * Needle for YouTube
 * The search bar: your library inside YouTube's own suggestion dropdown,
 * filters typed into the query, the results page they land on, and the marks
 * on YouTube's own thumbnails for things already in your library.
 *
 * Loaded last, after panel.js, because it opens the panel.
 *
 * Nothing here replaces YouTube's search. With no filters typed and nothing in
 * your library matching, the bar behaves exactly as it does without this
 * extension, and if any of this breaks the bar goes back to being plain YouTube.
 *
 * Facts about youtube.com this depends on, all checked against the live page
 * (September 2026):
 *
 *   - The bar is <yt-searchbox> with no shadow root, and its dropdown is the
 *     element the input's aria-controls names. YouTube updates the suggestions
 *     in place, so a node added to that dropdown survives typing.
 *   - The dropdown is hidden by a class on the host when YouTube has no
 *     suggestions of its own, so showing ours then means overriding that class.
 *   - Enter is a keydown on the input that YouTube turns into a navigation. It
 *     reads the input's value when it does, so rewriting the value in a capture
 *     listener, which runs first, decides what YouTube searches for.
 *   - Searching for the query already on screen still fires yt-navigate-finish.
 *   - A "yt-navigate" event on ytd-app moves the page without a reload, but only
 *     from the page's own JavaScript world. navigate.js runs there.
 */
const OMNI_PENDING = "ytcsOmni";
/*
 * At most two rows per group in the dropdown, so your own videos never push
 * YouTube's suggestions out of sight. A list asked for by name with in: is the
 * exception, since then those rows are the whole answer.
 */
const OMNI_PER_GROUP = 2;
const OMNI_TTL = 2 * 60 * 1000;
const omni = {
  input: null, host: null, el: null, obs: null, obsBox: null, timer: 0,
  focused: false, hint: "", active: -1,
  // Followed searches with something new, loaded when the bar is focused.
  news: [],
  // Set by "Show them" under the results, for this page only.
  showMuted: false,
};

// Outline glyphs, one per list, used in the dropdown, the strip and the badges.
const OMNI_ICONS = {
  wl: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  hist: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2",
  liked: "M7 11v9H4v-9h3zm0 0 4-7a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7",
  partial: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8.5v7l6-3.5z",
  channels: "M4 5h16v11H4zM8 20h8M12 16v4",
  follow: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  mute: "M3 3l18 18M10.6 5.1A7 7 0 0 1 19 12a7 7 0 0 1-1 3.6M6.3 6.3A7 7 0 0 0 12 19a7 7 0 0 0 5.7-2.9",
  tips: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.3.3.5.7.5 1.1v1h6v-1c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3z",
};
const OMNI_HEADS = {
  wl: "In your Watch Later", hist: "You watched", liked: "Liked", partial: "Pick up where you left off",
  channels: "From channels you watch", follow: "New in searches you follow",
};

// The operators people can click to learn, in the order they are most useful.
const OMNI_TIPS = [
  ["<20m", "<20m "], [">100k", ">100k "], ["unwatched", "unwatched "], ["is:fresh", "is:fresh "],
  ["in:wl", "in:wl "], ["@channel", "@"], ["watched:week", "watched:week "], ["date:month", "date:month "],
];

// ---- getting around -----------------------------------------------------------
/*
 * Opens a video the way YouTube's own links do, without reloading the page. The
 * page-world script (navigate.js) marks <html> when it is present, and does the
 * actual navigating when asked through a DOM event, since a content script's
 * event details are invisible to the page. Without that mark, or if nothing has
 * moved a second and a half later, it falls back to an ordinary load.
 */
function navigateTo(url) {
  const root = document.documentElement;
  if (!root.hasAttribute("data-ytcs-nav")) {
    location.assign(url);
    return;
  }
  const before = location.href;
  root.setAttribute("data-ytcs-go", url);
  document.dispatchEvent(new Event("ytcs-navigate"));
  setTimeout(() => { if (location.href === before) location.assign(url); }, 1500);
}

// Every link we draw opens in place on a plain click. Anything with a modifier,
// or a middle click, is left to the browser, so new tabs still work.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target && e.target.closest && e.target.closest("a.ytcs-omni-row, a.ytcs-libcard, a.ytcs-card");
  if (!a) return;
  if (a.classList.contains("ytcs-follow")) {
    e.preventDefault();
    if (omni.input) omni.input.blur();
    openFollow(a.dataset.q);
    return;
  }
  if (!/^\/watch\?v=/.test(a.getAttribute("href") || "")) return;
  e.preventDefault();
  if (omni.input) omni.input.blur();
  navigateTo(a.getAttribute("href"));
}, true);

function omniIcon(key, size) {
  const svg = icon(OMNI_ICONS[key] || OMNI_ICONS.wl, size || 14);
  svg.classList.add("ytcs-ico");
  return svg;
}

// ---- the dropdown ---------------------------------------------------------
function omniAttach() {
  if (!cfg.librarySearch) return;
  const inp = document.querySelector("yt-searchbox input[name='search_query']");
  if (!inp || inp === omni.input) return;
  omni.input = inp;
  omni.host = inp.closest("yt-searchbox");
  inp.addEventListener("focus", () => {
    omni.focused = true;
    loadLibrary().then(omniSchedule);
    followsWithNews().then((n) => { omni.news = n; omniSchedule(); });
    if (cfg.channelIndex) indexVideos().then(omniSchedule);
    checkFollows();
    omniSchedule();
  });
  // Delayed so a click on one of our rows lands before the dropdown goes.
  inp.addEventListener("blur", () => {
    omni.focused = false;
    omni.active = -1;
    setTimeout(omniClose, 200);
  });
  inp.addEventListener("input", () => {
    omni.hint = "";
    omni.active = -1;
    omniSchedule();
  });
}

function omniSchedule() {
  clearTimeout(omni.timer);
  omni.timer = setTimeout(omniRender, 60);
}

function omniListbox() {
  const id = omni.input && omni.input.getAttribute("aria-controls");
  return id ? document.getElementById(id) : null;
}

function omniClose() {
  if (omni.focused || !omni.host) return;
  omni.host.classList.remove("ytcs-omni-open");
}

function omniStateText(v, groupKey) {
  const ws = watchState(v);
  if (ws === "partial") return Math.round(v.progress) + "% watched";
  // "Watched yesterday", but "Watched Sunday" and "Watched Sep 14": only the two
  // relative words are lowercased, since the others are names.
  if (groupKey === "hist") {
    const w = v.watchedLabel || "";
    return w ? "Watched " + (/^(today|yesterday)$/i.test(w) ? w.toLowerCase() : w) : "Watched";
  }
  if (ws === "done") return "Watched";
  if (groupKey === "wl") return "Never started";
  return "";
}

function omniThumb(v, cls) {
  const box = document.createElement("span");
  box.className = cls;
  const img = document.createElement("img");
  img.src = "https://i.ytimg.com/vi/" + encodeURIComponent(v.id) + "/mqdefault.jpg";
  img.alt = "";
  img.loading = "lazy";
  box.appendChild(img);
  if (typeof v.progress === "number" && v.progress > 0) {
    const bar = document.createElement("span");
    bar.className = "ytcs-omni-bar";
    bar.style.width = Math.min(100, v.progress) + "%";
    box.appendChild(bar);
  }
  return box;
}

// The title with each searched word marked, built from text nodes so a title
// can never inject markup.
function omniMarked(text, words) {
  const frag = document.createDocumentFragment();
  const ws = words.map((w) => w.trim()).filter((w) => w.length > 1);
  if (!ws.length) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const esc = ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("(" + esc.join("|") + ")", "ig");
  let last = 0;
  text.replace(re, (m, _g, at) => {
    if (at > last) frag.appendChild(document.createTextNode(text.slice(last, at)));
    const mark = document.createElement("mark");
    mark.className = "ytcs-hl";
    mark.textContent = m;
    frag.appendChild(mark);
    last = at + m.length;
    return m;
  });
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function omniRow(v, groupKey, words) {
  const a = document.createElement("a");
  a.className = "ytcs-omni-row";
  a.href = "/watch?v=" + encodeURIComponent(v.id);
  a.tabIndex = -1;
  a.appendChild(omniThumb(v, "ytcs-omni-thumb"));
  const text = document.createElement("span");
  text.className = "ytcs-omni-text";
  const title = document.createElement("span");
  title.className = "ytcs-omni-title";
  title.appendChild(omniMarked(v.title, words));
  const meta = document.createElement("span");
  meta.className = "ytcs-omni-meta";
  const bits = [fmtDuration(v.seconds), groupKey === "partial" ? "" : v.channel, omniStateText(v, groupKey)];
  factsInto(meta, bits.filter(Boolean).filter((b, i, all) => all.indexOf(b) === i));
  text.appendChild(title);
  text.appendChild(meta);
  a.appendChild(text);
  return a;
}

function omniTipsRow() {
  const row = document.createElement("div");
  row.className = "ytcs-omni-tips";
  row.appendChild(omniIcon("tips", 14));
  const lead = document.createElement("span");
  lead.className = "ytcs-omni-tiplead";
  lead.textContent = "Filter as you type";
  row.appendChild(lead);
  for (const [label, insert] of OMNI_TIPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ytcs-omni-tip";
    b.textContent = label;
    b.title = "Add " + label + " to the search";
    b.onclick = () => {
      const v = omni.input.value;
      omni.input.value = v + (v && !/\s$/.test(v) ? " " : "") + insert;
      omni.input.dispatchEvent(new Event("input", { bubbles: true }));
      omni.input.focus();
    };
    row.appendChild(b);
  }
  const off = document.createElement("button");
  off.type = "button";
  off.className = "ytcs-omni-tipsoff";
  off.textContent = "Hide tips";
  off.title = "Bring them back any time from the Needle popup";
  off.onclick = () => {
    // A setting, not a one-way door: the popup's "Filter tips" switch brings
    // them back, and says so in this button's tooltip.
    cfg.filterTips = false;
    try { chrome.storage.sync.set({ filterTips: false }); } catch (e) { /* ignore */ }
    omniRender();
  };
  row.appendChild(off);
  return row;
}

function omniRender() {
  if (!omni.input || !cfg.librarySearch) return;
  const box = omniListbox();
  if (!box) return;

  const raw = omni.input.value;
  const f = parseOmniQuery(raw);
  let groups = [];
  if (!raw.trim()) groups = libraryIdle();
  else if (f.words.length || f.ops) groups = matchLibrary(f, f.scope ? 8 : OMNI_PER_GROUP);

  if (!omni.el) {
    omni.el = document.createElement("div");
    omni.el.className = "ytcs-omni";
    omni.el.setAttribute("role", "presentation");
    // Keeps focus in the input, so the dropdown is still open when the click
    // arrives. Without it, pressing on a row blurs the bar and it vanishes.
    omni.el.addEventListener("mousedown", (e) => e.preventDefault());
  }
  omni.el.textContent = "";

  if (f.chips.length) {
    const row = document.createElement("div");
    row.className = "ytcs-omni-chips";
    for (const c of f.chips) {
      const chip = document.createElement("span");
      chip.className = "ytcs-omni-chip";
      chip.textContent = c;
      row.appendChild(chip);
    }
    omni.el.appendChild(row);
  }

  const words = f.words.concat(f.channel ? [f.channel] : []);
  // What the searches you follow have found since you last looked.
  if (!raw.trim() && omni.news.length) {
    omni.el.appendChild(omniHead("follow"));
    for (const item of omni.news.slice(0, OMNI_PER_GROUP)) omni.el.appendChild(followRow(item));
  }
  for (const g of groups) {
    const head = document.createElement("div");
    head.className = "ytcs-omni-head";
    head.appendChild(omniIcon(g.key, 13));
    const name = document.createElement("span");
    name.textContent = g.key === "wl" && g.name !== LIB_NAMES.wl ? g.name : OMNI_HEADS[g.key] || g.name;
    head.appendChild(name);
    omni.el.appendChild(head);
    for (const v of g.videos) omni.el.appendChild(omniRow(v, g.key, words));
  }
  // The back catalogues of the channels you watch, after your own lists.
  const fromIndex = raw.trim() && cfg.channelIndex && (!f.scope || f.scope === "channels") ? matchIndex(f, f.scope ? 8 : OMNI_PER_GROUP) : [];
  if (fromIndex.length) {
    omni.el.appendChild(omniHead("channels"));
    for (const v of fromIndex) omni.el.appendChild(omniRow(v, "channels", words));
  }
  if (fromIndex.length) groups = groups.concat([{ key: "channels", videos: fromIndex }]);

  const hint = omni.hint || (f.ops && !groups.length && raw.trim()
    ? (f.scope ? "Nothing in your " + LIB_NAMES[f.scope] + " matches." : "Nothing in your library matches. Enter searches YouTube with these filters.")
    : "");
  if (hint) {
    const p = document.createElement("div");
    p.className = "ytcs-omni-hint";
    p.textContent = hint;
    omni.el.appendChild(p);
  }

  // Tips on an empty bar, or under our own rows while typing. Never on their
  // own under an ordinary search, where they would only be in the way.
  if (cfg.filterTips && !f.ops && (!raw.trim() || groups.length)) omni.el.appendChild(omniTipsRow());
  // A filtered search can be followed from right here.
  if (raw.trim() && f.ops && f.query && !f.scope) omni.el.appendChild(followOffer(raw.trim()));

  if (!omni.el.childNodes.length) {
    if (omni.el.parentNode) omni.el.remove();
    if (omni.host) omni.host.classList.remove("ytcs-omni-open");
    return;
  }
  if (box.firstChild !== omni.el) box.insertBefore(omni.el, box.firstChild);
  omniObserve(box);
  omniHighlight();
  if (omni.host) omni.host.classList.toggle("ytcs-omni-open", omni.focused);
}

/*
 * YouTube adds its suggestions when they arrive from the network, which can be
 * after ours went in, and inserts them at the top. This keeps our section first
 * without re-rendering it. The dropdown is a couple of dozen nodes, so watching
 * it costs nothing.
 */
function omniObserve(box) {
  if (omni.obsBox === box) return;
  if (omni.obs) omni.obs.disconnect();
  omni.obs = new MutationObserver(() => {
    if (omni.el && omni.el.parentNode === box && box.firstChild !== omni.el) box.insertBefore(omni.el, box.firstChild);
  });
  omni.obs.observe(box, { childList: true });
  omni.obsBox = box;
}

function omniRows() {
  return omni.el && omni.el.parentNode ? Array.from(omni.el.querySelectorAll(".ytcs-omni-row")) : [];
}

function omniHighlight() {
  const rows = omniRows();
  rows.forEach((r, i) => r.classList.toggle("ytcs-on", i === omni.active));
  if (rows[omni.active]) rows[omni.active].scrollIntoView({ block: "nearest" });
}

// ---- keys -----------------------------------------------------------------------
/*
 * Arrow keys walk our rows first, then hand over to YouTube's suggestions below.
 * Only the keys we actually use are stopped, and only while one of our rows is
 * involved, so YouTube's own keyboard handling is untouched the rest of the time.
 */
function omniKeys(e) {
  const rows = omniRows();
  if (e.key === "ArrowDown" && rows.length && omni.active < rows.length - 1) {
    omni.active++;
  } else if (e.key === "ArrowDown" && rows.length && omni.active === rows.length - 1) {
    omni.active = -1;
    omniHighlight();
    return; // YouTube takes it from here, onto its first suggestion.
  } else if (e.key === "ArrowUp" && omni.active >= 0) {
    omni.active--;
  } else if (e.key === "Enter" && rows[omni.active]) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const row = rows[omni.active];
    omni.input.blur();
    if (row.classList.contains("ytcs-follow")) openFollow(row.dataset.q);
    else navigateTo(row.getAttribute("href"));
    return;
  } else if (e.key === "Escape") {
    omni.active = -1;
    omniHighlight();
    return;
  } else {
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  omniHighlight();
}

// ---- Enter ------------------------------------------------------------------
function omniSubmit(e) {
  if (!cfg.librarySearch || !omni.input) return;
  const f = parseOmniQuery(omni.input.value);
  if (!f.ops) {
    try { sessionStorage.removeItem(OMNI_PENDING); } catch (err) { /* private mode */ }
    return;
  }
  if (!f.query) {
    // Filters with nothing to search for. YouTube would search for the literal
    // text "<20m", so it never gets the query, and the dropdown already shows
    // the answer from your library.
    e.preventDefault();
    e.stopImmediatePropagation();
    omni.hint = f.scope ? "Type a word to search your " + LIB_NAMES[f.scope] + ", or pick one above." : "Add something to search for, then Enter.";
    omniRender();
    return;
  }
  try {
    sessionStorage.setItem(OMNI_PENDING, JSON.stringify({ q: f.query, f: packFilters(f), at: Date.now() }));
  } catch (err) { /* private mode: the search still happens, unfiltered */ }
  /*
   * Whatever YouTube can filter itself goes to YouTube: its own results page
   * opens with its own strict filters on, across its whole index, and the panel
   * then tightens what is left. That needs the search opened with YouTube's
   * filter parameter attached, which typing into the box cannot carry, so it is
   * opened directly. Without anything YouTube can filter, the box is simply
   * given the plain words and YouTube searches as normal.
   */
  const sp = compileSp(f);
  omni.input.value = f.query;
  omni.input.dispatchEvent(new Event("input", { bubbles: true }));
  if (sp) {
    e.preventDefault();
    e.stopImmediatePropagation();
    omni.input.blur();
    navigateTo(searchUrl(f.query, sp));
  }
  // Otherwise YouTube navigates on its own, even when the query matches the
  // page already open, so the arrival handler always runs. Checked, not assumed.
}

function searchUrl(query, sp) {
  return "/results?search_query=" + encodeURIComponent(query).replace(/%20/g, "+") + (sp ? "&sp=" + encodeURIComponent(sp) : "");
}

window.addEventListener("keydown", (e) => {
  if (e.isComposing || !omni.input || e.target !== omni.input) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape") return omniKeys(e);
  if (e.key !== "Enter") return;
  if (omni.active >= 0) return omniKeys(e);
  omniSubmit(e);
}, true);

window.addEventListener("click", (e) => {
  const btn = e.target && e.target.closest && e.target.closest("yt-searchbox button.ytSearchboxComponentSearchButton");
  if (btn && omni.input) omniSubmit(e);
}, true);

// ---- the results page -------------------------------------------------------
function takePending() {
  let p = null;
  try {
    p = JSON.parse(sessionStorage.getItem(OMNI_PENDING) || "null");
  } catch (e) { return null; }
  if (!p || !p.q || Date.now() - p.at > OMNI_TTL) return null;
  if (p.q.trim().toLowerCase() !== searchQuery().trim().toLowerCase()) return null;
  try { sessionStorage.removeItem(OMNI_PENDING); } catch (e) { /* ignore */ }
  return unpackFilters(p.f);
}

/*
 * Can run twice for one page, since a full load onto /results gets both the
 * timer below and YouTube's own navigate event. The second run finds no pending
 * filters and only redraws the strip, which is why nothing here resets the
 * panel's controls: that would wipe what the first run just applied.
 */
function omniArrive() {
  if (!isSearchPage()) return;
  beginSeenPage();
  omni.showMuted = false;
  hideMutedResults();
  const f = takePending();
  // Only ever set here. The navigate handler clears both before this runs, so
  // a second run with nothing pending must not undo the first one's scope.
  if (f) {
    state.omniScope = f.scope || "";
    state.stripFilters = f;
  } else if (!state.stripFilters) {
    state.stripFilters = parseOmniQuery(searchQuery());
  }
  loadLibrary().then(() => { renderLibraryStrip(); badgeResults(); });
  renderLibraryStrip();
  if (!f) return;
  state.pendingOmni = f;
  if (state.active) disable();
  enable();
}

/*
 * Filters typed into the bar become ordinary selections in the panel, so they
 * can be seen and changed like any other. "<12m" is not one of the preset
 * lengths, so it gets its own option, marked so it can be taken out again.
 */
function omniRangeLabel(min, max, fmt, unit) {
  if (min && max !== Infinity) return fmt(min) + " to " + fmt(max) + unit;
  if (min) return "Over " + fmt(min) + unit;
  return "Under " + fmt(max) + unit;
}

function omniSetCustom(sel, value, label) {
  let opt = Array.from(sel.options).find((o) => o.value === value);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.dataset.omni = "1";
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.classList.remove("ytcs-dim");
}

// The sort a typed sort: asks for, or its nearest equivalent in this list.
function omniSortValue(key) {
  const have = Array.from(ui.sort.options).map((o) => o.value);
  const tries = { upload_new: ["upload_new", "newest"], upload_old: ["upload_old", "oldest"] }[key] || [key];
  return tries.find((t) => have.indexOf(t) !== -1) || "";
}

// Sets whatever the parsed query names and leaves everything else alone, so
// the panel's own box can add one filter at a time.
function setOmniDims(f) {
  if (!ui) return false;
  if (f.minDur || f.maxDur !== Infinity) {
    omniSetCustom(ui.duration, f.minDur + "-" + (f.maxDur === Infinity ? "" : f.maxDur),
      omniRangeLabel(f.minDur, f.maxDur, fmtLen, ""));
  }
  if (f.minViews || f.maxViews !== Infinity) {
    omniSetCustom(ui.views, f.minViews + "-" + (f.maxViews === Infinity ? "" : f.maxViews),
      omniRangeLabel(f.minViews, f.maxViews, fmtCompact, " views"));
  }
  if (f.watch) {
    ui.watched.value = f.watch;
    ui.watched.classList.remove("ytcs-dim");
  }
  const x = state.extra;
  if (f.channel) x.channel = f.channel.toLowerCase();
  for (const w of f.excludes || []) {
    const lw = w.toLowerCase();
    if (x.excludes.indexOf(lw) === -1) x.excludes = x.excludes.concat([lw]);
  }
  for (const c of f.notChannels || []) if (x.notChannels.indexOf(c) === -1) x.notChannels = x.notChannels.concat([c]);
  if (f.minAge) x.minAge = f.minAge;
  if (f.maxAge !== Infinity) x.maxAge = f.maxAge;
  if (f.watchedMin || f.watchedMax !== Infinity) {
    x.watchedMin = f.watchedMin;
    x.watchedMax = f.watchedMax;
    x.watchedText = f.watchedText;
  }
  if (f.lang) x.lang = f.lang;
  if (f.fresh) x.fresh = true;
  if (f.sort) {
    const s = omniSortValue(f.sort);
    if (s) ui.sort.value = s;
  }
  // Features and types only YouTube can apply: the caller sends the search
  // back to YouTube with them attached.
  return !!((f.features && f.features.length) || f.type);
}

function applyOmniFilters(f) {
  if (!ui) return;
  omniResetControls();
  setOmniDims(f);
  // A scoped search shows the whole list, so the words go in the keyword box.
  // Search results are already about the words, and YouTube matches on more
  // than titles, so filtering them by title again would throw good ones away.
  ui.kw.value = f.scope ? f.clean : "";
}

// Custom options and typed-only filters belong to the search that made them,
// not to the next page.
function omniResetControls() {
  state.extra = freshExtra();
  if (!ui) return;
  for (const sel of [ui.duration, ui.views]) {
    const custom = sel.querySelectorAll("option[data-omni]");
    if (!custom.length) continue;
    const wasCustom = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.omni;
    custom.forEach((o) => o.remove());
    if (wasCustom) {
      sel.value = "";
      sel.classList.add("ytcs-dim");
    }
  }
}

/*
 * "From your library", above YouTube's results. Shown on any search with a
 * match, filters or not, because that is what makes the extension useful before
 * anybody has learned a single operator.
 *
 * One row that scrolls sideways, not a wrapping grid. Wrapped, eight cards took
 * two rows and pushed YouTube's first result below the fold, which made the
 * page worse for the one search in ten where the library was not the point.
 */
const STRIP_MAX = 12;

function renderLibraryStrip() {
  const old = document.querySelector(".ytcs-libstrip");
  if (!isSearchPage() || !cfg.librarySearch || state.omniScope) {
    if (old) old.remove();
    return;
  }
  const list = document.querySelector("ytd-search ytd-section-list-renderer");
  if (!list || !list.parentElement) return;

  const f = state.stripFilters || parseOmniQuery(searchQuery());
  if (!f.words.length && !f.channel) {
    if (old) old.remove();
    return;
  }
  const hits = [];
  for (const g of matchLibrary(f, 0)) for (const v of g.videos) hits.push({ v, key: g.key });
  const shown = hits.slice(0, STRIP_MAX);
  if (!shown.length) {
    if (old) old.remove();
    return;
  }

  const key = searchQuery() + "|" + shown.map((h) => h.v.id).join(",");
  const parent = list.parentElement;
  const anchor = ui && ui.wrap.parentElement === parent ? ui.wrap : list;
  if (old && old.dataset.key === key && old.parentElement === parent) return;
  if (old) old.remove();

  const strip = document.createElement("section");
  strip.className = "ytcs-libstrip";
  strip.dataset.key = key;
  const head = document.createElement("div");
  head.className = "ytcs-libstrip-head";
  const title = document.createElement("span");
  title.className = "ytcs-libstrip-title";
  title.textContent = "From your library";
  head.appendChild(title);
  const count = document.createElement("span");
  count.className = "ytcs-libstrip-count";
  count.textContent = hits.length > shown.length ? shown.length + " of " + hits.length : String(hits.length);
  head.appendChild(count);
  const spacer = document.createElement("span");
  spacer.className = "ytcs-spacer";
  head.appendChild(spacer);
  const row = document.createElement("div");
  row.className = "ytcs-libstrip-row";
  if (shown.length > 3) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "ytcs-libstrip-more";
    more.textContent = "Show all";
    more.onclick = () => {
      const open = strip.classList.toggle("ytcs-open");
      more.textContent = open ? "Show less" : "Show all";
    };
    head.appendChild(more);
  }
  strip.appendChild(head);

  const words = f.words.concat(f.channel ? [f.channel] : []);
  for (const { v, key: g } of shown) {
    const card = document.createElement("a");
    card.className = "ytcs-libcard";
    card.href = "/watch?v=" + encodeURIComponent(v.id);
    const thumb = omniThumb(v, "ytcs-libcard-thumb");
    const src = document.createElement("span");
    src.className = "ytcs-libcard-src";
    src.appendChild(omniIcon(g, 12));
    src.appendChild(document.createTextNode(g === "hist" ? "History" : g === "liked" ? "Liked" : "Watch Later"));
    thumb.appendChild(src);
    if (v.seconds) {
      const dur = document.createElement("span");
      dur.className = "ytcs-libcard-dur";
      dur.textContent = fmtDuration(v.seconds);
      thumb.appendChild(dur);
    }
    card.appendChild(thumb);
    const t = document.createElement("span");
    t.className = "ytcs-libcard-title";
    t.appendChild(omniMarked(v.title, words));
    card.appendChild(t);
    const meta = document.createElement("span");
    meta.className = "ytcs-libcard-meta";
    factsInto(meta, [v.channel, omniStateText(v, g)].filter(Boolean).filter((b, i, all) => all.indexOf(b) === i));
    card.appendChild(meta);
    row.appendChild(card);
  }
  strip.appendChild(row);
  parent.insertBefore(strip, anchor);
}

// ---- marks on YouTube's own thumbnails ------------------------------------------
/*
 * "In Watch Later" and "Watched Monday", on the thumbnails YouTube draws. YouTube
 * has a red progress bar for watched videos but never says when, and nothing
 * anywhere says a result is already sitting in your Watch Later.
 *
 * Read from the link each thumbnail already carries, since the video data on
 * YouTube's elements lives in a JavaScript world this script cannot see. YouTube
 * recycles cards as you scroll, so the mark records which video it was for and
 * is redrawn when the link underneath it changes.
 */
let badgeIndex = null;
let badgeIndexAt = -1;
let badgeTimer = 0;
let badgeObs = null;

function libraryIndex() {
  if (badgeIndex && badgeIndexAt === library.at) return badgeIndex;
  badgeIndex = new Map();
  const put = (v, k) => {
    const e = badgeIndex.get(v.id) || {};
    e[k] = v;
    badgeIndex.set(v.id, e);
  };
  library.wl.forEach((v) => put(v, "wl"));
  library.hist.forEach((v) => put(v, "hist"));
  library.liked.forEach((v) => put(v, "liked"));
  badgeIndexAt = library.at;
  return badgeIndex;
}

function badgeFor(entry) {
  if (entry.hist) {
    const when = entry.hist.watchedLabel ? entry.hist.watchedLabel : "";
    return { key: "hist", text: when ? "Watched " + (/^(today|yesterday)$/i.test(when) ? when.toLowerCase() : when) : "Watched" };
  }
  // Not on the list's own page, where every single thumbnail would say it.
  if (entry.wl && ownListScope() !== "wl") return { key: "wl", text: "In Watch Later" };
  if (entry.liked && ownListScope() !== "liked") return { key: "liked", text: "Liked" };
  return null;
}

const BADGE_SELECTOR = "ytd-thumbnail a#thumbnail[href*='/watch?v='], ytd-video-renderer a#thumbnail[href*='/watch?v='], yt-lockup-view-model a[href*='/watch?v=']";

function videoIdOf(a) {
  try { return new URL(a.getAttribute("href"), location.origin).searchParams.get("v") || ""; } catch (e) { return ""; }
}

// Puts the right mark on one thumbnail, or takes a stale one off.
function markThumb(host, id, idx, extraClass) {
  const old = host.querySelector(":scope > .ytcs-badge");
  const entry = idx.get(id);
  const b = entry && badgeFor(entry);
  if (!b) {
    if (old) old.remove();
    return;
  }
  const sig = id + "|" + b.text;
  if (old && old.dataset.sig === sig) return;
  if (old) old.remove();
  const mark = document.createElement("span");
  mark.className = "ytcs-badge ytcs-badge-" + b.key + (extraClass ? " " + extraClass : "");
  mark.dataset.sig = sig;
  mark.appendChild(omniIcon(b.key, 12));
  mark.appendChild(document.createTextNode(b.text));
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(mark);
}

function badgeResults() {
  const idx = cfg.librarySearch && !libraryEmpty() ? libraryIndex() : null;
  const onSearch = isSearchPage();
  const done = new Set();
  for (const a of document.querySelectorAll(BADGE_SELECTOR)) {
    // A lockup has several links to the same video; mark its first one only.
    const card = a.closest("yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer") || a;
    if (done.has(card)) continue;
    done.add(card);
    if (a.closest(".ytcs-wrap, .ytcs-libstrip")) continue;
    const id = videoIdOf(a);
    if (!id) continue;
    if (idx) markThumb(a, id, idx, "");
    if (onSearch && card.closest("ytd-search")) {
      addMuteButton(a);
      observeShown(card, id);
    }
  }
  // The panel's own cards too. Top right there, since top left is where the
  // panel already says NEW about fresh uploads.
  const panelSearch = onSearch && !state.omniScope;
  for (const a of document.querySelectorAll(".ytcs-wrap a.ytcs-card")) {
    const thumb = a.querySelector(".ytcs-thumb");
    const id = videoIdOf(a);
    if (!thumb || !id) continue;
    if (idx) markThumb(thumb, id, idx, "ytcs-badge-r");
    if (panelSearch) {
      addMuteButton(thumb);
      observeShown(a, id);
    }
  }
  if (onSearch) hideMutedResults();
}

// ---- muting from a result ---------------------------------------------------------------
// Who made the video on a card: the panel's cards say so in data attributes,
// YouTube's carry a link to the channel, whose text is its name.
function cardChannel(card) {
  if (card.dataset && (card.dataset.ch || card.dataset.h)) return { name: card.dataset.ch || "", handle: card.dataset.h || "" };
  let handle = "", name = "";
  for (const a of card.querySelectorAll("a[href^='/@']")) {
    const m = a.getAttribute("href").match(/^\/@([^/?]+)/);
    if (m && !handle) handle = decodeURIComponent(m[1]).toLowerCase();
    const t = a.textContent.trim();
    if (t && !name) name = t;
  }
  return handle || name ? { name, handle } : null;
}

// Shows on hover, bottom left, which is the one corner nothing else uses:
// YouTube puts the length bottom right and our marks go along the top.
function addMuteButton(host) {
  if (host.querySelector(":scope > .ytcs-mutebtn")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ytcs-mutebtn";
  b.title = "Mute this channel in search";
  b.setAttribute("aria-label", "Mute this channel in search");
  b.appendChild(omniIcon("mute", 14));
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(b);
}

// On the window, in the capture phase, so it runs before the link the button
// sits inside can navigate, and before YouTube's own handlers see the click.
window.addEventListener("click", (e) => {
  const b = e.target && e.target.closest && e.target.closest(".ytcs-mutebtn");
  if (!b) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const card = b.closest("a.ytcs-card") || b.closest("ytd-video-renderer, yt-lockup-view-model");
  const who = card && cardChannel(card);
  if (!who) return;
  muteChannel(who.name, who.handle);
  const entry = muted.list[muted.list.length - 1];
  toast("Muted " + (who.name || "@" + who.handle) + " in search", "Undo", () => {
    if (entry) unmuteChannel(entry);
    hideMutedResults();
    if (state.active) applyView();
  });
  hideMutedResults();
  if (state.active) applyView();
}, true);

const RESULT_CARDS = "ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model";

function hideMutedResults() {
  if (!isSearchPage()) return;
  let n = 0;
  for (const card of document.querySelectorAll(RESULT_CARDS)) {
    const who = cardChannel(card);
    const hide = !omni.showMuted && !!who && isMuted({ channel: who.name, handle: who.handle });
    if (hide) {
      n++;
      if (!card.hasAttribute("data-ytcs-muted")) {
        card.setAttribute("data-ytcs-muted", card.style.display);
        card.style.display = "none";
      }
    } else if (card.hasAttribute("data-ytcs-muted")) {
      card.style.display = card.getAttribute("data-ytcs-muted");
      card.removeAttribute("data-ytcs-muted");
    }
  }
  renderMuteNote(n);
}

// "2 results from channels you muted, hidden. Show them", above YouTube's list,
// so a mute is never a silent hole in the results.
function renderMuteNote(n) {
  let note = document.querySelector(".ytcs-mutenote");
  const list = document.querySelector("ytd-search ytd-section-list-renderer");
  if ((!n && !omni.showMuted) || state.active || !list || !list.parentElement) {
    if (note) note.remove();
    return;
  }
  if (!note) {
    note = document.createElement("div");
    note.className = "ytcs-mutenote";
    list.parentElement.insertBefore(note, list);
  }
  note.textContent = "";
  note.appendChild(omniIcon("mute", 14));
  const t = document.createElement("span");
  t.textContent = omni.showMuted
    ? "Showing results from channels you muted"
    : cap(plural(n, "result")) + " from channels you muted, hidden";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ytcs-mutenote-btn";
  b.textContent = omni.showMuted ? "Hide them again" : "Show them";
  b.onclick = () => {
    omni.showMuted = !omni.showMuted;
    hideMutedResults();
  };
  note.appendChild(t);
  note.appendChild(b);
}

// A short message at the foot of the page, with one action, gone by itself.
function toast(text, action, onAction) {
  const old = document.querySelector(".ytcs-toast");
  if (old) old.remove();
  const t = document.createElement("div");
  t.className = "ytcs-toast";
  t.setAttribute("role", "status");
  const s = document.createElement("span");
  s.textContent = text;
  t.appendChild(s);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action;
    b.onclick = () => {
      onAction();
      t.remove();
    };
    t.appendChild(b);
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// ---- following searches, in the bar ----------------------------------------------------------
function omniHead(key) {
  const head = document.createElement("div");
  head.className = "ytcs-omni-head";
  head.appendChild(omniIcon(key, 13));
  const name = document.createElement("span");
  name.textContent = OMNI_HEADS[key] || key;
  head.appendChild(name);
  return head;
}

// One followed search with news: its newest find as the thumbnail, the query
// as the title, and how many are waiting.
function followRow(item) {
  const q = item.entry.q;
  const f = parseOmniQuery(q);
  const a = document.createElement("a");
  a.className = "ytcs-omni-row ytcs-follow";
  a.href = searchUrl(f.query, compileSp(f));
  a.dataset.q = q;
  a.tabIndex = -1;
  a.appendChild(omniThumb(item.fresh[0], "ytcs-omni-thumb"));
  const text = document.createElement("span");
  text.className = "ytcs-omni-text";
  const title = document.createElement("span");
  title.className = "ytcs-omni-title";
  title.textContent = q;
  const meta = document.createElement("span");
  meta.className = "ytcs-omni-meta";
  factsInto(meta, [plural(item.fresh.length, "new video"), item.fresh[0].title]);
  text.appendChild(title);
  text.appendChild(meta);
  a.appendChild(text);
  const count = document.createElement("span");
  count.className = "ytcs-follow-count";
  count.textContent = item.fresh.length > 99 ? "99+" : String(item.fresh.length);
  a.appendChild(count);
  return a;
}

// Under a filtered query: follow it, or stop.
function followOffer(raw) {
  const row = document.createElement("div");
  row.className = "ytcs-omni-follow";
  const on = isFollowing(raw);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ytcs-omni-followbtn" + (on ? " ytcs-on" : "");
  b.appendChild(omniIcon("follow", 13));
  b.appendChild(document.createTextNode(on ? "Following this search" : "Follow this search"));
  const note = document.createElement("span");
  note.className = "ytcs-omni-follownote";
  note.textContent = on ? "Click to stop" : "New matches will wait for you here";
  b.onclick = () => {
    if (on) unfollow(raw);
    else follow(raw);
    setTimeout(omniRender, 50);
  };
  row.appendChild(b);
  row.appendChild(note);
  return row;
}

/*
 * Opening a followed search's news. The page opens on the search with its
 * filters, narrowed to this month's uploads since that is where its news came
 * from, and the new videos arrive marked NEW at the top of the panel.
 */
async function openFollow(q) {
  const f = parseOmniQuery(q);
  const item = (await followsWithNews()).find((n) => n.entry.q === q);
  state.followFresh = item ? item.fresh : null;
  await markFollowRead(q);
  omni.news = await followsWithNews();
  try {
    sessionStorage.setItem(OMNI_PENDING, JSON.stringify({ q: f.query, f: packFilters(f), at: Date.now() }));
  } catch (e) { /* the search still opens, just without the panel's filters */ }
  navigateTo(searchUrl(f.query, compileSp(Object.assign({}, f, { maxAge: Math.min(f.maxAge, 31) }))));
}


// Coalesced, because YouTube adds result cards a few at a time as you scroll.
function scheduleBadges() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(badgeResults, 250);
}

function watchForCards() {
  const root = document.querySelector("ytd-page-manager") || document.getElementById("page");
  if (!root || (badgeObs && badgeObs.root === root)) return;
  if (badgeObs) badgeObs.obs.disconnect();
  const obs = new MutationObserver(scheduleBadges);
  obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  badgeObs = { obs, root };
}

// ---- wiring -------------------------------------------------------------------
function omniTick() {
  omniAttach();
  // Muting and "shown before" work with or without the library, so the card
  // watcher always runs; only the library strip needs the library.
  watchForCards();
  if (!cfg.librarySearch) return;
  if (isSearchPage() && !state.omniScope && !document.querySelector(".ytcs-libstrip")) renderLibraryStrip();
}

if (!window.__ytcsOmniLoaded) {
  window.__ytcsOmniLoaded = true;
  onLibraryChange(() => {
    omniSchedule();
    renderLibraryStrip();
    badgeResults();
  });
  onFollowsChange(() => {
    followsWithNews().then((n) => {
      omni.news = n;
      if (omni.focused) omniSchedule();
    });
  });
  // After panel.js's own navigation handler, which tears the panel down at 0ms
  // and puts the launcher back at 300ms.
  window.addEventListener("yt-navigate-finish", () => {
    state.omniScope = "";
    state.stripFilters = null;
    omniResetControls();
    setTimeout(omniArrive, 700);
    scheduleBadges();
  });
  setInterval(omniTick, 1500);
  omniTick();
  // The marks need the library, which is only read when the search bar is used,
  // so a cached copy is loaded quietly here; nothing is fetched until it is stale
  // and the bar is actually clicked.
  if (cfg.librarySearch) {
    idbGet(LIB_KEY).then((rec) => {
      if (rec && !library.loaded) {
        library.wl = rec.wl || [];
        library.hist = rec.hist || [];
        library.liked = rec.liked || [];
        library.at = rec.at || 0;
        library.loaded = true;
        badgeResults();
      }
    });
  }
  // A full page load straight onto a results page gets no navigate event.
  if (isSearchPage()) setTimeout(omniArrive, 900);
}
