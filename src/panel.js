/*
 * Needle for YouTube
 * Panel construction, the grid takeover, and startup.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- UI helpers ----------------------------------------------------------
/*
 * Filter controls are pills, not labelled fields. Every option string names its
 * own dimension ("Any length" -> "4 - 20 min"), so the control describes itself
 * and the row above it can disappear. A stack of uppercase captions over a row
 * of identical grey boxes was the single most generic thing in this panel.
 *
 * `dim` marks the pill as untouched. filterAndSort already treats "" as no
 * filter, so this is purely how it reads: active filters look chosen.
 */
function pill(opts, title) {
  const s = document.createElement("select");
  s.className = "ytcs-pill ytcs-dim";
  if (title) s.title = title;
  for (const [val, label] of opts) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    s.appendChild(o);
  }
  s.addEventListener("change", () => s.classList.toggle("ytcs-dim", !s.value));
  return s;
}

function ghostBtn(label, title) {
  const b = document.createElement("button");
  b.className = "ytcs-ghost";
  b.textContent = label;
  if (title) b.title = title;
  return b;
}

/*
 * A button that opens the same menu the filter pills use, for a list of
 * actions rather than values. The hidden select is only there because the menu
 * reads its options from one; nothing stays selected, so the menu never marks
 * an action as current, and each pick runs once.
 */
function actionMenu(name, title, items, onPick) {
  const sel = document.createElement("select");
  for (const [value, label] of items) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.selectedIndex = -1;
  sel.hidden = true;
  sel.tabIndex = -1;
  sel.addEventListener("change", () => {
    const v = sel.value;
    sel.selectedIndex = -1;
    if (v) onPick(v);
  });
  const slot = document.createElement("div");
  slot.className = "ytcs-f ytcs-actmenu";
  const label = ghostBtn(name + " ▾", title);
  label.setAttribute("aria-haspopup", "listbox");
  label.onclick = (e) => {
    e.preventDefault();
    sel.selectedIndex = -1;
    toggleMenu(slot, sel, name, label);
  };
  slot.appendChild(label);
  slot.appendChild(sel);
  return slot;
}

function icon(path, size) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size || 16));
  svg.setAttribute("height", String(size || 16));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

const ICON_SEARCH = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4";
const ICON_REFRESH = "M20 11A8 8 0 1 0 18.4 16M20 5v6h-6";

/*
 * Option sets live here rather than inline in buildUi, because two of the
 * controls change meaning between a channel and watch history and have to be
 * relabelled at open time. See labelForSource.
 */
const SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["starthere", "Start here"],
  ["views_desc", "Most views"],
  ["views_asc", "Fewest views"],
  ["duration_desc", "Longest"],
  ["duration_asc", "Shortest"],
  ["trend_desc", "Trending (measured)"],
  ["gems_desc", "Hidden gems"],
  ["title_az", "Title A→Z"],
];
// Only offered where a watch date exists, which is history and nowhere else.
const WATCH_SORTS = [
  ["watched_desc", "Recently watched"],
  ["watched_asc", "Watched longest ago"],
];

const DATE_OPTS = [
  ["", "Any time"],
  ["7", "Past week"],
  ["31", "Past month"],
  ["93", "Past 3 months"],
  ["366", "Past year"],
  ["old", "Over a year ago"],
  ["__custom", "Custom…"],
];
const WATCH_DATE_OPTS = [
  ["", "Any time"],
  ["7", "Watched this week"],
  ["31", "Watched this month"],
  ["93", "Watched in 3 months"],
  ["366", "Watched this year"],
  ["old", "Over a year ago"],
  ["__custom", "Custom…"],
];

// Deep link to the listing's reviews tab, which opens the rating box directly
// rather than dropping someone on the description they have already read.
const STORE_REVIEW_URL =
  "https://chromewebstore.google.com/detail/needle-for-youtube-channe/magofcbhfhpfabphcldhodhgehhclokc/reviews";
const RATE_KEY = "rateAsk";
/*
 * Two days of use, not a number of clicks.
 *
 * 2.1 asked from the third use, and one reviewer in sixty weekly users said what
 * that was worth. Three uses can all happen in the first five minutes, from
 * somebody still deciding whether to keep it. Coming back on a second day is
 * the thing that means it earned a place, so that is what the ask waits for.
 */
const RATE_DAYS = 2;
// "Not now" puts it away for this many more uses, at most this many times in
// all. After the last one it is finished, as if they had said never.
const RATE_SNOOZE = 5;
const RATE_MAX_ASKS = 3;
// A list this long cut down to this few is the clearest moment it just helped.
const RATE_WIN_FROM = 40;
const RATE_WIN_TO = 12;

// ---- UI construction (in-page grid takeover) -----------------------------
/*
 * One filter, in whichever of two places it currently belongs.
 *
 * Unset, it sits in the row under the query as a quiet "+ Length". Set, it moves
 * into the query field itself as a token reading "20 – 60 min", with an x that
 * clears it. The select never changes; only its wrapper moves, and the select is
 * laid transparently over the wrapper so clicking either form opens the same
 * native menu. That keeps every existing reader of ui.duration.value working
 * and gives the panel the same shape as the search bar: what you asked for, in
 * the box where you asked for it.
 */
function filterSlot(sel, name) {
  const slot = document.createElement("div");
  slot.className = "ytcs-f";
  // The pill itself is a button that opens the panel's own menu. The select
  // stays, hidden, as the store for the value: every filter reads it, and the
  // browser's native dropdown could not be positioned, so it opened flush left
  // of an invisible box instead of under the pill that was clicked.
  const label = document.createElement("button");
  label.type = "button";
  label.className = "ytcs-flabel";
  label.setAttribute("aria-haspopup", "listbox");
  label.setAttribute("aria-label", name);
  label.onclick = (e) => {
    e.preventDefault();
    toggleMenu(slot, sel, name, label);
  };
  const x = document.createElement("button");
  x.type = "button";
  x.className = "ytcs-fx";
  x.setAttribute("aria-label", "Remove " + name.toLowerCase() + " filter");
  x.textContent = "×";
  x.onclick = (e) => {
    e.preventDefault();
    closeMenu();
    sel.value = "";
    sel.classList.add("ytcs-dim");
    applyView();
  };
  /*
   * "Custom…" is a menu entry, not a value. The menu opens the range editor for
   * it directly; this guard is for anything else that sets the select, so the
   * placeholder can never reach the filter.
   */
  const custom = (e) => {
    if (sel.value !== "__custom") return;
    e.stopImmediatePropagation();
    sel.value = sel.dataset.prev || "";
  };
  sel.addEventListener("input", custom);
  sel.addEventListener("change", custom);
  sel.classList.remove("ytcs-pill");
  sel.classList.add("ytcs-fsel");
  sel.hidden = true;
  sel.tabIndex = -1;
  slot.appendChild(label);
  slot.appendChild(sel);
  slot.appendChild(x);
  return { slot, label, sel, name };
}

/*
 * ---- the filter menu -----------------------------------------------------------
 *
 * One menu open at a time, centred under the pill it belongs to and nudged back
 * inside the panel if that would push it past an edge (Sort, at the far right,
 * always is). Picking an option sets the hidden select and fires the same
 * events a native pick would, so nothing downstream knows the difference.
 */
let openMenu = null;

function closeMenu(refocus) {
  if (!openMenu) return;
  const { el, slot, label } = openMenu;
  openMenu = null;
  el.remove();
  slot.classList.remove("ytcs-open");
  label.setAttribute("aria-expanded", "false");
  if (refocus) label.focus();
}

function chooseOption(sel, value, name) {
  if (value === "__custom") {
    openCustom(name);
    return;
  }
  sel.value = value;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

function toggleMenu(slot, sel, name, label) {
  if (openMenu && openMenu.slot === slot) {
    closeMenu(true);
    return;
  }
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "ytcs-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", name);
  // "Custom…" always last, even after ranges typed or set by the editor, which
  // are appended to the select as they are made.
  const opts = Array.from(sel.options);
  const ordered = opts.filter((o) => o.value !== "__custom").concat(opts.filter((o) => o.value === "__custom"));
  for (const o of ordered) {
    const on = o.value === sel.value;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ytcs-menuitem" + (on ? " ytcs-sel" : "") + (o.value === "__custom" ? " ytcs-menucustom" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", on ? "true" : "false");
    item.textContent = o.textContent;
    if (o.dataset.count) {
      const c = document.createElement("span");
      c.className = "ytcs-menucount";
      c.textContent = o.dataset.count;
      item.appendChild(c);
    }
    item.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      chooseOption(sel, o.value, name);
    };
    menu.appendChild(item);
  }
  menu.addEventListener("keydown", (e) => {
    const items = Array.from(menu.querySelectorAll(".ytcs-menuitem"));
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") items[Math.min(items.length - 1, i + 1)].focus();
    else if (e.key === "ArrowUp") items[Math.max(0, i - 1)].focus();
    else if (e.key === "Home") items[0].focus();
    else if (e.key === "End") items[items.length - 1].focus();
    else if (e.key === "Escape") closeMenu(true);
    else if (e.key === "Tab") closeMenu();
    else return;
    if (e.key !== "Tab") e.preventDefault();
  });
  slot.appendChild(menu);
  slot.classList.add("ytcs-open");
  label.setAttribute("aria-expanded", "true");
  openMenu = { el: menu, slot, label };

  // Centred by CSS; pulled back in here if centring would cross an edge.
  const r = menu.getBoundingClientRect();
  const bounds = ui.wrap.getBoundingClientRect();
  const over = r.right - (bounds.right - 8);
  const under = bounds.left + 8 - r.left;
  if (over > 0) menu.style.transform = "translateX(calc(-50% - " + Math.ceil(over) + "px))";
  else if (under > 0) menu.style.transform = "translateX(calc(-50% + " + Math.ceil(under) + "px))";
  (menu.querySelector(".ytcs-sel") || menu.firstChild).focus();
}

// A click anywhere outside the open menu closes it, as does Escape.
document.addEventListener("mousedown", (e) => {
  if (openMenu && !openMenu.slot.contains(e.target)) closeMenu();
}, true);

