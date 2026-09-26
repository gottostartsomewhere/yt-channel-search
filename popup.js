/* Toolbar popup. Settings save as you change them, so there is no Save button. */
const DEFAULTS = {
  maxVideos: 1800,
  finishedAt: 90,
  defaultSort: "newest",
  hideWatched: false,
  autoOpen: false,
  deepHistory: false,
  librarySearch: true,
  filterTips: true,
  channelIndex: true,
};

const $ = (id) => document.getElementById(id);
const FIELDS = Object.keys(DEFAULTS);

function read(key) {
  const el = $(key);
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") {
    const n = parseFloat(el.value);
    if (isNaN(n)) return DEFAULTS[key];
    const min = parseFloat(el.min), max = parseFloat(el.max);
    return Math.min(max, Math.max(min, n));
  }
  return el.value;
}

function paint(values) {
  FIELDS.forEach((key) => {
    const el = $(key);
    if (el.type === "checkbox") el.checked = !!values[key];
    else el.value = values[key];
  });
}

let flashTimer = null;
function flash(msg) {
  const el = $("saved");
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.textContent = ""; }, 1400);
}

function save() {
  const next = {};
  FIELDS.forEach((key) => { next[key] = read(key); });
  chrome.storage.sync.set(next, () => flash("Saved"));
}

chrome.storage.sync.get(DEFAULTS, paint);
FIELDS.forEach((key) => $(key).addEventListener("change", save));

$("reset").addEventListener("click", () => {
  paint(DEFAULTS);
  chrome.storage.sync.set(DEFAULTS, () => flash("Reset"));
});

/*
 * Followed searches and muted channels, each with a way out. Both live in the
 * browser's synced storage, so this reads and edits them directly, and any
 * open YouTube tab picks the change up through its storage listener.
 */
function renderList(listId, emptyId, items, label, onRemove) {
  const ul = $(listId);
  ul.textContent = "";
  $(emptyId).hidden = items.length > 0;
  for (const item of items) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "item";
    text.textContent = label(item);
    const x = document.createElement("button");
    x.className = "remove";
    x.textContent = "×";
    x.setAttribute("aria-label", "Remove " + label(item));
    x.addEventListener("click", () => onRemove(item));
    li.appendChild(text);
    li.appendChild(x);
    ul.appendChild(li);
  }
}

function paintLists() {
  chrome.storage.sync.get({ follows: [], muted: [] }, (got) => {
    renderList("follows", "followsEmpty", got.follows, (f) => f.q, (f) => {
      chrome.storage.sync.set({ follows: got.follows.filter((x) => x.id !== f.id) }, paintLists);
    });
    renderList("muted", "mutedEmpty", got.muted, (m) => m.name || "@" + m.handle, (m) => {
      chrome.storage.sync.set({ muted: got.muted.filter((x) => !(x.name === m.name && x.handle === m.handle)) }, paintLists);
    });
  });
}
paintLists();

// Firefox keeps shortcuts under about:addons and refuses the chrome:// URL.
const IS_GECKO = navigator.userAgent.indexOf("Firefox") !== -1;
$("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: IS_GECKO ? "about:addons" : "chrome://extensions/shortcuts" });
});

// The panel lives in the page, so opening it means messaging the active tab.
/*
 * Every page the panel can open on. Must stay in step with canRunHere() in
 * panel.js: the content script decides whether the launcher appears, this
 * decides whether the popup's button works, and they answering differently
 * means a button that says it cannot do something the page is already doing.
 */
const HISTORY = /^https:\/\/www\.youtube\.com\/feed\/history\/?$/;
const CHANNEL = /^https:\/\/www\.youtube\.com\/(@[^/]+|channel\/|c\/|user\/)/;
const RESULTS = /^https:\/\/www\.youtube\.com\/results$/;
const OWN_LIST = /^https:\/\/www\.youtube\.com\/playlist\?(?:.*&)?list=(WL|LL)(?:&|$)/;
const PANEL_PAGE = (u) => CHANNEL.test(u) || HISTORY.test(u.split("?")[0]) || RESULTS.test(u.split("?")[0]) || OWN_LIST.test(u);
const YOUTUBE = /^https:\/\/www\.youtube\.com\//;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  const url = (tab && tab.url) || "";

  if (PANEL_PAGE(url)) {
    // "Open on this channel" is wrong on the history page, and a button that
    // misnames what it is about to do is worse than a generic one.
    if (HISTORY.test(url.split("?")[0])) $("open").textContent = "Open on your history";
    if (RESULTS.test(url.split("?")[0])) $("open").textContent = "Filter these results";
    if (OWN_LIST.test(url)) $("open").textContent = url.includes("list=WL") ? "Open on your Watch Later" : "Open on your Liked videos";
    $("open").addEventListener("click", () => {
      chrome.tabs.sendMessage(tab.id, { type: "ytcs-toggle" }, () => {
        if (chrome.runtime.lastError) {
          $("hint").textContent = "Reload the YouTube tab, then try again.";
          return;
        }
        window.close();
      });
    });
  } else {
    $("open").disabled = true;
    $("hint").textContent = "Open a channel, a search, your history or Watch Later.";
  }

  /*
   * Cached catalogues live in IndexedDB on the youtube.com origin, because the
   * content script is what opens the database. This popup runs on the
   * extension's own origin and cannot reach it, so clearing has to be asked of
   * a YouTube tab. Any YouTube page will do, not just a channel.
   */
  const clear = $("clear");
  if (!YOUTUBE.test(url)) {
    clear.disabled = true;
    clear.title = "Open a YouTube tab to clear cached data";
    return;
  }
  clear.addEventListener("click", () => {
    if (clear.dataset.armed !== "1") {
      clear.dataset.armed = "1";
      clear.textContent = "Sure? Click again";
      flash("Catalogues, your library copy, watchlist");
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "ytcs-clear" }, (res) => {
      clear.dataset.armed = "";
      clear.textContent = "Clear cached data";
      if (chrome.runtime.lastError || !res || !res.ok) {
        flash("Reload the YouTube tab first");
        return;
      }
      flash("Cleared");
    });
  });
});