function buildUi() {
  const wrap = document.createElement("div");
  wrap.className = "ytcs-wrap";

  // ---- row 1: identity, what this is a list of, and the actions -----------
  const head = document.createElement("div");
  head.className = "ytcs-head";

  // The same drawn needle as the corner button, so the two read as one thing.
  const brand = document.createElement("span");
  brand.className = "ytcs-brand";
  brand.setAttribute("role", "img");
  brand.setAttribute("aria-label", "Needle");
  brand.title = "Needle";
  brand.appendChild(needleMark(24));

  // What is loaded, in words: "@veritasium", "Your Watch Later", "“rust”".
  const source = document.createElement("span");
  source.className = "ytcs-source";

  const tabs = document.createElement("div");
  tabs.className = "ytcs-tabs";
  tabs.setAttribute("role", "tablist");
  const mkTab = (label, on) => {
    const b = document.createElement("button");
    b.className = "ytcs-tab" + (on ? " ytcs-tabon" : "");
    b.textContent = label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", on ? "true" : "false");
    tabs.appendChild(b);
    return b;
  };
  const tabSearch = mkTab("Search", true);
  const tabInsights = mkTab("Insights");

  const status = document.createElement("span");
  status.className = "ytcs-status";

  const refresh = document.createElement("button");
  refresh.className = "ytcs-iconbtn";
  refresh.title = "Re-read the channel and flag anything new";
  refresh.setAttribute("aria-label", "Refresh catalogue");
  refresh.appendChild(icon(ICON_REFRESH));
  refresh.onclick = () => refreshCatalog();

  const restore = document.createElement("button");
  restore.className = "ytcs-restore";
  restore.textContent = "Close";
  restore.title = "Close the panel and put YouTube's page back";
  restore.onclick = () => disable();

  /*
   * What to do with the result: play it, or take it somewhere. Both act on the
   * picked videos when there are any, otherwise on everything the filters left.
   * One menu rather than six buttons, since the header already holds a lot.
   */
  const play = ghostBtn("Play", "Play these in order, up to " + PLAY_MAX + ", as a temporary YouTube playlist");
  play.onclick = () => playRows();
  const exportMenu = actionMenu("Export", "Copy, share or download these videos", [
    ["links", "Copy links, for NotebookLM"],
    ["list", "Copy titles and links"],
    ["md", "Copy as a Markdown list"],
    ["share", "Copy a link to this filter"],
    ["csv", "Download CSV"],
    ["json", "Download JSON"],
  ], (v) => {
    if (v === "share") copyShareLink();
    else if (v === "csv") exportCSV();
    else if (v === "json") exportJSON();
    else copyRows(v);
  });
  const exports = document.createElement("span");
  exports.className = "ytcs-exports";
  exports.appendChild(play);
  exports.appendChild(exportMenu);

  // Grid or list. A list fits three times as many videos on screen, which is
  // what a long Watch Later or history needs; a grid is for browsing a channel.
  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "ytcs-iconbtn ytcs-viewbtn";
  viewBtn.onclick = () => setListView(!state.listView);

  // Watch Later only: pick videos, then remove them. See the selection bar.
  const selectBtn = ghostBtn("Select", "Pick videos to remove from your Watch Later");
  selectBtn.classList.add("ytcs-selectbtn");
  selectBtn.style.display = "none";
  selectBtn.onclick = () => (state.selecting ? endSelecting() : startSelecting());

  head.appendChild(brand);
  head.appendChild(source);
  head.appendChild(status);
  const hspacer = document.createElement("span");
  hspacer.className = "ytcs-spacer";
  head.appendChild(hspacer);
  // Follow this search, filters and all. Results pages only; see
  // updateFollowButton, which keeps its label honest as the filters change.
  const followBtn = document.createElement("button");
  followBtn.type = "button";
  followBtn.className = "ytcs-followbtn";
  followBtn.appendChild(icon("M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0", 15));
  followBtn.appendChild(document.createTextNode("Follow"));
  followBtn.style.display = "none";
  followBtn.onclick = () => {
    const q = panelQueryString();
    if (isFollowing(q)) unfollow(q);
    else follow(q);
    setTimeout(updateFollowButton, 50);
  };
  head.appendChild(followBtn);
  head.appendChild(selectBtn);
  head.appendChild(tabs);
  // Export sits with the other actions rather than among the filters: it is a
  // thing you do to the result, not a thing that changes it.
  head.appendChild(exports);
  head.appendChild(viewBtn);
  head.appendChild(refresh);
  head.appendChild(restore);

  // ---- row 2: the query, with the filters it carries as tokens ------------
  const filters = document.createElement("div");
  filters.className = "ytcs-filters";

  const searchBox = document.createElement("div");
  searchBox.className = "ytcs-query";
  searchBox.appendChild(icon(ICON_SEARCH, 17));
  const tokens = document.createElement("span");
  tokens.className = "ytcs-tokens";
  searchBox.appendChild(tokens);
  const kw = document.createElement("input");
  kw.type = "text";
  kw.placeholder = "Search this channel's titles";
  kw.className = "ytcs-search";
  kw.setAttribute("aria-label", "Search this channel's titles");
  searchBox.appendChild(kw);
  // The query's own underline, filled to the share of the list still showing.
  // "6 of 448" as a length, where the eye already is.
  const meter = document.createElement("span");
  meter.className = "ytcs-meter";
  const meterFill = document.createElement("span");
  meterFill.className = "ytcs-meterfill";
  meter.appendChild(meterFill);
  searchBox.appendChild(meter);

  const duration = pill([
    ["", "Any length"],
    ["0-60", "Under 1 min"],
    ["60-240", "1 – 4 min"],
    ["240-1200", "4 – 20 min"],
    ["1200-3600", "20 – 60 min"],
    ["3600-", "Over 60 min"],
    ["__custom", "Custom…"],
  ], "Video length");
  const views = pill([
    ["", "Any views"],
    ["0-10000", "Under 10K"],
    ["10000-100000", "10K – 100K"],
    ["100000-1000000", "100K – 1M"],
    ["1000000-10000000", "1M – 10M"],
    ["10000000-", "Over 10M"],
    ["__custom", "Custom…"],
  ], "View count");
  const uploaded = pill(DATE_OPTS, "Upload date");
  const watched = pill([
    ["", "Watched: any"],
    ["new", "Not started"],
    ["unfinished", "Not finished"],
    ["partial", "Still watching"],
    ["done", "Finished"],
  ], "Your watch history on this channel");
  // Presets rather than a free number box: it makes the feature discoverable,
  // and it keeps the row one consistent kind of control.
  const fits = pill([
    ["", "Any free time"],
    ["10", "10 min free"],
    ["20", "20 min free"],
    ["30", "30 min free"],
    ["45", "45 min free"],
    ["60", "1 hour free"],
  ], "Only show videos that fit the time you have");

  /*
   * Who made them, as a menu of the channels actually in this list with how
   * many each has, biggest first. Picking one is the same filter as typing
   * @name, so it lands as that token and this stays a picker, never a value.
   * Only offered where a list spans channels: on a channel page it would be a
   * menu of one.
   */
  const chan = pill([["", "Any channel"]], "Channel");
  chan.addEventListener("change", () => {
    if (!chan.value) return;
    state.extra.channel = chan.value;
    chan.value = "";
    chan.classList.add("ytcs-dim");
    applyView();
  });

  const sort = pill(SORTS, "Sort order");
  sort.classList.remove("ytcs-dim");
  sort.classList.add("ytcs-sort");

  const count = document.createElement("span");
  count.className = "ytcs-count";

  const clear = ghostBtn("Clear", "Reset every filter");
  clear.classList.add("ytcs-clear");
  clear.style.display = "none";
  clear.onclick = () => {
    ui.kw.value = "";
    for (const el of [ui.duration, ui.views, ui.uploaded, ui.watched, ui.fits]) {
      el.value = "";
      el.classList.add("ytcs-dim");
    }
    state.extra = freshExtra();
    // Back to the order this page opened in, which is not "newest" on history
    // or for anyone who picked another opening sort in the popup.
    ui.sort.value = ui.sort.dataset.def || "newest";
    applyView();
  };
  searchBox.appendChild(count);
  searchBox.appendChild(clear);

  // Typed filters work here exactly as they do in YouTube's own search bar:
  // "<20m" plus a space becomes a Length token and leaves the box.
  kw.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && typeof absorbOperators === "function") absorbOperators(true);
    // Backspace in an empty box takes the last token back out, like any tag field.
    if (e.key === "Backspace" && !kw.value && typeof popLastToken === "function") popLastToken();
  });
  kw.addEventListener("input", () => {
    if (/\s$/.test(kw.value) && typeof absorbOperators === "function") absorbOperators(false);
  });

  const slots = [
    filterSlot(duration, "Length"),
    filterSlot(views, "Views"),
    filterSlot(uploaded, "Date"),
    filterSlot(watched, "Watched"),
    filterSlot(fits, "Free time"),
  ];
  const sortSlot = filterSlot(sort, "Sort");
  sortSlot.slot.classList.add("ytcs-sortslot");
  const chanSlot = filterSlot(chan, "Channel");
  chanSlot.slot.classList.add("ytcs-chanslot");

  // Unset filters wait here, one quiet line under the query.
  const addrow = document.createElement("div");
  addrow.className = "ytcs-addrow";
  for (const s of slots) addrow.appendChild(s.slot);
  addrow.appendChild(chanSlot.slot);
  const fspacer = document.createElement("span");
  fspacer.className = "ytcs-spacer";
  addrow.appendChild(fspacer);
  addrow.appendChild(sortSlot.slot);

  filters.appendChild(searchBox);
  filters.appendChild(addrow);
  // The range editor that "Custom…" opens, under the row it came from.
  const customRow = document.createElement("div");
  customRow.className = "ytcs-custom";
  customRow.hidden = true;
  filters.appendChild(customRow);

  const stats = document.createElement("div");
  stats.className = "ytcs-stats";

  const grid = document.createElement("div");
  grid.className = "ytcs-grid";

  // ---- Insights: one pane, three sections behind a secondary nav ----------
  const insights = document.createElement("div");
  insights.className = "ytcs-insights";
  insights.style.display = "none";

  const subnav = document.createElement("div");
  subnav.className = "ytcs-subnav";
  subnav.setAttribute("role", "tablist");
  const mkSub = (label, on) => {
    const b = document.createElement("button");
    b.className = "ytcs-sub" + (on ? " ytcs-subon" : "");
    b.textContent = label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", on ? "true" : "false");
    subnav.appendChild(b);
    return b;
  };
  const subOverview = mkSub("Overview", true);
  const subCompare = mkSub("Compare");
  const subWatchlist = mkSub("Watchlist");
  insights.appendChild(subnav);

  // Overview: the charts drawn from whatever the filters currently select.
  const paneOverview = document.createElement("div");
  paneOverview.className = "ytcs-pane";
  const charts = document.createElement("div");
  charts.className = "ytcs-charts";
  paneOverview.appendChild(charts);

  // Compare
  const compare = document.createElement("div");
  compare.className = "ytcs-pane";
  compare.style.display = "none";
  const cmpIntro = document.createElement("p");
  cmpIntro.className = "ytcs-explain";
  cmpIntro.textContent =
    "Read another channel's full catalogue and line its numbers up against this one.";
  const cmpRow = document.createElement("div");
  cmpRow.className = "ytcs-inputrow";
  const cmpInput = document.createElement("input");
  cmpInput.type = "text";
  cmpInput.className = "ytcs-textin";
  cmpInput.placeholder = "@handle or channel URL";
  const cmpBtn = document.createElement("button");
  cmpBtn.className = "ytcs-primary";
  cmpBtn.textContent = "Compare";
  const cmpStatus = document.createElement("span");
  cmpStatus.className = "ytcs-status";
  cmpRow.appendChild(cmpInput);
  cmpRow.appendChild(cmpBtn);
  cmpRow.appendChild(cmpStatus);
  const cmpResult = document.createElement("div");
  cmpResult.className = "ytcs-cmpresult";
  compare.appendChild(cmpIntro);
  compare.appendChild(cmpRow);
  compare.appendChild(cmpResult);

  // Watchlist
  const niche = document.createElement("div");
  niche.className = "ytcs-pane";
  niche.style.display = "none";
  const nicheIntro = document.createElement("p");
  nicheIntro.className = "ytcs-explain";
  nicheIntro.textContent =
    "Track a set of channels, then refresh. You get back every video beating its own " +
    "channel's normal pace by a wide margin, ranked across all of them, and the topics " +
    "they cover that this channel never has.";
  const nicheRow = document.createElement("div");
  nicheRow.className = "ytcs-inputrow";
  const nicheInput = document.createElement("input");
  nicheInput.type = "text";
  nicheInput.className = "ytcs-textin";
  nicheInput.placeholder = "@handle or channel URL";
  const nicheAdd = document.createElement("button");
  nicheAdd.className = "ytcs-primary";
  nicheAdd.textContent = "Track";
  nicheAdd.title = "Add this channel to the watchlist";
  const nicheRefresh = ghostBtn("Refresh all", "Read every tracked channel and rank what is working");
  const nicheStatus = document.createElement("span");
  nicheStatus.className = "ytcs-status";
  nicheRow.appendChild(nicheInput);
  nicheRow.appendChild(nicheAdd);
  nicheRow.appendChild(nicheRefresh);
  nicheRow.appendChild(nicheStatus);
  const nicheChips = document.createElement("div");
  nicheChips.className = "ytcs-chips";
  const nicheResults = document.createElement("div");
  nicheResults.className = "ytcs-nresults";
  niche.appendChild(nicheIntro);
  niche.appendChild(nicheRow);
  niche.appendChild(nicheChips);
  niche.appendChild(nicheResults);

  insights.appendChild(paneOverview);
  insights.appendChild(compare);
  insights.appendChild(niche);

  /*
   * ---- the one ask --------------------------------------------------------
   *
   * Store ranking runs on installs and ratings, and a listing with no ratings
   * sits below identical ones that have them however good it is. So this asks,
   * and only of the people worth asking: somebody who came back on a second day
   * has an opinion, and somebody on their first visit does not.
   *
   * Sits directly under the count line rather than at the foot of the panel.
   * The foot is below every card, so on a 236-video channel it is a very long
   * scroll away and nobody would ever reach it. The count line is where the eye
   * already is the moment the tool has done its job and "236 of 236" has just
   * become "6 of 236", which is also the moment somebody feels like saying yes.
   *
   * So that is the only time it appears (rateMoment): right after a long list
   * was cut to a handful, or a clean-up went through, and on one page a day at
   * most. In 2.1 it sat there from the third use onwards, on every open, and
   * a line that is always there is a line nobody reads.
   *
   * It stays clear of the filter row above it, since a bar across the top of a
   * tool you just opened reads as an advert for the tool you are already using.
   *
   * "Not now" puts it away for a while, "Don't ask again" and rating end it.
   * Three "Not now"s also end it. It never offers anything for a rating and it
   * asks everybody the same way, which is what the store's rules require.
   */
  const rate = document.createElement("div");
  rate.className = "ytcs-rate";
  rate.hidden = true;

  const rateStar = icon("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z", 14);
  rateStar.classList.add("ytcs-ratestar");

  const rateText = document.createElement("span");
  rateText.className = "ytcs-ratetext";
  rateText.textContent = "Finding Needle useful? A quick rating helps other people find it.";

  const rateGo = document.createElement("button");
  rateGo.className = "ytcs-ratego";
  rateGo.textContent = "Rate it";
  rateGo.onclick = () => {
    window.open(STORE_REVIEW_URL, "_blank", "noopener");
    closeRating();
  };

  const rateLater = ghostBtn("Not now", "Ask again some other time");
  rateLater.onclick = () => snoozeRating();
  const rateNo = ghostBtn("Don't ask again", "Never show this again");
  rateNo.onclick = () => closeRating();

  rate.appendChild(rateStar);
  rate.appendChild(rateText);
  rate.appendChild(rateGo);
  rate.appendChild(rateLater);
  rate.appendChild(rateNo);

  const foot = document.createElement("div");
  foot.className = "ytcs-foot";
  foot.textContent = "Press ? for keys. Reads public data through YouTube's own endpoints. Not affiliated with YouTube.";

  // Both rows stick as one block. Two separately-sticky rows would need their
  // tops kept in sync with the header's rendered height, which does not survive
  // a wrap at narrow widths.
  const chrome = document.createElement("div");
  chrome.className = "ytcs-chrome";
  chrome.appendChild(head);
  chrome.appendChild(filters);
  // Select mode's bar: how many are picked and what to do with them. Part of
  // the sticky block, so it stays in reach however far down a long list you are.
  const selbar = document.createElement("div");
  selbar.className = "ytcs-selbar";
  selbar.hidden = true;
  chrome.appendChild(selbar);

  wrap.appendChild(chrome);
  wrap.appendChild(stats);
  // Between the count line and whichever pane is showing. setView only toggles
  // grid and insights, so this stays visible on both tabs.
  wrap.appendChild(rate);
  wrap.appendChild(grid);
  wrap.appendChild(insights);
  wrap.appendChild(foot);

  ui = {
    wrap, head, filters, kw, duration, views, uploaded, watched, fits, sort, chan, chanSlot,
    status, count, clear, stats, grid, viewBtn, selectBtn, selbar,
    source, tokens, meterFill, addrow, slots, sortSlot, customRow, followBtn,
    insights, charts, rate,
    tabSearch, tabInsights,
    insightPanes: { overview: paneOverview, compare: compare, watchlist: niche },
    insightTabs: { overview: subOverview, compare: subCompare, watchlist: subWatchlist },
    cmpInput, cmpBtn, cmpStatus, cmpResult,
    niche, nicheInput, nicheAdd, nicheRefresh, nicheStatus, nicheChips, nicheResults,
  };

  cmpResult.appendChild(emptyNote("Enter a channel above to line it up against this one."));

  tabSearch.onclick = () => setView("search");
  tabInsights.onclick = () => setView("insights");
  subOverview.onclick = () => setInsight("overview");
  subCompare.onclick = () => setInsight("compare");
  subWatchlist.onclick = () => setInsight("watchlist");

  cmpBtn.onclick = () => runCompare();
  cmpInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runCompare(); });

  nicheAdd.onclick = async () => {
    const url = normalizeChannelInput(nicheInput.value);
    const key = url && channelKeyFromUrl(url);
    if (!key) { nicheStatus.textContent = "Couldn't read that channel address"; return; }
    const already = state.watchlist.indexOf(key) !== -1;
    if (!already) state.watchlist.push(key);
    await saveWatchlist(state.watchlist);
    nicheInput.value = "";
    // Existing results predate this channel, so they no longer describe the
    // list they claim to. Same reasoning as removal.
    if (!already) clearNicheResults();
    nicheStatus.textContent = already
      ? "Already tracking that one"
      : cap(plural(state.watchlist.length, "channel")) + " tracked. Refresh to update";
    renderNiche();
  };
  nicheRefresh.onclick = () => refreshWatchlist();

  /*
   * One redraw per change. The menus used to listen for both input and change,
   * which a pick fires together, so every pick drew the grid twice. Typing
   * waits for a short pause once the list is big enough for a redraw to be
   * felt: 600 cards took ~25ms on a fast desktop, every key, more on a laptop.
   */
  kw.addEventListener("input", () => {
    clearTimeout(typingTimer);
    typingTimer = 0;
    if (state.catalog.length < 300) applyView();
    else typingTimer = setTimeout(flushTyping, 120);
  });
  for (const el of [duration, views, uploaded, watched, fits, sort]) el.addEventListener("change", applyView);
  // In select mode a click on a card picks it rather than opening the video.
  grid.addEventListener("click", (e) => {
    if (!state.selecting) return;
    const card = e.target.closest && e.target.closest("a.ytcs-card");
    if (!card || !card.dataset.id) return;
    e.preventDefault();
    toggleSelected(card.dataset.id, card);
  });
  setListView(viewPrefs[viewKind()], true);
  layoutTokens();
}

// A redraw the search box is holding back until typing pauses, run now.
let typingTimer = 0;
function flushTyping() {
  if (!typingTimer) return;
  clearTimeout(typingTimer);
  typingTimer = 0;
  applyView();
}

// ---- grid or list ----------------------------------------------------------------
const ICON_GRID = "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z";
const ICON_LIST = "M4 6h16M4 12h16M4 18h16";

/*
 * Lists (Watch Later, Liked, playlists, history) open as a list, the way
 * YouTube shows them; channels, subscriptions and search open as a grid. Each
 * remembers its own switch.
 */
const viewPrefs = { lists: true, feeds: false };
const VIEW_KEYS = { lists: "listViewLists", feeds: "listView" };

function viewKind() {
  return playlistId() || isHistoryPage() ? "lists" : "feeds";
}

function setListView(on, quiet) {
  state.listView = !!on;
  if (!quiet) {
    const kind = viewKind();
    viewPrefs[kind] = state.listView;
    try { chrome.storage.local.set({ [VIEW_KEYS[kind]]: state.listView }); } catch (e) { /* it still switches */ }
  }
  if (!ui) return;
  ui.grid.classList.toggle("ytcs-listview", state.listView);
  ui.viewBtn.textContent = "";
  // The button shows what a click switches to.
  ui.viewBtn.appendChild(icon(state.listView ? ICON_GRID : ICON_LIST));
  const label = state.listView ? "Show as a grid" : "Show as a list";
  ui.viewBtn.title = label;
  ui.viewBtn.setAttribute("aria-label", label);
}

// ---- the channel picker --------------------------------------------------------------
/*
 * Rebuilt only when the list itself changes, not on every keystroke: counting a
 * few thousand videos by channel is cheap, but not something to repeat for each
 * letter typed. Top 40, since a menu longer than that is a list nobody reads.
 */
let facetFor = null;
function refreshChannelFacet() {
  if (!ui || !ui.chan) return;
  if (facetFor === state.catalog) return;
  facetFor = state.catalog;
  const counts = new Map();
  for (const v of state.catalog) {
    const c = (v.channel || "").trim();
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
  ui.chan.textContent = "";
  for (const [val, label, n] of [["", "Any channel", 0]].concat(top.map(([name, k]) => [name, name, k]))) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    // The menu shows the count in its own column; see toggleMenu.
    if (n) o.dataset.count = String(n);
    ui.chan.appendChild(o);
  }
  ui.chan.value = "";
  ui.chanSlot.label.textContent = "Channel";
  ui.chanSlot.slot.style.display = !isChannelPage() && counts.size > 1 ? "" : "none";
}

// ---- select and change: Watch Later, your own playlists, Liked videos -------------
/*
 * The only places the panel changes anybody's account. Select mode turns every
 * card into a checkbox; the bar above the grid says how many are picked and
 * offers the two picks people actually want (everything the filters left, and
 * everything already finished) before the one that acts.
 *
 * Changing always asks first, in the bar, not in a browser dialog. The first
 * time it also asks for the switch that allows it at all (allowEdits), which is
 * off until then. After it runs, the toast offers Undo, and everything removed
 * goes into the removal archive, so it can still go back after the toast is gone.
 *
 * What can be changed, and how, depends on the list. Watch Later always. A
 * playlist only when its videos arrive carrying YouTube's own "Remove from"
 * action, which only its owner's copy does (see itemRemoveCommand). Liked
 * videos the same way, as an unlike.
 */
function editorHere() {
  if (state.archive) return state.archive.editor;
  const list = playlistId();
  if (!list) return null;
  const own = ownListScope();
  // Nothing to change signed out, and YouTube would refuse it anyway.
  if (own === "wl" && !signedIn()) return null;
  if (own === "wl") {
    return {
      key: "WL", lib: "wl", noun: "Watch Later", picks: "Pick videos to remove from your Watch Later",
      action: "Remove from Watch Later", verb: "Removing", go: (n) => "Remove " + n,
      ask: (n) => "Remove " + plural(n, "video") + " from your Watch Later?",
      consent: "Needle will remove these from your Watch Later on YouTube, with your own sign-in, the way YouTube's page does.",
      did: (n) => "Removed " + plural(n, "video") + " from Watch Later",
      remove: (vs, p) => editWatchLater(vs.map((v) => v.id), false, p),
      restore: (vs, p) => editWatchLater(vs.map((v) => v.id), true, p),
      back: "Put back in Watch Later", backed: (n) => "Put " + plural(n, "video") + " back in Watch Later",
    };
  }
  if (!state.catalog.some((v) => v.rm)) return null;
  if (own === "liked") {
    return {
      key: "LL", lib: "liked", noun: "Liked videos", picks: "Pick videos to unlike",
      action: "Unlike", verb: "Unliking", go: (n) => "Unlike " + n,
      ask: (n) => "Unlike " + plural(n, "video") + "?",
      consent: "Needle will unlike these on YouTube, with your own sign-in, the way YouTube's own button does.",
      did: (n) => "Unliked " + plural(n, "video"),
      remove: (vs, p) => (vs.some((v) => v.rm && v.rm.kind === "unlike") ? setLikes(vs, false, p) : removeFromList("LL", vs, p)),
      restore: (vs, p) => setLikes(vs, true, p),
      back: "Like again", backed: (n) => "Liked " + plural(n, "video") + " again",
    };
  }
  const name = state.listTitle || "this playlist";
  return {
    key: list, lib: null, noun: name, picks: "Pick videos to remove from " + name,
    action: "Remove from playlist", verb: "Removing", go: (n) => "Remove " + n,
    ask: (n) => "Remove " + plural(n, "video") + " from " + name + "?",
    consent: "Needle will remove these from your playlist on YouTube, with your own sign-in, the way YouTube's page does.",
    did: (n) => "Removed " + plural(n, "video") + " from " + name,
    remove: (vs, p) => removeFromList(list, vs, p),
    restore: (vs, p) => addToList(list, vs.map((v) => v.id), p),
    back: "Put back in " + name, backed: (n) => "Put " + plural(n, "video") + " back in " + name,
  };
}

// The switch the first change turns on, saved so the next one does not ask.
function grantEdits() {
  if (cfg.allowEdits) return;
  cfg.allowEdits = true;
  try { chrome.storage.sync.set({ allowEdits: true }); } catch (e) { /* on for this tab regardless */ }
}

// Select appears once a list turns out to be changeable, which for your own
// playlists is only known after its videos have been read.
function syncEditButton() {
  if (!ui) return;
  const ed = editorHere();
  ui.selectBtn.style.display = ed ? "" : "none";
  if (ed) ui.selectBtn.title = ed.picks;
  else endSelecting();
}

function startSelecting() {
  state.selecting = true;
  state.selected = new Set();
  state.confirming = false;
  state.archiveCount = 0;
  ui.selectBtn.textContent = "Done";
  ui.selectBtn.classList.add("ytcs-on");
  ui.grid.classList.add("ytcs-selecting");
  renderSelbar();
  applyView();
  const ed = editorHere();
  const gen = state.navGen;
  if (ed) {
    archiveFor(ed.key).then((list) => {
      if (pageGone(gen) || !state.selecting) return;
      state.archiveCount = list.length;
      renderSelbar();
    });
  }
}

function endSelecting() {
  const was = state.selecting;
  if (state.archive) closeArchive();
  state.selecting = false;
  state.selected = new Set();
  state.confirming = false;
  state.hiddenFound = null;
  if (!ui) return;
  ui.selectBtn.textContent = "Select";
  ui.selectBtn.classList.remove("ytcs-on");
  ui.grid.classList.remove("ytcs-selecting");
  ui.selbar.hidden = true;
  if (was) applyView();
}

function toggleSelected(id, card) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  if (card) card.classList.toggle("ytcs-picked", state.selected.has(id));
  state.confirming = false;
  renderSelbar();
}

function selectIds(ids) {
  state.selected = new Set(ids);
  state.confirming = false;
  renderSelbar();
  applyView();
}

function selBtn(label, cls, onClick, title) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = onClick;
  return b;
}

function selMsg(bar, text) {
  const msg = document.createElement("span");
  msg.className = "ytcs-selmsg";
  msg.textContent = text;
  bar.appendChild(msg);
  return msg;
}

function renderSelbar() {
  const bar = ui.selbar;
  bar.hidden = !state.selecting;
  if (!state.selecting) return;
  bar.textContent = "";
  const ed = editorHere();
  if (!ed) return;
  const arch = state.archive;
  const n = state.selected.size;
  const shown = state.lastRows || filterAndSort();
  const finished = arch ? [] : shown.filter((v) => watchState(v) === "done");
  const cancel = () => selBtn("Cancel", "ytcs-ghost", () => { state.confirming = false; state.hiddenFound = null; renderSelbar(); });
  const allow = cfg.allowEdits ? "" : " Allow it? You can undo straight after, and turn it off in the popup.";

  if (state.confirming === "remove" || state.confirming === "restore") {
    const putBack = state.confirming === "restore";
    selMsg(bar, cfg.allowEdits
      ? (putBack ? ed.back + ": " + plural(n, "video") + "?" : ed.ask(n) + " You can undo straight after.")
      : ed.consent + allow);
    const label = putBack ? ed.back + " (" + n + ")" : ed.go(n);
    bar.appendChild(selBtn(cfg.allowEdits ? label : "Allow and " + label.charAt(0).toLowerCase() + label.slice(1),
      putBack ? "ytcs-primarybtn" : "ytcs-danger", () => (putBack ? restoreSelected() : removeSelected())));
    bar.appendChild(cancel());
    return;
  }
  if (state.confirming === "find") {
    selMsg(bar, "To find them, Needle asks YouTube for your " + ed.noun + " with hidden videos shown, using your own sign-in, " +
      "the way YouTube's own \"Show unavailable videos\" does. Allow it? Nothing is removed until you say so.");
    bar.appendChild(selBtn("Allow and look", "ytcs-primarybtn", () => findHidden()));
    bar.appendChild(cancel());
    return;
  }
  if (state.confirming === "nohidden") {
    selMsg(bar, state.hiddenNote || "");
    bar.appendChild(selBtn("OK", "ytcs-ghost", () => { state.confirming = false; renderSelbar(); }));
    return;
  }
  if (state.confirming === "hidden" && state.hiddenFound) {
    const k = state.hiddenFound.length;
    selMsg(bar, plural(k, "deleted or private video") + (k === 1 ? " is" : " are") + " still in your " + ed.noun +
      ", hidden by YouTube but still counted. Remove " + (k === 1 ? "it" : "them") + "?");
    bar.appendChild(selBtn("Remove " + k, "ytcs-danger", () => removeSelected(state.hiddenFound)));
    bar.appendChild(cancel());
    return;
  }

  const count = document.createElement("span");
  count.className = "ytcs-selcount";
  count.textContent = n ? plural(n, "video") + " picked" : arch ? "Pick what should go back" : "Click videos to pick them";
  bar.appendChild(count);
  if (shown.length && n !== shown.length) {
    bar.appendChild(selBtn("Pick all " + shown.length + " shown", "ytcs-ghost", () => selectIds(shown.map((v) => v.id)),
      arch ? "Everything the filters left" : "Everything the filters left, so a filter decides what goes"));
  }
  if (finished.length) {
    bar.appendChild(selBtn("Pick the " + finished.length + " finished", "ytcs-ghost", () => selectIds(finished.map((v) => v.id))));
  }
  if (n) bar.appendChild(selBtn("Clear", "ytcs-ghost", () => selectIds([])));
  const spacer = document.createElement("span");
  spacer.className = "ytcs-spacer";
  bar.appendChild(spacer);

  if (arch) {
    bar.appendChild(selBtn("Back to " + ed.noun, "ytcs-ghost", () => closeArchive()));
    const go = selBtn(ed.back, "ytcs-primarybtn", () => { state.confirming = "restore"; renderSelbar(); });
    go.disabled = !n;
    bar.appendChild(go);
    return;
  }
  // Unlikes cannot be hidden: a deleted video drops out of Liked videos by itself.
  if (ed.key !== "LL") {
    bar.appendChild(selBtn("Find deleted videos", "ytcs-ghost", () => {
      if (cfg.allowEdits) findHidden();
      else { state.confirming = "find"; renderSelbar(); }
    }, "Deleted and private videos YouTube hides from this list but still counts"));
  }
  if (state.archiveCount) {
    bar.appendChild(selBtn("Removed earlier (" + state.archiveCount + ")", "ytcs-ghost", () => openArchive(),
      "Everything Needle removed from here in the last six months, to put back"));
  }
  const go = selBtn(ed.action, "ytcs-danger", () => { state.confirming = "remove"; renderSelbar(); });
  go.disabled = !n;
  bar.appendChild(go);
}

/*
 * Takes the picked videos out of the list (or the hidden dead ones, when
 * given). Stops at the first batch YouTube refuses and says how far it got.
 * Everything that went is archived, except dead videos, which could never be
 * put back anyway.
 */
async function removeSelected(given) {
  const ed = editorHere();
  if (!ed) return;
  const hidden = !!given;
  const videos = given || state.catalog.filter((v) => state.selected.has(v.id));
  if (!videos.length) return;
  grantEdits();
  const gen = state.navGen;
  // Where each one sat, so Undo can put the panel back exactly as it was.
  const at = new Map(state.catalog.map((v, i) => [v.id, i]));
  state.confirming = false;
  state.hiddenFound = null;
  ui.selbar.textContent = "";
  const msg = selMsg(ui.selbar, ed.verb + "… 0 of " + videos.length);

  let done = [];
  let error = null;
  try {
    done = await ed.remove(videos, (k) => { msg.textContent = ed.verb + "… " + k + " of " + videos.length; });
  } catch (e) {
    error = e;
    done = e.done || [];
  }
  const doneSet = new Set(done);
  const gone = videos.filter((v) => doneSet.has(v.id));
  if (gone.length) {
    if (ed.lib) await libraryRemove(ed.lib, done);
    const keep = gone.filter((v) => v.playable !== false);
    if (keep.length) await archiveAdd(ed.key, ed.noun, keep);
    countUse();
  }
  if (pageGone(gen)) return;
  state.catalog = state.catalog.filter((v) => !doneSet.has(v.id));
  facetFor = null;
  if (error) {
    if (!hidden) state.selected = new Set(videos.filter((v) => !doneSet.has(v.id)).map((v) => v.id));
    renderSelbar();
    setStatus([plural(state.catalog.length, "video"), error.message]);
    applyView();
    return;
  }
  if (hidden) {
    renderSelbar();
    toast(gone.length < videos.length
      ? "Removed " + gone.length + " of " + videos.length + ". YouTube offered no way to remove the rest"
      : "Removed " + plural(gone.length, "deleted or private video"));
    return;
  }
  endSelecting();
  setStatus([plural(state.catalog.length, "video")]);
  applyView();
  toast(ed.did(gone.length), "Undo", () => undoRemove(ed, gone, at, gen), 12000);
  // A clean-up that went through is a moment it helped, but the Undo comes
  // first: the ask waits until that toast has gone rather than sitting beside it.
  rateMoment(true, 12500);
}

async function undoRemove(ed, videos, at, gen) {
  let done = [];
  try {
    done = await ed.restore(videos);
  } catch (e) {
    done = e.done || [];
    toast(done.length ? "Put back " + done.length + " of " + videos.length + ". " + e.message : e.message);
  }
  const doneSet = new Set(done);
  const back = videos.filter((v) => doneSet.has(v.id));
  if (back.length) {
    if (ed.lib) await libraryRestore(ed.lib, back);
    await archiveDrop(ed.key, done);
  }
  if (pageGone(gen) || !back.length) return;
  // Into their old places, in order, so the list reads as it did before.
  const merged = state.catalog.slice();
  for (const v of back.slice().sort((a, b) => at.get(a.id) - at.get(b.id))) merged.splice(Math.min(at.get(v.id), merged.length), 0, v);
  state.catalog = merged;
  facetFor = null;
  setStatus([plural(state.catalog.length, "video")]);
  applyView();
  if (done.length === videos.length) toast(ed.backed(back.length));
}

// ---- the hidden dead videos -------------------------------------------------------
async function findHidden() {
  const ed = editorHere();
  const list = playlistId();
  if (!ed || !list) return;
  grantEdits();
  const gen = state.navGen;
  state.confirming = false;
  ui.selbar.textContent = "";
  const msg = selMsg(ui.selbar, "Looking for deleted and private videos…");
  let dead;
  try {
    dead = await fetchUnavailable(list, (k) => { msg.textContent = "Looking for deleted and private videos… checked " + k; });
  } catch (e) {
    if (pageGone(gen)) return;
    renderSelbar();
    toast(e.message);
    return;
  }
  if (pageGone(gen) || !state.selecting) return;
  // Watch Later removes by video id. Anywhere else, only what its own menu offers.
  const removable = ed.key === "WL" ? dead : dead.filter((v) => v.rm);
  // The answer stays in the bar until dismissed: a toast was easy to miss,
  // which made the whole look feel like a reload that did nothing.
  if (!removable.length) {
    state.hiddenNote = dead.length
      ? "Found " + plural(dead.length, "deleted or private video") + ", but YouTube offers no way to remove them here."
      : "No deleted or private videos in your " + ed.noun + ". Checked " + plural(dead.checked, "video") +
        (dead.complete ? "." : ", as far as Needle reads.");
    state.confirming = "nohidden";
    renderSelbar();
    return;
  }
  state.hiddenFound = removable;
  state.confirming = "hidden";
  renderSelbar();
}

// ---- the removal archive, in the panel ---------------------------------------------
/*
 * The same grid, showing what Needle removed from this list instead of the
 * list, newest first, with the same filters and the same select. Going back
 * re-reads the list if anything was put back, since only YouTube knows where
 * a re-added video landed.
 */
async function openArchive() {
  const ed = editorHere();
  if (!ed || state.archive) return;
  const gen = state.navGen;
  const list = await archiveFor(ed.key);
  if (pageGone(gen) || !state.selecting) return;
  state.archive = { editor: ed, prev: state.catalog, changed: false };
  state.catalog = list;
  state.selected = new Set();
  state.confirming = false;
  facetFor = null;
  ui.source.textContent = "Removed from " + (ed.key === "LL" ? "your Liked videos" : ed.key === "WL" ? "your Watch Later" : ed.noun);
  setStatus([plural(list.length, "video"), "Newest first", "Kept six months"]);
  renderSelbar();
  applyView();
}

function closeArchive() {
  const a = state.archive;
  if (!a) return;
  state.archive = null;
  state.catalog = a.prev;
  state.selected = new Set();
  state.confirming = false;
  facetFor = null;
  if (!ui) return;
  ui.source.textContent = sourceName();
  setStatus([plural(state.catalog.length, "video")]);
  if (a.changed) {
    refreshCatalog();
  } else {
    renderSelbar();
    applyView();
  }
}

async function restoreSelected() {
  const a = state.archive;
  if (!a) return;
  const ed = a.editor;
  const videos = state.catalog.filter((v) => state.selected.has(v.id));
  if (!videos.length) return;
  grantEdits();
  const gen = state.navGen;
  state.confirming = false;
  ui.selbar.textContent = "";
  const msg = selMsg(ui.selbar, "Putting back… 0 of " + videos.length);
  let done = [];
  let error = null;
  try {
    done = await ed.restore(videos, (k) => { msg.textContent = "Putting back… " + k + " of " + videos.length; });
  } catch (e) {
    error = e;
    done = e.done || [];
  }
  const doneSet = new Set(done);
  const back = videos.filter((v) => doneSet.has(v.id));
  if (back.length) {
    await archiveDrop(ed.key, done);
    if (ed.lib) await libraryRestore(ed.lib, back);
    a.changed = true;
  }
  if (pageGone(gen) || state.archive !== a) return;
  state.catalog = state.catalog.filter((v) => !doneSet.has(v.id));
  state.selected = new Set(videos.filter((v) => !doneSet.has(v.id)).map((v) => v.id));
  facetFor = null;
  state.archiveCount = state.catalog.length;
  renderSelbar();
  applyView();
  toast(error ? (back.length ? "Put back " + back.length + " of " + videos.length + ". " : "") + error.message : ed.backed(back.length));
}

// ---- when a read fails -----------------------------------------------------------------
/*
 * A read that throws, or that finds nothing on a page plainly showing videos,
 * almost always means YouTube changed how it sends this list. Saying so, with a
 * report to copy, is the difference between a bug report and an uninstall.
 *
 * And the videos YouTube already drew are still on the page, in the grid the
 * panel hid. Reading those gives the panel something true to filter while the
 * fix ships: fewer videos, but the right ones, instead of an empty box.
 */
const SCREEN_CARDS = "ytd-rich-item-renderer, ytd-playlist-video-renderer, ytd-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model";
/*
 * "Report it" opens a Google Form with the report already filled in, and the
 * person presses Submit on Google's own page. No account needed, unlike the
 * GitHub issue this used to open, which most people watching YouTube don't
 * have. And the extension itself still sends nothing: the privacy policy's
 * "does not transmit" stays true, because the submit is theirs, on a page that
 * shows them exactly what goes.
 */
const REPORT_FORM = "https://docs.google.com/forms/d/e/FORM_ID/viewform";
const REPORT_ENTRY = "entry.0";

// Every piece of text in a card, one per element that holds text directly.
// textContent, not innerText: the grid is hidden, so nothing in it has layout.
function leafTexts(el) {
  const out = [];
  for (const n of el.querySelectorAll("*")) {
    if (n.children.length) continue;
    const t = (n.textContent || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

function readScreenCards() {
  const roots = state.hiddenGrids.map((h) => h.el).filter((el) => el.isConnected);
  if (!roots.length) {
    const g = findNativeGrid();
    if (g) roots.push(g);
  }
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    for (const card of root.querySelectorAll(SCREEN_CARDS)) {
      // A rich item wraps a lockup: read the outer one only.
      if (card.parentElement && card.parentElement.closest(SCREEN_CARDS)) continue;
      const a = card.querySelector("a[href*='/watch?v=']");
      const m = a && (a.getAttribute("href") || "").match(/[?&]v=([\w-]{6,20})/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const texts = leafTexts(card);
      const durationText = texts.find((t) => /^\d{1,2}(:\d{2})+$/.test(t)) || "";
      const viewsText = texts.find((t) => /\bviews?$/i.test(t) || /^no views$/i.test(t)) || "";
      const publishedText = texts.find((t) => /\bago$|^streamed|^premiered/i.test(t)) || "";
      // The heading when there is one; failing that, the longest text on the
      // card that is not its length, its views or its date.
      const titleEl = card.querySelector("#video-title, h3 a, h3");
      const stats = new Set([durationText, viewsText, publishedText]);
      const longest = texts.filter((t) => !stats.has(t)).sort((p, q) => q.length - p.length)[0] || "";
      const title = ((titleEl && (titleEl.getAttribute("title") || titleEl.textContent)) || longest).replace(/\s+/g, " ").trim();
      const ch = card.querySelector("a[href^='/@'], a[href^='/channel/']");
      const hm = ch && (ch.getAttribute("href") || "").match(/^\/@([^/?]+)/);
      out.push({
        id: m[1],
        title: title || "(no title)",
        channel: ch ? cleanChannel(ch.textContent.replace(/\s+/g, " ").trim()) : "",
        handle: hm ? hm[1].toLowerCase() : "",
        durationText,
        seconds: parseDuration(durationText),
        // Unknown, not zero, when the card did not say.
        views: viewsText ? parseViews(viewsText) : null,
        publishedText,
        days: parseRelativeDays(publishedText),
        progress: typeof barPercent === "function" ? barPercent(card) : null,
      });
    }
  }
  return out;
}

function pageKind() {
  if (isHistoryPage()) return "watch history";
  if (ownListScope() === "wl") return "Watch Later";
  if (ownListScope() === "liked") return "Liked videos";
  if (playlistId()) return "a playlist";
  if (isSubscriptionsPage()) return "subscriptions";
  if (isSearchPage()) return state.omniScope ? "search bar library" : "search results";
  return "a channel's videos";
}

/*
 * The report. Names and counts only: which page kind, which part of YouTube's
 * reply the read reached, what that reply was built from. No title, video,
 * channel, address or search words, so it can be pasted anywhere.
 */
function diagnostics(err, onScreen) {
  const ua = navigator.userAgent.match(/Chrome\/(\d+)/);
  let version = "?";
  try { version = chrome.runtime.getManifest().version; } catch (e) { /* reloaded extension */ }
  return [
    "Needle " + version + ", read failure",
    "When: " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    "Browser: " + (ua ? "Chrome " + ua[1] : "not Chrome") + ", language " + (navigator.language || "?"),
    "Page: " + pageKind(),
    "Read: " + (readTrace.kind || "?") + ", reached " + (readTrace.step || "?"),
    "Problem: " + (err ? err.name + ": " + err.message : "the read came back empty"),
    "On screen: " + plural(onScreen, "video"),
    "Settings: deep reading " + (cfg.deepHistory ? "on" : "off") + ", video limit " + cfg.maxVideos,
    "Reply shape: " + (readTrace.shape || "not reached"),
  ].join("\n");
}

function showReadFailure(err) {
  const screen = readScreenCards();
  state.failure = { report: diagnostics(err, screen.length), onScreen: screen.length };
  state.catalog = screen;
  state.newIds = new Set();
  facetFor = null;
  recomputeMedians();
  setStatus([screen.length ? plural(screen.length, "video") + " from the page" : "Could not read this page"]);
  // Not the moment to ask for a review.
  ui.rate.hidden = true;
  setView("search");
  applyView();
}

// Drawn by renderGrid above the cards while a failure stands.
function renderFailure(container) {
  const f = state.failure;
  if (!f) return;
  const box = document.createElement("div");
  box.className = "ytcs-failnote";
  const head = document.createElement("strong");
  head.textContent = "Needle couldn't read this page.";
  const text = document.createElement("span");
  text.textContent = " YouTube may have changed how it sends it. " + (f.onScreen
    ? "These are the " + plural(f.onScreen, "video") + " already on the page, so the filters still work on them."
    : "Reloading the page sometimes helps.") + " A report helps get it fixed fast.";
  const copy = selBtn("Copy report", "ytcs-primarybtn", () => copyText(f.report, () => toast("Report copied. Nothing personal in it: no titles, videos or addresses")),
    "A few lines about what broke, with nothing about you or what you watch");
  const open = selBtn("Report it", "ytcs-ghost", () => {
    window.open(REPORT_FORM + "?usp=pp_url&" + REPORT_ENTRY + "=" + encodeURIComponent(f.report), "_blank", "noopener");
  }, "Opens a short form with the report filled in. Nothing about you, and nothing goes until you press Submit");
  const msg = document.createElement("div");
  msg.className = "ytcs-failtext";
  msg.appendChild(head);
  msg.appendChild(text);
  const acts = document.createElement("div");
  acts.className = "ytcs-failacts";
  acts.appendChild(copy);
  acts.appendChild(open);
  box.appendChild(msg);
  box.appendChild(acts);
  container.insertBefore(box, container.firstChild);
}

// ---- doing something with the result ------------------------------------------------
/*
 * Play, copy, share, download: the things people do once a list is narrowed.
 * They act on the picked videos when there are any, otherwise on everything the
 * filters left, never on the first 600 the grid happens to draw.
 */
function targetRows() {
  if (state.selecting && state.selected.size) return state.catalog.filter((v) => state.selected.has(v.id));
  return state.lastRows || filterAndSort();
}

function copyText(text, done) {
  const fallback = () => {
    const t = document.createElement("textarea");
    t.value = text;
    t.setAttribute("readonly", "");
    t.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { /* reported below */ }
    t.remove();
    if (ok) done();
    else toast("Your browser would not let Needle copy. Try again");
  };
  try {
    navigator.clipboard.writeText(text).then(done, fallback);
  } catch (e) {
    fallback();
  }
}

const watchUrl = (id) => "https://www.youtube.com/watch?v=" + id;

function copyRows(kind) {
  const rows = targetRows().filter((v) => v.playable !== false);
  if (!rows.length) {
    toast("Nothing to copy. Loosen the filters first");
    return;
  }
  const bits = (v) => [v.channel, fmtDuration(v.seconds)].filter(Boolean).join(", ");
  let text;
  if (kind === "links") {
    text = rows.map((v) => watchUrl(v.id)).join("\n");
  } else if (kind === "md") {
    text = rows.map((v) => "- [" + v.title.replace(/([\[\]])/g, "\\$1") + "](" + watchUrl(v.id) + ")" + (bits(v) ? " (" + bits(v) + ")" : "")).join("\n");
  } else {
    text = rows.map((v) => v.title + (bits(v) ? " (" + bits(v) + ")" : "") + "\n" + watchUrl(v.id)).join("\n\n");
  }
  copyText(text, () => toast("Copied " + plural(rows.length, kind === "links" ? "link" : "video") + (kind === "links" ? ", one per line" : "")));
  countUse();
}

/*
 * YouTube's own watch_videos address takes up to 50 ids and turns them into a
 * temporary playlist, played in order (checked September 2026). So Play hands
 * over the list as it stands, filters and sort included.
 */
const PLAY_MAX = 50;

function playRows() {
  const rows = targetRows().filter((v) => v.playable !== false);
  if (!rows.length) {
    toast("Nothing to play. Loosen the filters first");
    return;
  }
  countUse();
  location.href = "https://www.youtube.com/watch_videos?video_ids=" + rows.slice(0, PLAY_MAX).map((v) => v.id).join(",");
}

// ---- sharing a filter -------------------------------------------------------------------
/*
 * A link to a page on Needle's site that carries the list and the filters after
 * its "#". That page explains what it is, offers Needle to anyone without it,
 * and opens YouTube with the filters riding along after a "#needle=", which
 * arrive.js catches before YouTube tidies the address. The part after a "#" is
 * never sent to any server, Needle's or YouTube's.
 *
 * Your own lists share as filters, not contents: a link made on your Watch
 * Later opens the other person's own Watch Later, filtered the same way.
 */
const SHARE_BASE = "https://gottostartsomewhere.github.io/needle/f/";
const SHARE_KEY = "ytcsShare";
const SHARE_TTL = 60 * 1000;

function shareKind() {
  if (isHistoryPage()) return "history";
  if (isSubscriptionsPage()) return "subs";
  if (ownListScope() === "wl") return "wl";
  if (ownListScope() === "liked") return "liked";
  if (playlistId()) return "list";
  if (isSearchPage()) return state.omniScope ? "" : "search";
  return channelBasePath() ? "channel" : "";
}

function shareSource() {
  const kind = shareKind();
  if (kind === "history") return "/feed/history";
  if (kind === "subs") return "/feed/subscriptions";
  if (kind === "wl" || kind === "liked" || kind === "list") return "/playlist?list=" + playlistId();
  if (kind === "search") {
    const sp = new URLSearchParams(location.search).get("sp");
    return "/results?search_query=" + encodeURIComponent(searchQuery()).replace(/%20/g, "+") + (sp ? "&sp=" + encodeURIComponent(sp) : "");
  }
  if (kind === "channel") return channelBasePath() + "/videos";
  return "";
}

function shareLink() {
  const p = shareSource();
  if (!p) return "";
  const kind = shareKind();
  const q = [panelQueryString(false), ui.kw.value.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({ k: kind, p, q });
  const name = kind === "channel" ? sourceName() : kind === "list" ? state.listTitle : "";
  if (name) params.set("n", name.slice(0, 80));
  return SHARE_BASE + "#" + params.toString();
}

function copyShareLink() {
  const link = shareLink();
  if (!link) {
    toast("This list cannot be shared as a link");
    return;
  }
  const kind = shareKind();
  const whose = { wl: "their own Watch Later", liked: "their own Liked videos", history: "their own history", subs: "their own subscriptions" }[kind];
  copyText(link, () => toast(whose ? "Link copied. It opens " + whose + " with these filters" : "Link copied. It opens this list with these filters"));
  countUse();
}

// A shared link's filters, caught at page start by arrive.js. Used once.
function takeShared() {
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem(SHARE_KEY) || "null"); } catch (e) { return null; }
  if (!p || typeof p.q !== "string" || Date.now() - p.at > SHARE_TTL) return null;
  if ((p.path || "").replace(/\/$/, "") !== location.pathname.replace(/\/$/, "")) return null;
  if ((p.list || "") !== (playlistId() || "")) return null;
  try { sessionStorage.removeItem(SHARE_KEY); } catch (e) { /* ignore */ }
  // YouTube sometimes leaves "#needle=" in the address; take it out, so a
  // reload does not apply the shared filters all over again. Its own history
  // state is kept as it is.
  if (/^#needle=/.test(location.hash)) {
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) { /* harmless */ }
  }
  return p.q;
}

function shareArrive() {
  if (state.active || state.enabling || !canRunHere()) return;
  /*
   * The filters are applied by omnibar.js, which loads after this file. The
   * first call comes from bootstrap, while this file is still running, and on a
   * fast page the panel used to mount before omnibar.js existed: enableNow
   * found no applyOmniFilters, skipped the filters, and the link opened the
   * whole list unfiltered (two runs in five on a live channel, October 2026).
   * Leaving the link untaken until then costs nothing: ensureUi calls again
   * once settings load and every 1.5s after, well inside SHARE_TTL.
   */
  if (typeof applyOmniFilters !== "function") return;
  const q = takeShared();
  if (q === null) return;
  const f = parseOmniQuery(q);
  f.keepWords = true;
  state.pendingOmni = f;
  enable();
}

// ---- the keyboard --------------------------------------------------------------------------
/*
 * While the panel is open: / to search, j and k (or the arrows, once a card has
 * focus) to move, Enter to open, x to pick in select mode, s for select mode,
 * Esc to finish. Typing into any box is never intercepted, and nothing happens
 * unless the keypress lands on the panel or on the page itself, so YouTube's
 * player and its own boxes keep their keys.
 */
const KEYS_HELP = "Keys: / to search, j and k to move, Enter to open, x to pick, s to select, Esc to finish";

function cardsInGrid() {
  return ui ? Array.from(ui.grid.querySelectorAll("a.ytcs-card")) : [];
}

function focusCard(cards, i) {
  const c = cards[Math.max(0, Math.min(cards.length - 1, i))];
  if (!c) return;
  c.focus();
  c.scrollIntoView({ block: "nearest" });
}

// The card in the next or previous row closest to this one's column.
function cardInRow(cards, from, dir) {
  const r = cards[from].getBoundingClientRect();
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < cards.length; i++) {
    const q = cards[i].getBoundingClientRect();
    const dy = (q.top - r.top) * dir;
    if (dy < 4) continue;
    const score = dy * 4 + Math.abs(q.left - r.left);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best === -1 ? from : best;
}

document.addEventListener("keydown", (e) => {
  if (!state.active || !ui || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (typing) {
    if (e.key === "Escape" && t === ui.kw) { ui.kw.blur(); e.preventDefault(); }
    return;
  }
  const inPanel = ui.wrap.contains(t) || t === document.body || t === document.documentElement;
  if (!inPanel) return;
  // Moving straight from the search box to the cards: draw what was typed first.
  flushTyping();
  const cards = cardsInGrid();
  const at = cards.indexOf(document.activeElement);
  let handled = true;
  switch (e.key) {
    case "/": ui.kw.focus(); break;
    case "j": focusCard(cards, at + 1); break;
    case "k": focusCard(cards, at < 0 ? 0 : at - 1); break;
    case "ArrowRight": if (at < 0) handled = false; else focusCard(cards, at + 1); break;
    case "ArrowLeft": if (at < 0) handled = false; else focusCard(cards, at - 1); break;
    case "ArrowDown": if (at < 0) handled = false; else focusCard(cards, cardInRow(cards, at, 1)); break;
    case "ArrowUp": if (at < 0) handled = false; else focusCard(cards, cardInRow(cards, at, -1)); break;
    case "x":
    case " ":
      if (state.selecting && at >= 0) toggleSelected(cards[at].dataset.id, cards[at]);
      else handled = false;
      break;
    case "s":
      if (canEditHere()) (state.selecting ? endSelecting() : startSelecting());
      else handled = false;
      break;
    case "Escape":
      if (openMenu) closeMenu(true);
      else if (state.confirming) { state.confirming = false; state.hiddenFound = null; renderSelbar(); }
      else if (state.selecting) endSelecting();
      else if (at >= 0) cards[at].blur();
      else handled = false;
      break;
    case "?": toast(KEYS_HELP, null, null, 9000); break;
    default: handled = false;
  }
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// ---- grid takeover lifecycle ---------------------------------------------
/*
 * The visible grid, not the first one in the document.
 *
 * A channel keeps a separate ytd-rich-grid-renderer for every tab that has been
 * opened in this navigation, and leaves the inactive ones in the DOM display:none
 * rather than removing them. So after any in-page navigation, Home to Videos or
 * one channel to the next, querySelector's first match is frequently a grid
 * nobody is looking at. The panel then mounts inside a hidden container and
 * hides a grid that was already hidden, so the page appears untouched and the
 * launcher looks broken until a reload rebuilds the DOM with only one grid.
 *
 * offsetParent is null for anything in a display:none subtree, which is exactly
 * how the inactive tabs are kept, so it separates them without measuring
 * anything or hard-coding YouTube's tab markup.
 */
// Everywhere the panel is allowed to open. Both surfaces are lists of videos,
// which is the only thing the filter engine actually cares about.
function canRunHere() {
  return isChannelPage() || isHistoryPage() || isSearchPage() || !!playlistId() || isSubscriptionsPage();
}

// Cache key for whatever this page is a list of. History gets a fixed key since
// there is only ever one of it, unlike channels which are keyed by path. Search
// results get none: they are a fresh answer to one query and a cached copy of
// yesterday's would be quietly wrong, so loadCatalog always refetches them.
function sourceKey() {
  // Playlists (Watch Later and Liked above all) change every time you save
  // something, and your subscriptions every hour, so they are read fresh too.
  if (isSearchPage() || playlistId() || isSubscriptionsPage()) return null;
  return isHistoryPage() ? "__history" : channelBasePath();
}

// Watch Later, and your own lists once their videos show they are yours.
function canEditHere() {
  return !!editorHere();
}

// History's watch dates, whether on its own page or reached with in:history.
function listHasWatchDates() {
  return isHistoryPage() || state.omniScope === "hist";
}

// Keeps the current selection if the new set still offers it, so relabelling
// does not silently reset somebody's filter.
function setOptions(sel, opts) {
  const keep = sel.value;
  sel.textContent = "";
  for (const [val, label] of opts) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    sel.appendChild(o);
  }
  if (opts.some((o) => o[0] === keep)) sel.value = keep;
  if (!sel.classList.contains("ytcs-sort")) sel.classList.toggle("ytcs-dim", !sel.value);
}

/*
 * Two controls mean different things depending on what the panel is looking at,
 * so their labels are set when it opens rather than when it is built.
 *
 * ui is constructed once and survives navigation between a channel and history,
 * so doing this in buildUi would leave whichever page happened to be first
 * labelling the other. The date pill becomes "Watched this week" rather than
 * "Past week", and the sort pill gains the two watch-date orders, which exist
 * nowhere else because no other source carries a watch date.
 */
function labelForSource() {
  const hist = listHasWatchDates();
  const search = isSearchPage();
  const own = ownListScope();
  const list = playlistId();
  const subs = isSubscriptionsPage();
  const scope = (search && state.omniScope) || own;

  /*
   * Insights only on a channel. Every chart in it describes one creator's
   * catalogue; over history, search results or your lists it would be drawing
   * conclusions about dozens of unrelated channels at once.
   */
  const onChannel = isChannelPage();
  ui.tabSearch.parentElement.style.display = onChannel ? "" : "none";
  if (!onChannel && state.view !== "search") setView("search");

  // The typed filters, named where people type, since the box accepts them.
  ui.kw.placeholder = hist ? "Search your history, or type <12m, @channel"
    : scope === "channels" ? "Search channels you watch, or type <12m, @channel"
    : scope ? "Search your " + LIB_NAMES[scope] + ", or type <12m, @channel"
    : list ? "Search this playlist, or type <12m, @channel"
    : subs ? "Search your subscriptions, or type <12m, unwatched"
    : search ? "Narrow these results, or type <12m, >100k"
    : "Search this channel, or type <12m, >100k";
  ui.kw.setAttribute("aria-label", ui.kw.placeholder);
  ui.source.textContent = sourceName();

  setOptions(ui.uploaded, hist ? WATCH_DATE_OPTS : DATE_OPTS);
  ui.uploaded.title = hist ? "When you watched it" : "Upload date";
  ui.watched.title = hist ? "How far you got through these"
    : search || list || subs ? "What you have already watched" : "Your watch history on this channel";

  // Select only where the panel can change the list. Your own playlists show
  // it once read, since only their videos say whose they are.
  syncEditButton();

  /*
   * Results arrive in YouTube's relevance order and a list arrives in its own,
   * and in both cases that order is the thing worth keeping as the default.
   * "Newest first" is what the engine calls "leave it as it came", which is
   * true on a channel and false here, so it is renamed rather than lying.
   * Oldest and Start here both assume an upload order that is not there.
   * Your subscriptions arrive newest first already, which is their feed order.
   */
  if ((search || list || subs) && !hist) {
    const rest = SORTS.filter(([v]) => v !== "newest" && v !== "oldest" && v !== "starthere");
    const asCame = scope || list ? "List order" : subs ? "Feed order" : "Relevance";
    /*
     * A list page can also be read back to front, which "oldest" already does.
     * Sorting it the way YouTube's own Sort does is not possible without
     * changing it: on your own lists that Sort saves a new order to the list
     * (ACTION_SET_PLAYLIST_VIDEO_ORDER), so the panel reverses what it read.
     */
    const order = [["newest", asCame]];
    if (list) order.push(["oldest", "List order, reversed"]);
    setOptions(ui.sort, order.concat([["upload_new", "Newest upload"], ["upload_old", "Oldest upload"]], rest));
    ui.sort.value = "newest";
    ui.sort.dataset.def = "newest";
    return;
  }
  setOptions(ui.sort, hist ? WATCH_SORTS.concat(SORTS) : SORTS);
  // History's own page is newest-watched-first, so opening on anything else
  // would reorder a list somebody already has a mental model of.
  ui.sort.value = hist ? "watched_desc" : cfg.defaultSort;
  // A saved default that is no longer offered (Views per day was removed)
  // leaves the menu blank rather than falling back, so fall back here.
  if (!ui.sort.value) ui.sort.value = "newest";
  // What Clear goes back to, and what does not count as a change.
  ui.sort.dataset.def = ui.sort.value;
}

// ---- tokens ------------------------------------------------------------------
// Where each filter currently lives, and the filters that exist only as typed
// operators (@channel, -word, after:), which have no select to live in.
function layoutTokens() {
  if (!ui || !ui.slots) return;
  const spacer = ui.addrow.querySelector(".ytcs-spacer");
  for (const s of ui.slots) {
    const on = !!s.sel.value;
    s.label.textContent = on ? s.sel.selectedOptions[0].textContent : s.name;
    s.slot.classList.toggle("ytcs-token", on);
    // What "Custom…" puts back if the editor is opened and then cancelled.
    s.sel.dataset.prev = s.sel.value;
  }
  // Re-seat only what moved, so an open native menu is never yanked from under
  // the pointer. Order is fixed: Length, Views, Date, Watched, Free time, then
  // the channel picker, which never becomes a token itself.
  const want = ui.slots.filter((s) => s.sel.value).map((s) => s.slot);
  const have = Array.from(ui.tokens.querySelectorAll(":scope > .ytcs-f:not(.ytcs-xtoken)"));
  const anchor = ui.chanSlot ? ui.chanSlot.slot : spacer;
  if (want.length !== have.length || want.some((el, i) => el !== have[i])) {
    for (const el of want) ui.tokens.appendChild(el);
    for (const s of ui.slots) if (!s.sel.value) ui.addrow.insertBefore(s.slot, anchor);
  }
  ui.sortSlot.label.textContent = ui.sort.selectedOptions[0] ? ui.sort.selectedOptions[0].textContent : "";

  ui.tokens.querySelectorAll(".ytcs-xtoken").forEach((n) => n.remove());
  for (const [text, drop] of extraTokens()) {
    const t = document.createElement("span");
    t.className = "ytcs-f ytcs-token ytcs-xtoken";
    const l = document.createElement("span");
    l.className = "ytcs-flabel";
    l.textContent = text;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ytcs-fx";
    b.setAttribute("aria-label", "Remove " + text);
    b.textContent = "×";
    b.onclick = () => { drop(); applyView(); };
    t.appendChild(l);
    t.appendChild(b);
    ui.tokens.appendChild(t);
  }
  // The dimensions are all in use; the add row has nothing left to offer.
  ui.addrow.classList.toggle("ytcs-allset", ui.slots.every((s) => s.sel.value));
  updateFollowButton();
}

/*
 * The filters that exist only as typed operators or custom ranges, in the
 * order they show, each with what removing it does. The token row, Backspace
 * and "is anything set" all read this one list, so a new operator is added in
 * exactly one place.
 */
function extraTokens() {
  const x = state.extra;
  const out = [];
  if (x.channel) out.push(["@" + x.channel, () => { x.channel = ""; }]);
  for (const c of x.notChannels) out.push(["Not @" + c, () => { x.notChannels = x.notChannels.filter((e) => e !== c); }]);
  for (const w of x.excludes) out.push(["Without " + w, () => { x.excludes = x.excludes.filter((e) => e !== w); }]);
  if (x.minAge || x.maxAge !== Infinity) out.push([ageLabel(x.minAge, x.maxAge), () => { x.minAge = 0; x.maxAge = Infinity; }]);
  if (x.watchedMin || x.watchedMax !== Infinity) {
    out.push([x.watchedText || "Watched in range", () => { x.watchedMin = 0; x.watchedMax = Infinity; x.watchedText = ""; }]);
  }
  if (x.lang && typeof LANGS !== "undefined") out.push([(LANGS[x.lang] ? LANGS[x.lang].name : x.lang) + " only", () => { x.lang = ""; }]);
  if (x.fresh) out.push(["Fresh to you", () => { x.fresh = false; }]);
  return out;
}

// "After 2023", "Before 2020", "2020 to 2023", from ages in days.
function ageLabel(minAge, maxAge) {
  const yearOf = (days) => new Date(Date.now() - days * 86400000).getFullYear();
  if (minAge && maxAge !== Infinity) return yearOf(maxAge) + " to " + yearOf(minAge);
  if (maxAge !== Infinity) return "After " + yearOf(maxAge);
  return "Before " + yearOf(minAge);
}

/*
 * Operators typed into the panel's own box, absorbed into tokens as soon as each
 * one is complete (a space after it) or on Enter. The word still being typed is
 * left alone, so "<2" is not read as "under 2 minutes" on the way to "<20m".
 */
function absorbOperators(final) {
  if (typeof parseOmniQuery !== "function" || typeof setOmniDims !== "function") return;
  const raw = ui.kw.value;
  const done = final ? raw : raw.replace(/\S+$/, "");
  const rest = raw.slice(done.length);
  const f = parseOmniQuery(done);
  if (!f.ops) return;
  const needsServer = setOmniDims(f);
  ui.kw.value = final ? f.clean : (f.clean ? f.clean + " " : "") + rest;
  applyView();
  if (!needsServer) return;
  /*
   * is:4k, is:live and the rest are YouTube's to apply, across its whole index,
   * so the search goes back to YouTube with them attached. The panel's own
   * filters ride along through the same hand-off the search bar uses.
   */
  if (!isSearchPage()) {
    toast("4K, Live and the other YouTube filters only work on search results");
    return;
  }
  const dec = pageSp();
  for (const n of f.features) dec.filters[n] = 1;
  if (f.type) dec.filters[YT_F.type] = f.type;
  const keep = parseOmniQuery(panelQueryString());
  try {
    sessionStorage.setItem(OMNI_PENDING, JSON.stringify({ q: searchQuery(), f: packFilters(keep), at: Date.now() }));
  } catch (e) { /* the search still happens */ }
  navigateTo(searchUrl(searchQuery(), encodeSp(dec.sort, dec.filters)));
}

// Backspace in an empty box: the last token out, typed ones before menu ones.
function popLastToken() {
  const extra = extraTokens();
  if (extra.length) {
    extra[extra.length - 1][1]();
  } else {
    const last = ui.slots.filter((s) => s.sel.value).pop();
    if (!last) return;
    last.sel.value = "";
    last.sel.classList.add("ytcs-dim");
  }
  applyView();
}

// ---- custom ranges ---------------------------------------------------------------
/*
 * "Custom…" in the Length, Views and Date menus opens this: two boxes and the
 * unit, under the row it came from. The boxes take what people actually type,
 * "12", "1h", "90s" for length and "250k", "1.5m" for views, so nobody has to
 * learn the operator syntax to get an exact range. Either box can stay empty.
 */
function parseLengthInput(s) {
  const m = String(s).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs)?$/);
  if (!m) return null;
  const u = m[2] || "m";
  return Math.round(parseFloat(m[1]) * (u[0] === "s" ? 1 : u[0] === "h" ? 3600 : 60));
}
function parseCountInput(s) {
  const m = String(s).trim().toLowerCase().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*(k|m|b)?$/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1));
}
// "2023", "2023-06", "2023-06-15". The end of a range is the end of what was
// typed: "to 2023" means through 31 December, not up to 1 January.
function parseDateInput(s, end) {
  const m = String(s).trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = +m[1], mo = m[2] ? +m[2] - 1 : 0, d = m[3] ? +m[3] : 1;
  if (!end) return new Date(y, mo, d);
  if (m[3]) return new Date(y, mo, d + 1);
  if (m[2]) return new Date(y, mo + 1, 1);
  return new Date(y + 1, 0, 1);
}
const daysAgo = (date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));

function openCustom(name) {
  const row = ui.customRow;
  const kind = name === "Length" ? "length" : name === "Views" ? "views"
    : listHasWatchDates() ? "watched" : "date";
  const spec = {
    length: ["Length from", "to", "min", "5", "20"],
    views: ["Views from", "to", "", "10k", "1m"],
    date: ["Uploaded from", "to", "", "2020", "2024"],
    watched: ["Watched from", "to", "", "2026-08", "2026-09"],
  }[kind];
  row.textContent = "";
  const lead = document.createElement("span");
  lead.className = "ytcs-customlead";
  lead.textContent = spec[0];
  const a = document.createElement("input");
  const b = document.createElement("input");
  for (const [inp, ph] of [[a, spec[3]], [b, spec[4]]]) {
    inp.type = "text";
    inp.className = "ytcs-customin";
    inp.placeholder = ph;
    inp.setAttribute("aria-label", spec[0] + (inp === a ? " (from)" : " (to)"));
  }
  const mid = document.createElement("span");
  mid.textContent = spec[1];
  const unit = document.createElement("span");
  unit.className = "ytcs-customunit";
  unit.textContent = spec[2];
  const err = document.createElement("span");
  err.className = "ytcs-customerr";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "ytcs-customgo";
  apply.textContent = "Apply";
  const cancel = ghostBtn("Cancel");
  const close = () => { row.hidden = true; row.textContent = ""; };

  apply.onclick = () => {
    const va = a.value.trim(), vb = b.value.trim();
    err.textContent = "";
    if (!va && !vb) { close(); return; }
    const x = state.extra;
    if (kind === "length" || kind === "views") {
      const parse = kind === "length" ? parseLengthInput : parseCountInput;
      const lo = va ? parse(va) : 0, hi = vb ? parse(vb) : Infinity;
      if (lo == null || hi == null) { err.textContent = kind === "length" ? "Try 12, 90s or 1h" : "Try 5000, 250k or 1.5m"; return; }
      if (hi < lo) { err.textContent = "The second number should be the bigger one"; return; }
      const sel = kind === "length" ? ui.duration : ui.views;
      const label = kind === "length" ? omniRangeLabel(lo, hi, fmtLen, "") : omniRangeLabel(lo, hi, fmtCompact, " views");
      omniSetCustom(sel, lo + "-" + (hi === Infinity ? "" : hi), label);
    } else {
      const from = va ? parseDateInput(va, false) : null, to = vb ? parseDateInput(vb, true) : null;
      if ((va && !from) || (vb && !to)) { err.textContent = "Try 2023, 2023-06 or 2023-06-15"; return; }
      if (from && to && to <= from) { err.textContent = "The second date should be the later one"; return; }
      // Ages count backwards: "from" sets the oldest allowed, "to" the newest.
      const maxAge = from ? daysAgo(from) : Infinity;
      const minAge = to ? daysAgo(to) : 0;
      if (kind === "date") {
        x.minAge = minAge;
        x.maxAge = maxAge;
      } else {
        x.watchedMin = minAge;
        x.watchedMax = maxAge;
        x.watchedText = "Watched " + (va && vb ? va + " to " + vb : va ? "since " + va : "before " + vb);
      }
      ui.uploaded.value = "";
      ui.uploaded.classList.add("ytcs-dim");
    }
    close();
    applyView();
  };
  cancel.onclick = close;
  for (const inp of [a, b]) {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") apply.onclick();
      if (e.key === "Escape") close();
    });
    inp.addEventListener("input", () => { err.textContent = ""; });
  }
  row.append(lead, a, mid, b, unit, apply, cancel, err);
  row.hidden = false;
  a.focus();
}


// ---- following, from the panel -------------------------------------------------------------
/*
 * The panel's current state written back out as a query, "rust async <30m
 * is:unwatched", which is what a followed search stores. It reads back as what
 * was asked for, syncs in a few bytes, and re-runs through the same grammar as
 * anything typed into the bar. YouTube's own filters on the page are written
 * out too, as the operators that would have set them.
 */
// The panel's filters as typed text. A share link leaves the search's own words
// out, since its address already carries them.
function panelQueryString(withQuery) {
  const toks = withQuery === false ? [] : [searchQuery().trim()];
  const len = (s) => (s % 60 ? s + "s" : s / 60 + "m");
  const [minD, maxD] = rangeVal(ui.duration);
  if (minD) toks.push(">" + len(minD));
  if (maxD !== Infinity) toks.push("<" + len(maxD));
  // "m" alone means minutes, so millions always carry "views".
  const cnt = (n) => (n >= 1e6 && n % 1e5 === 0 ? n / 1e6 + "m views" : n >= 1e3 && n % 100 === 0 ? n / 1e3 + "k" : n + " views");
  const [minV, maxV] = rangeVal(ui.views);
  if (minV) toks.push(">" + cnt(minV));
  if (maxV !== Infinity) toks.push("<" + cnt(maxV));
  const w = { new: "is:unwatched", partial: "is:started", done: "is:watched" }[ui.watched.value];
  if (w) toks.push(w);
  const iso = (days) => {
    const d = new Date(Date.now() - days * 86400000);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const up = ui.uploaded.value;
  const upTok = { 7: "date:week", 31: "date:month", 366: "date:year" }[up];
  if (upTok) toks.push(upTok);
  if (up === "93") toks.push("after:" + iso(93));
  if (up === "old") toks.push("before:" + iso(366));
  const x = state.extra;
  if (x.channel) toks.push("@" + x.channel);
  for (const c of x.notChannels) toks.push("-@" + c);
  for (const e of x.excludes) toks.push("-" + e);
  if (x.maxAge !== Infinity) toks.push("after:" + iso(x.maxAge));
  if (x.minAge) toks.push("before:" + iso(x.minAge));
  if (x.lang) toks.push("lang:" + x.lang);
  if (x.fresh) toks.push("is:fresh");
  const sortTok = {
    views_desc: "sort:views", upload_new: "sort:newest", upload_old: "sort:oldest",
    duration_desc: "sort:longest", duration_asc: "sort:shortest",
  }[ui.sort.value];
  if (sortTok) toks.push(sortTok);
  const dec = pageSp();
  const byField = {};
  for (const k in OMNI_FEATURES) if (!byField[OMNI_FEATURES[k][0]]) byField[OMNI_FEATURES[k][0]] = k;
  for (const n in dec.filters) if (byField[n]) toks.push(byField[n]);
  if (dec.filters[YT_F.type] === 9) toks.push("is:short");
  if (dec.filters[YT_F.type] === 4) toks.push("is:movie");
  const pageDate = { 2: "date:today", 3: "date:week", 4: "date:month", 5: "date:year" }[dec.filters[YT_F.date]];
  if (pageDate && !upTok) toks.push(pageDate);
  if (!minD && maxD === Infinity) {
    const pageLen = { 4: "<3m", 5: ">3m <20m", 2: ">20m" }[dec.filters[YT_F.length]];
    if (pageLen) toks.push(pageLen);
  }
  if (dec.sort === 3 && !sortTok) toks.push("sort:views");
  return toks.filter(Boolean).join(" ");
}

function updateFollowButton() {
  if (!ui || !ui.followBtn) return;
  const show = isSearchPage() && !state.omniScope;
  ui.followBtn.style.display = show ? "" : "none";
  if (!show) return;
  const q = panelQueryString();
  const on = isFollowing(q);
  ui.followBtn.classList.toggle("ytcs-on", on);
  ui.followBtn.lastChild.textContent = on ? "Following" : "Follow";
  ui.followBtn.title = on
    ? "Following “" + q + "”. Click to stop"
    : "Follow “" + q + "”: new matches will wait for you in the search bar";
}

// What the panel is looking at, in words, for the header.
function sourceName() {
  if (isHistoryPage()) return "Your watch history";
  if (ownListScope()) return "Your " + LIB_NAMES[ownListScope()];
  if (playlistId()) return state.listTitle || "This playlist";
  if (isSubscriptionsPage()) return "Your subscriptions";
  if (isSearchPage()) {
    if (state.omniScope === "channels") return "Channels you watch";
    if (state.omniScope) return "Your " + LIB_NAMES[state.omniScope];
    return "“" + searchQuery() + "”";
  }
  const base = channelBasePath() || "";
  return base.startsWith("/@") ? base.slice(1) : "This channel";
}

/*
 * What YouTube's own content is called on this page, so it can be found and
 * hidden. A channel renders a rich grid; history renders a section list of
 * dated groups and has no rich grid anywhere, so looking for one there spends
 * the whole retry budget finding nothing and the click appears dead.
 */
function nativeSelector() {
  if (isSearchPage()) return "ytd-search ytd-section-list-renderer";
  // Only the list itself: the playlist's header, with its title and play
  // buttons, stays where it is beside the panel. The newer playlist layout has
  // no list element, just a section list of lockups (checked live, September
  // 2026), so both are named.
  if (playlistId()) return "ytd-playlist-video-list-renderer, ytd-browse yt-section-list-renderer";
  return isHistoryPage() ? "ytd-section-list-renderer" : "ytd-rich-grid-renderer";
}

function findNativeGrid() {
  const grids = document.querySelectorAll(nativeSelector());
  for (const g of grids) {
    if (g.offsetParent && g.parentElement) return g;
  }
  return null;
}

/*
 * Hide every uploads grid, not only the one the panel mounted against.
 *
 * Tracking a single grid was the cause of "it needs a reload the first time".
 * A channel page can end up with two fully rendered grids, both carrying the
 * same 30 cards, and the panel hid whichever one was visible when the launcher
 * was clicked. The other stayed on screen, so YouTube's videos were still there
 * and the click looked like it had done nothing, even though the panel had in
 * fact mounted correctly right above them. A reload appeared to fix it because a
 * warm load settles on one grid before anyone can click.
 *
 * Idempotent, so the interval in ensureUi can call it repeatedly to catch a grid
 * that YouTube renders after the panel is already up. Originals are recorded so
 * disable() can put the page back exactly as it was.
 */
function hideNativeGrids() {
  if (!ui) return;
  for (const g of document.querySelectorAll(nativeSelector())) {
    if (ui.wrap.contains(g)) continue;
    if (state.hiddenGrids.some((h) => h.el === g)) continue;
    state.hiddenGrids.push({ el: g, display: g.style.display });
    g.style.display = "none";
  }
}

function restoreNativeGrids() {
  for (const h of state.hiddenGrids) {
    // Nodes YouTube has since replaced are detached; writing to them is
    // harmless and cheaper than checking isConnected on every one.
    h.el.style.display = h.display || "";
  }
  state.hiddenGrids = [];
}

// A tab that has just been brought to the front has to mount ytd-browse from
// scratch, which takes longer than a normal in-page navigation, so the budget
// is wider than the 2.4s that was enough when this only ran on a visible tab.
async function findGridWithRetry(tries) {
  tries = tries || 25;
  for (let i = 0; i < tries; i++) {
    const g = findNativeGrid();
    if (g && g.parentElement) return g;
    await sleep(200);
  }
  return null;
}

function recomputeMedians() {
  const vpds = state.catalog.filter((v) => v.days).map((v) => v.views / Math.max(v.days, 1));
  state.medianVpd = median(vpds);
  state.medianViews = median(state.catalog.map((v) => v.views));
}

// Load from cache instantly if present; otherwise fetch fresh.
/*
 * True when the page a read started on is gone. Reading a channel or a search
 * takes seconds, and people leave mid-read. Without this the read finished
 * anyway and either drew into a panel that had been torn down (a TypeError on
 * the home page, since leaving to a page with no panel throws ui away) or,
 * worse, drew the old page's videos into the next page's panel.
 */
function pageGone(gen) {
  return gen !== state.navGen || !ui;
}

async function loadCatalog() {
  if (state.loading) return;
  const gen = state.navGen;
  const key = sourceKey();
  const cached = key ? await idbGet(key) : null;
  if (pageGone(gen)) return;
  if (cached && cached.videos && cached.videos.length) {
    state.catalog = cached.videos;
    state.cachedAt = cached.fetchedAt || 0;
    state.newIds = new Set();
    recomputeMedians();
    const hasWatch = state.catalog.some((v) => typeof v.progress === "number");
    setStatus([plural(state.catalog.length, "video"), "Cached " + fmtAgo(state.cachedAt), hasWatch ? "" : "Refresh for watch history"]);
    applyView();
    return;
  }
  await refreshCatalog();
}

/*
 * Store the catalogue and keep a rolling set of view-count snapshots. Diffing
 * the newest fetch against the previous snapshot gives measured velocity,
 * which is real rather than inferred from YouTube's relative dates. Videos
 * are annotated in place so the numbers survive in the cache.
 */
async function persistCatalog(key, cat) {
  const prev = await idbGet(key);
  const history = (prev && prev.history) || [];
  const last = history[history.length - 1];
  const now = Date.now();

  if (last && last.t) {
    const days = (now - last.t) / 86400000;
    if (days > 0.02) {
      for (const v of cat) {
        const before = last.v[v.id];
        if (typeof before !== "number" || v.views < before) continue;
        const gained = v.views - before;
        // Anything that could be explained by the two-significant-figure
        // rounding in listing counts is not a measurement. Recording it would
        // hand the outlier maths a fabricated jump.
        if (!beyondRounding(gained, v.views)) continue;
        v.gained = gained;
        v.sinceDays = days;
        v.measuredVpd = gained / days;
      }
    }
  }

  // Prototype-less: video ids come out of a parsed payload and become object
  // keys here, and a key like "__proto__" or "constructor" on a normal object
  // does not behave like data. Nothing can currently produce one, since
  // YouTube assigns the ids, but this is the only place parsed strings are
  // used as keys and the guard costs nothing.
  const snapshot = Object.create(null);
  for (const v of cat) snapshot[v.id] = v.views;
  // Only lay down a fresh snapshot once enough time has passed, otherwise a
  // burst of refreshes would collapse the measurement window to minutes.
  const tooSoon = last && last.t && (now - last.t) / 86400000 <= 0.02;
  const nextHistory = tooSoon ? history : history.concat([{ t: now, v: snapshot }]).slice(-SNAPSHOT_LIMIT);

  const oldIds = prev && prev.ids ? new Set(prev.ids) : null;
  const newIds = oldIds ? cat.filter((v) => !oldIds.has(v.id)).map((v) => v.id) : [];

  await idbPut(key, {
    channel: key,
    fetchedAt: now,
    videos: cat,
    ids: cat.map((v) => v.id),
    history: nextHistory,
  });
  // Record when this channel was last read, then drop the least recently
  // fetched once the cache is oversized. Both after the write, so the channel
  // just visited is never the one evicted.
  await touchIndex(key, now);
  await pruneCache();
  return { newIds: newIds, snapshots: nextHistory.length, at: now };
}

async function refreshCatalog() {
  if (state.loading) return;
  state.loading = true;
  const gen = state.navGen;
  // A refresh has cards to fade, which reads as "updating". A first visit has
  // nothing, so it gets the panel that explains the wait instead.
  const cold = !state.catalog.length;
  if (cold) { setView("search"); renderLoading(0); }
  else ui.grid.classList.add("ytcs-busy");
  setStatus(["Loading…"]);
  state.failure = null;
  const key = sourceKey();
  const history = isHistoryPage();
  const search = isSearchPage();
  const own = ownListScope();
  const list = playlistId();
  const subs = isSubscriptionsPage();
  const scope = search && state.omniScope;
  try {
    /*
     * A first read shows what it has as it goes, so a big channel puts its
     * first page up within a second or two instead of a counter for as long as
     * the whole read takes (TED's 1,800 videos: 20 seconds). At most one redraw
     * every 1.2s, since each rebuilds up to 600 cards. Search keeps its own
     * batches, and the library scopes arrive in one piece anyway.
     */
    const early = cold && !search && !scope;
    let drawnAt = 0;
    const onProgress = (n, sofar) => {
      if (pageGone(gen)) return;
      if (early && sofar && sofar.length && Date.now() - drawnAt > 1200) {
        drawnAt = Date.now();
        state.catalog = list ? sofar.filter((v) => v.playable !== false) : sofar.slice();
        recomputeMedians();
        applyView();
      } else if (cold && !drawnAt) {
        renderLoading(n);
      }
      setStatus(["Loading… " + n]);
    };
    // Your own lists, history and subscriptions are nothing signed out. Say so
    // plainly, rather than read YouTube's signed-out page and call it empty.
    if ((history || own || subs) && !signedIn()) {
      const e = expectedError("Sign in to YouTube to search your " + (history ? "watch history" : subs ? "subscriptions" : LIB_NAMES[own]));
      e.hint = "Needle reads it with your own sign-in, in this browser. Nothing goes anywhere else.";
      throw e;
    }
    const read = history
      ? await fetchHistory(onProgress, cfg.deepHistory)
      // Each video's own menu actions, kept on lists that might be yours.
      : list ? await fetchPlaylist(list, cfg.deepHistory, onProgress, { actions: own !== "wl" })
      : subs ? await fetchSubscriptions(onProgress, cfg.deepHistory)
      : scope ? await libraryCatalog(scope)
      : search ? await fetchSearch(searchQuery(), onProgress, cfg.deepHistory, currentSearchPlan())
      : await fetchCatalog(onProgress);
    // Deleted and private videos sit in playlists as unplayable stubs.
    const cat = list ? Object.assign(read.filter((v) => v.playable !== false), { truncated: read.truncated, shallow: read.shallow }) : read;
    if (pageGone(gen)) return;
    // Nothing read from a page that is plainly showing videos: YouTube changed
    // something. Say so, and filter what is on screen meanwhile.
    if (!cat.length && !scope && readScreenCards().length) {
      showReadFailure(null);
      return;
    }
    if (list) {
      state.listTitle = read.title || "";
      ui.source.textContent = sourceName();
    }
    state.catalog = cat;
    state.cachedAt = Date.now();

    /*
     * History skips persistCatalog entirely. That function keeps rolling
     * view-count snapshots so measured velocity can diff them, which describes
     * how a channel's videos are performing. History is a list of things you
     * watched, drawn from dozens of channels, so a velocity number over it
     * would be measuring nothing. Cached plainly instead.
     */
    let info = { newIds: [], snapshots: 1 };
    if (history) {
      await idbPut(key, { videos: cat, fetchedAt: Date.now() });
      await touchIndex(key, Date.now());
    } else if (key) {
      info = await persistCatalog(key, cat);
    }
    if (pageGone(gen)) return;
    state.newIds = new Set(info.newIds);
    if (search && !scope && state.followFresh) {
      // A followed search's news, opened from the bar: first, and marked NEW,
      // including any this read of the results did not happen to reach.
      const fresh = state.followFresh;
      state.followFresh = null;
      const ids = new Set(fresh.map((v) => v.id));
      const known = new Map(cat.map((v) => [v.id, v]));
      const rest = cat.filter((v) => !ids.has(v.id));
      const top = fresh.map((v) => known.get(v.id) || v);
      cat.length = 0;
      for (const v of top.concat(rest)) cat.push(v);
      state.newIds = ids;
    }
    recomputeMedians();

    state.searchCtx = search && !scope ? cat.search || null : null;
    if (search && !scope) {
      searchStatus();
    } else {
      const bits = [plural(cat.length, "video")];
      if (own) {
        // Page one of a list is its first 100; say so rather than let a long
        // Watch Later look complete.
        if (!cat.length) bits.push("Nothing read. Are you signed in?");
        else if (cat.shallow) bits.push("First 100 only. Deep reading, in the popup, reads further");
      } else if (list) {
        if (!cat.length) bits.push("Nothing to read. The playlist may be private");
        else if (cat.truncated) bits.push("Stopped at your video limit, set in the popup");
      } else if (subs) {
        if (cat.shallow) bits.push("Latest page only. Deep reading, in the popup, reads further");
      } else if (scope) {
        if (!cat.length) bits.push("Nothing read yet. Are you signed in?");
        else if (library.short[scope]) bits.push((scope === "hist" ? "Latest page only" : "First 100 only") + ". Deep reading, in the popup, reads further");
      } else if (history) {
        // Say when the list stops rather than letting it look like everything.
        const oldest = cat[cat.length - 1];
        if (oldest && oldest.watchedLabel) bits.push("Back to " + oldest.watchedLabel);
        if (cat.shallow) bits.push("First page only. Deep reading, in the popup, reads further");
      } else {
        // Plain words, and nothing at all on a first visit: "First snapshot"
        // described bookkeeping, not anything a person can use.
        if (info.newIds.length) bits.push(plural(info.newIds.length, "new upload") + " since last visit");
        if (info.snapshots > 1) bits.push("Growth tracked over " + plural(info.snapshots, "visit"));
      }
      setStatus(bits);
    }
    syncEditButton();
    applyView();
  } catch (e) {
    // Signed out, history paused and the like are states, not faults.
    if (!e.expected) console.error("[Needle]", e);
    if (!pageGone(gen)) {
      if (e.expected && !readScreenCards().length) {
        setStatus([]);
        renderNotice(e.message, e.hint || "");
        syncEditButton();
      } else showReadFailure(e);
    }
  } finally {
    // After a navigation the flag belongs to the next page's read, which the
    // navigation already released, so an old read must not touch it.
    if (gen === state.navGen) state.loading = false;
    if (!pageGone(gen)) ui.grid.classList.remove("ytcs-busy");
  }
}

// The header's status: short facts, each capitalised, spaced apart by CSS.
function setStatus(bits, title) {
  factsInto(ui.status, bits.filter(Boolean).map(cap));
  ui.status.title = title || "";
}

/*
 * What to ask YouTube for, given the page and the panel together: the page's own
 * filters (picked in YouTube's dialog, or typed into the bar and sent on), plus
 * whatever the panel is narrowing to right now.
 */
function currentSearchPlan() {
  const [minDur, maxDur] = rangeVal(ui.duration);
  let maxAge = state.extra.maxAge;
  const up = ui.uploaded.value;
  if (up && up !== "old" && !isNaN(parseFloat(up))) maxAge = Math.min(maxAge, parseFloat(up));
  return searchPlan(pageSp(), { minDur, maxDur, maxAge, sort: ui.sort.value });
}

function searchStatus() {
  const ctx = state.searchCtx;
  const n = state.catalog.length;
  const done = ctx && Object.keys(ctx.sessions).every((k) => ctx.sessions[k].done);
  const bits = [(done ? "All " : "First ") + plural(n, "result")];
  const yt = spLabels(pageSp());
  if (yt.length) bits.push("YouTube filters: " + yt.join(", "));
  let title = "";
  // Signed out there is no watch progress to be partial about.
  if (ctx && ctx.partial && signedIn()) {
    bits.push("Watch progress partial");
    title = "Watch progress is only known for the first page of results. Deep reading, in the popup, covers the rest.";
  }
  setStatus(bits, title);
}

// "Asks YouTube for over 20 minutes, this week": what the next batch will be.
function planNote(plan) {
  const parts = [];
  if (plan.lengths[0]) parts.push(plan.lengths.map((l) => YT_LENGTH_LABELS[l].toLowerCase()).join(" and "));
  const d = YT_DATES.find(([c]) => c === plan.filters[YT_F.date]);
  if (d) parts.push(d[2].toLowerCase());
  if (plan.sort === 3) parts.push("most popular first");
  return parts.length ? "Asks YouTube for " + parts.join(", ") : "Asks YouTube for the next results";
}

/*
 * Load more. The next batch is asked for with the panel's current filters
 * translated into YouTube's, so if the panel says over 45 minutes, YouTube is
 * asked for over 20 and nearly everything that comes back fits. Asking for
 * plain "more" would bring 200 mixed videos to keep perhaps thirty of them.
 */
async function loadMoreResults() {
  const ctx = state.searchCtx;
  if (!ctx || state.loading) return;
  state.loading = true;
  const gen = state.navGen;
  const btn = ui.grid.querySelector(".ytcs-loadmorebtn");
  try {
    await searchMore(ctx, currentSearchPlan(), SEARCH_STEP, state.catalog, (n) => {
      if (btn) btn.textContent = "Loading… " + n;
    });
  } catch (e) {
    console.error("[Needle]", e);
  } finally {
    if (gen === state.navGen) state.loading = false;
  }
  if (pageGone(gen)) return;
  recomputeMedians();
  searchStatus();
  applyView();
}

function renderLoadMore(container) {
  if (!isSearchPage() || state.omniScope || !state.searchCtx) return;
  const plan = currentSearchPlan();
  const box = document.createElement("div");
  box.className = "ytcs-loadmore";
  if (!searchCanGrow(state.searchCtx, plan, state.catalog.length)) {
    const end = document.createElement("span");
    end.className = "ytcs-loadmorenote";
    // "For these filters" when the batch was asked for with YouTube's filters:
    // the plain search may well go further, it just has nothing more that fits.
    const narrowed = plan.lengths[0] || plan.filters[YT_F.date] || plan.sort;
    end.textContent = state.catalog.length >= SEARCH_MAX
      ? "That is the most one search holds, " + SEARCH_MAX + " results"
      : narrowed ? "That is everything YouTube had for these filters" : "That is everything YouTube had for this search";
    box.appendChild(end);
    container.appendChild(box);
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ytcs-loadmorebtn";
  btn.textContent = "Load more results";
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = "Loading…";
    loadMoreResults();
  };
  const note = document.createElement("span");
  note.className = "ytcs-loadmorenote";
  note.textContent = planNote(plan);
  box.appendChild(btn);
  box.appendChild(note);
  container.appendChild(box);
}

/*
 * YouTube does not mount ytd-browse at all while the tab is in the background.
 * There is no grid, no #primary, nothing to take over, and findGridWithRetry
 * spends its whole budget against a page that has not rendered. It then falls
 * through to document.body, so the panel lands somewhere useless and the native
 * grid is never hidden. Switch to the tab afterwards and you have both.
 *
 * Clicking the launcher cannot hit this, since you have to be looking at the
 * tab to click it. Auto-open can: it fires 800ms after load, which for a
 * channel opened in a background tab is long before anything exists.
 */
function whenVisible() {
  if (document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

/*
 * ---- rating ask state -----------------------------------------------------
 *
 * Lives in storage.local rather than storage.sync on purpose. It is a count of
 * how often this device opened the panel, which is usage and not a preference,
 * and the listing's permission justification promises sync holds settings only.
 * The cost is that dismissing on a second machine takes one more click, which
 * is cheaper than muddying that claim.
 *
 * A failed read resolves null, meaning "unknown", and never a state object. The
 * first version returned `{ opens: 0, done: true }` here on the reasoning that
 * the ask should fail closed. But `done: true` is the terminal state, and
 * tickRating returns on it before writing anything, so one transient read error
 * retired the feature permanently and left the key absent. Fail closed for this
 * attempt, not for the install.
 */
function rateState() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [RATE_KEY]: { opens: 0, done: false } }, (got) => {
        if (chrome.runtime.lastError || !got) return resolve(null);
        resolve(got[RATE_KEY] || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function saveRateState(v) {
  try {
    chrome.storage.local.set({ [RATE_KEY]: v });
  } catch (e) { /* best-effort, same as the cache writes */ }
}

// Rated, or "Don't ask again": finished for good. countUse short-circuits on
// `done`, so nothing keeps counting afterwards.
function closeRating() {
  if (ui) ui.rate.hidden = true;
  rateCache = Object.assign({}, rateCache, { done: true });
  saveRateState(rateCache);
}

// "Not now": away until RATE_SNOOZE more uses, and the last of RATE_MAX_ASKS
// of these ends it, so a patient "no" is still a no.
function snoozeRating() {
  if (ui) ui.rate.hidden = true;
  const st = rateCache || { opens: 0 };
  const asks = (st.asks || 0) + 1;
  rateCache = Object.assign({}, st, { asks, snooze: (st.opens || 0) + RATE_SNOOZE, done: asks >= RATE_MAX_ASKS });
  saveRateState(rateCache);
}

// Today on this device's clock, as the one string the days count compares.
function rateDay() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

/*
 * Counts one *use*, and the days on which there was one.
 *
 * A use is the tool doing the thing it exists for: a filter that actually
 * narrowed a list ("236 of 236" becoming "6 of 236"), a video opened from your
 * library in the search bar, a filtered search sent from it, or a clean-up of
 * Watch Later. Not a panel open. Opening something three times proves somebody
 * clicked a button three times; finding the video is the only moment anyone
 * feels like recommending it.
 *
 * Once per page, whatever happens on it: typing a five-letter search term would
 * otherwise count five uses on somebody's first visit.
 *
 * Counting reveals nothing by itself any more. rateMoment does that, and only
 * when it has just helped.
 */
let rateCache = null;
let rateCountedGen = -1;

async function countUse() {
  if (rateCountedGen === state.navGen) return;
  rateCountedGen = state.navGen;
  const st = await rateState();
  // Unknown state, so nothing is counted and nothing is concluded. The guard
  // reopens so the next use tries again rather than the install going quiet.
  if (!st) { rateCountedGen = -1; return; }
  rateCache = st;
  if (st.done) return;
  const today = rateDay();
  // Installs from before 2.1.2 counted uses but not days, so any use already
  // made stands for one earlier day.
  const days = (st.days != null ? st.days : st.opens ? 1 : 0) + (st.day === today ? 0 : 1);
  // `at` is never read. It exists so that one storage read answers "did this
  // ever run", which is the question that cost a day of guessing.
  rateCache = Object.assign({}, st, { opens: (st.opens || 0) + 1, days, day: today, done: false, at: Date.now() });
  saveRateState(rateCache);
}

// Read once on load, so the search bar's dropdown knows the answer on a page
// where nothing has been used yet.
rateState().then((st) => { if (st && !rateCache) rateCache = st; });

// grid.js calls it by this name, after a filter narrows the panel's list.
function tickRating() {
  countUse();
}

function rateAskReady() {
  return !!rateCache && !rateCache.done && (rateCache.days || 0) >= RATE_DAYS &&
    (rateCache.opens || 0) >= (rateCache.snooze || 0);
}

/*
 * Shows the ask at the moment it just helped, if it is due at all.
 *
 * Called with a yes or no after every redraw of the list, so the wait doubles
 * as a debounce: while somebody is still typing, the count is still moving and
 * each redraw resets it. It appears once they stop on a result worth having,
 * eases in under the count, and stays for that page. One page a day at most,
 * so a second channel the same afternoon is left alone.
 */
let rateTimer = 0;
let rateShownGen = -1;

function rateMoment(win, wait) {
  clearTimeout(rateTimer);
  if (!win || !ui || !ui.rate.hidden) return;
  const gen = state.navGen;
  rateTimer = setTimeout(() => {
    if (gen !== state.navGen || !ui || !state.active || state.failure || !ui.rate.hidden || !rateAskReady()) return;
    const today = rateDay();
    if (rateCache.shown === today && rateShownGen !== gen) return;
    rateShownGen = gen;
    rateCache = Object.assign({}, rateCache, { shown: today });
    saveRateState(rateCache);
    ui.rate.hidden = false;
    ui.rate.classList.remove("ytcs-rate-in");
    void ui.rate.offsetWidth;
    ui.rate.classList.add("ytcs-rate-in");
  }, wait == null ? 1500 : wait);
}

// grid.js: a long list cut down to a handful.
function rateWin(total, shown) {
  return total >= RATE_WIN_FROM && shown > 0 && shown <= RATE_WIN_TO;
}

async function enable() {
  if (state.active || state.enabling) return;
  state.enabling = true;
  try {
    await enableNow();
  } finally {
    state.enabling = false;
  }
}

async function enableNow() {
  if (!ui) buildUi();
  await whenVisible();
  // The tab may have been left on a different page while it sat in the
  // background, so the channel it was opened for is not necessarily the one
  // being looked at now.
  if (!canRunHere()) return;
  const native = await findGridWithRetry();
  // The search for YouTube's list takes up to a few seconds, long enough to
  // have left for a page with no panel, which throws ui away.
  if (!ui || !canRunHere()) return;
  const host =
    (native && native.parentElement) ||
    document.querySelector("ytd-browse #primary") ||
    document.querySelector("#primary") ||
    document.body;

  if (native && native.parentElement) {
    native.parentElement.insertBefore(ui.wrap, native);
  } else {
    host.insertBefore(ui.wrap, host.firstChild);
  }

  state.active = true;
  hideNativeGrids();
  fitSticky();
  setLauncher(true);
  labelForSource();
  if (cfg.hideWatched) {
    ui.watched.value = "unfinished";
    ui.watched.classList.remove("ytcs-dim");
  }
  // Filters typed into YouTube's search bar, applied after the defaults above
  // because something typed on purpose outranks a standing preference.
  if (state.pendingOmni && typeof applyOmniFilters === "function") {
    applyOmniFilters(state.pendingOmni);
    state.pendingOmni = null;
  }
  layoutTokens();
  state.watchlist = await getWatchlist();
  renderNiche();
  // Never on open: the ask waits for a moment it has helped (rateMoment).
  ui.rate.hidden = true;

  /*
   * The re-entry guard is released here, at the mount, not in enable()'s
   * finally after the catalogue has loaded.
   *
   * It exists to stop two clicks racing to mount the panel twice. Once
   * state.active is true that cannot happen anyway, because the launcher
   * routes a second click to disable(). Holding it across the load meant
   * closing the panel mid-fetch and immediately reopening did nothing at all:
   * disable() clears state.active but not state.enabling, so enable() bailed
   * on a flag that was still set, and the button appeared dead until the fetch
   * it knew nothing about happened to finish. Deep history made that window
   * thirty seconds wide.
   */
  state.enabling = false;

  if (!state.catalog.length) await loadCatalog();
  else applyView();
}

/*
 * The header sticks 56px down, under YouTube's masthead, when the page itself
 * scrolls. On channel and playlist pages (Watch Later and Liked included)
 * YouTube wraps the page in ytd-browse with overflow: hidden (October 2026),
 * and a sticky element sticks within the nearest such box, not the page. That
 * box never scrolls, so the header stopped following the list, and the 56px
 * pushed it down over the line beneath it, the one with a playlist's total
 * length.
 *
 * A box like that, one that hides overflow but does not scroll, is switched to
 * overflow: clip while the panel is open. It clips exactly as before, and a
 * sticky element looks straight past it to the page. Anything that really
 * scrolls is left alone, and the offset is measured from it instead.
 */
function fitSticky() {
  const head = ui && ui.wrap.querySelector(":scope > .ytcs-chrome");
  if (!head) return;
  let box = ui.wrap.parentElement;
  for (; box && box !== document.body && box !== document.documentElement; box = box.parentElement) {
    const o = getComputedStyle(box).overflowY;
    if (o === "visible" || o === "clip") continue;
    if (o === "hidden" && box.scrollHeight <= box.clientHeight + 1 && box.scrollTop === 0) {
      box.setAttribute("data-ytcs-unclip", "");
      continue;
    }
    break;
  }
  const masthead = document.querySelector("#masthead-container");
  let under = masthead ? Math.round(masthead.getBoundingClientRect().bottom) : 56;
  // A channel's tabs (Home, Videos, Shorts...) stay fixed under the masthead as
  // the channel's header scrolls away; the panel's header stops under them,
  // not behind them. Found by their role, in whatever fixed bar holds them.
  for (const t of document.querySelectorAll("ytd-browse [role=tablist]")) {
    const h = Math.round(t.getBoundingClientRect().height);
    if (!h) continue;
    let fixed = false;
    for (let el = t.parentElement; el && el !== document.body && !fixed; el = el.parentElement) fixed = getComputedStyle(el).position === "fixed";
    if (fixed) { under += h; break; }
  }
  const page = !box || box === document.body || box === document.documentElement;
  // Where the box starts on the page, not on screen, so a scrolled page measures the same.
  const top = page ? under : Math.max(0, under - Math.round(box.getBoundingClientRect().top + window.scrollY));
  if (head.style.top !== top + "px") head.style.top = top + "px";
}

function disable() {
  restoreNativeGrids();
  for (const el of document.querySelectorAll("[data-ytcs-unclip]")) el.removeAttribute("data-ytcs-unclip");
  if (ui && ui.wrap.parentElement) ui.wrap.remove();
  state.active = false;
  setLauncher(false);
}

// ---- launcher + navigation handling --------------------------------------
/*
 * The mark: a needle with its thread looped through it, drawn loose, like a
 * pen sketch. The fainter second pass over the outline is what makes it read
 * as drawn rather than set. It takes the text colour, so it is white on the
 * dark theme and flips dark on the light one instead of vanishing.
 */
const NEEDLE_MARK = [
  ["M4 28 L22.4 7.4 Q26.3 5.7 24.6 9.6 L4 28", 1.7, 1],
  ["M3.2 28.9 L23 6.8 M4.6 27.9 L25.1 10", 0.9, 0.45],
  ["M21.1 10.9 L22.9 9.1", 1.5, 1],
  ["M22 10 C17 5.5 9.5 6 8.6 11.4 C7.8 16.4 14.6 17.8 18.6 17.4 C24 16.8 28.6 19.6 27.4 24 C26.5 27.4 22 28.6 18.8 27.2", 1.7, 1],
  ["M21.4 9.4 C16.6 5.9 10.2 6.7 9.4 11", 0.9, 0.45],
];

function needleMark(size) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [d, w, o] of NEEDLE_MARK) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke-width", w);
    if (o < 1) p.setAttribute("opacity", o);
    svg.appendChild(p);
  }
  return svg;
}

// Closed, the button is just the mark. Open, it says Close, because an icon
// alone does not tell anyone how to get YouTube's own page back.
function setLauncher(open) {
  if (!launcher) return;
  launcher.textContent = "";
  launcher.classList.toggle("ytcs-launcher-mark", !open);
  if (open) launcher.textContent = "Close";
  else launcher.appendChild(needleMark(32));
  launcher.setAttribute("aria-label", open ? "Close Needle" : "Open Needle");
}

function buildLauncher() {
  const btn = document.createElement("button");
  btn.className = "ytcs-launcher ytcs-launcher-mark";
  btn.appendChild(needleMark(32));
  btn.setAttribute("aria-label", "Open Needle");
  btn.title = "Needle: filter this page's videos by length, views, date and what you have watched";
  btn.onclick = async () => {
    if (state.active) disable();
    else await enable();
  };
  document.body.appendChild(btn);
  return btn;
}

/*
 * YouTube's own filters change its list in place. A chip on search results
 * (Videos, Unwatched, Recently uploaded...) swaps new results into the same
 * element with no navigation at all, and with the panel open that element is
 * hidden, so the click looked dead or left a black page until Close. Any click
 * on one of those controls now hands the page back to YouTube first, and says
 * how to get the panel back. Channel chips sit inside the grid the panel
 * hides, so they never reach this; Watch Later's sort and chips do.
 */
const YT_FILTER_CONTROLS = "ytd-search-header-renderer, yt-chip-cloud-chip-renderer, chip-view-model, yt-chip-view-model, ytd-feed-filter-chip-bar-renderer, yt-sort-filter-sub-menu-renderer";
document.addEventListener("click", (e) => {
  if (!state.active || !ui) return;
  const t = e.target;
  if (!t || !t.closest || ui.wrap.contains(t) || !t.closest(YT_FILTER_CONTROLS)) return;
  disable();
  if (typeof toast === "function") toast("Showing YouTube's filter. Needle is closed", "Open Needle", () => enable());
}, true);

function ensureUi() {
  // The panel is mounted beside YouTube's list. If YouTube re-renders that part
  // of the page the panel goes with it, and carrying on would keep YouTube's
  // list hidden under nothing: a black page. Give the page back instead.
  if (state.active && ui && !ui.wrap.isConnected) disable();
  const onChannel = canRunHere();
  if (onChannel && !launcher) {
    launcher = buildLauncher();
  } else if (!onChannel && launcher) {
    disable();
    launcher.remove();
    launcher = null;
    ui = null;
    state.catalog = [];
  }
  /*
   * A grid YouTube renders after the panel mounted would otherwise sit visible
   * underneath it. Catching it on the interval that is already running costs
   * nothing and needs no MutationObserver, which on ytd-browse would fire on
   * every lazy load and scroll. Worst case a stray grid shows for 1.5s.
   */
  if (state.active) { hideNativeGrids(); fitSticky(); }
  // Opened from a shared filter link: open with its filters, once.
  if (launcher) shareArrive();
}

window.addEventListener("yt-navigate-finish", () => {
  // YouTube replaces the grid node on navigation; tear down and reset.
  // Reads still running for the old page drop their results (pageGone), so
  // the loading flag is released here rather than when they finish.
  state.navGen++;
  state.loading = false;
  disable();
  state.catalog = [];
  state.searchCtx = null;
  state.newIds = new Set();
  state.cachedAt = 0;
  state.view = "search";
  state.insight = "overview";
  state.listTitle = "";
  state.lastRows = null;
  // Belongs to the page being left: dropped, not shown again here.
  state.archive = null;
  state.failure = null;
  endSelecting();
  setListView(viewPrefs[viewKind()], true);
  setTimeout(ensureUi, 300);
});
// Keyboard shortcut, relayed from the service worker.
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "ytcs-toggle" && canRunHere()) {
      if (state.active) disable();
      else enable();
      return;
    }
    /*
     * The popup cannot clear the cache itself. IndexedDB is opened from the
     * content script, so the database belongs to the youtube.com origin, and
     * the popup runs on the extension's own. It has to ask the page.
     */
    if (msg.type === "ytcs-clear") {
      clearCache().then(() => {
        state.catalog = [];
        state.newIds = new Set();
        state.cachedAt = 0;
        state.watchlist = [];
        // The search bar's copy lives in memory too. Clearing only the disk would
        // leave your Watch Later in the dropdown until the tab reloaded.
        library.wl = [];
        library.hist = [];
        library.liked = [];
        library.pl = [];
        library.short = {};
        library.plAt = 0;
        library.at = Date.now();
        // And what the memory features were holding, for the same reason.
        seen.map = null;
        seen.before = new Set();
        follows.state = null;
        chIndex.videos = null;
        if (state.active) disable();
        sendResponse({ ok: true });
      }, () => sendResponse({ ok: false }));
      return true; // async reply
    }
  });
} catch (e) { /* no extension context, nothing to relay */ }

function bootstrap() {
  /*
   * The launcher goes up first, before anything is awaited.
   *
   * It used to be built inside loadSettings().then(), which put a
   * chrome.storage.sync round trip in front of a button that reads no settings
   * at all. On a slow resolve the 1500ms interval below was what actually put
   * it on screen, which is a long time to look at a page and conclude the
   * extension is not running. Nothing here needs config: buildLauncher only
   * needs document.body and the current path.
   */
  ensureUi();
  setInterval(ensureUi, 1500);

  // Per-device state the panel and the search bar both read without waiting.
  rateState().then((st) => { if (st) rateCache = st; });
  try {
    chrome.storage.local.get({ listView: false, listViewLists: true }, (got) => {
      if (!got || chrome.runtime.lastError) return;
      viewPrefs.feeds = !!got.listView;
      viewPrefs.lists = !!got.listViewLists;
      setListView(viewPrefs[viewKind()], true);
    });
  } catch (e) { /* grid it is */ }

  loadSettings().then(() => {
    // Settings can change what is already on screen, so run it again once they
    // have landed. ensureUi is idempotent.
    ensureUi();
    /*
     * Channels only, deliberately. Auto-open is gated on canRunHere() nowhere
     * else, because that predicate grew to include watch history and this
     * setting did not: everybody who ticked this box did so when a channel was
     * the only thing the panel opened on, and silently extending it to their
     * history page is taking a decision they never made. If history auto-open
     * turns out to be wanted it can be asked for separately.
     */
    if (cfg.autoOpen && isChannelPage()) setTimeout(() => { if (!state.active) enable(); }, 800);
  });
}

if (!window.__ytcsLoaded) {
  window.__ytcsLoaded = true;
  bootstrap();
}
