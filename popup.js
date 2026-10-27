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
  allowEdits: false,
  feedWatched: "off",
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

/*
 * Muted channels and words live in local storage now (memory.js says
 * why: sync holds about a hundred channels). A list from an older version is still in
 * sync until a YouTube tab moves it, so it is read from there until then.
 */
function readMuted(cb) {
  chrome.storage.local.get({ muted: null, mutedWords: [] }, (got) => {
    if (got && got.muted) return cb(got.muted, got.mutedWords || []);
    chrome.storage.sync.get({ muted: [] }, (old) => cb((old && old.muted) || [], (got && got.mutedWords) || []));
  });
}

function mutedLabel(m) {
  if (m.name) return m.name + (m.handle ? "  @" + m.handle : "");
  return m.handle ? "@" + m.handle : m.channelId;
}

function paintLists() {
  chrome.storage.sync.get({ follows: [] }, (got) => {
    renderList("follows", "followsEmpty", got.follows, (f) => f.q, (f) => {
      chrome.storage.sync.set({ follows: got.follows.filter((x) => x.id !== f.id) }, paintLists);
    });
  });
  readMuted((list, words) => {
    renderList("muted", "mutedEmpty", list, mutedLabel, (m) => {
      chrome.storage.local.set({ muted: list.filter((x) => x !== m) }, paintLists);
    });
    renderList("mutedWords", "wordsEmpty", words, (w) => w, (w) => {
      chrome.storage.local.set({ muted: list, mutedWords: words.filter((x) => x !== w) }, paintLists);
    });
  });
}
paintLists();

// ---- muted words -------------------------------------------------------------------
$("wordForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const w = $("wordInput").value.replace(/\s+/g, " ").trim();
  if (!w) return;
  readMuted((list, words) => {
    const already = words.some((x) => x.toLowerCase() === w.toLowerCase());
    if (!already) words = words.concat([w]).slice(-500);
    chrome.storage.local.set({ muted: list, mutedWords: words }, () => {
      $("wordInput").value = "";
      paintLists();
      flash(already ? "Already muted" : "Muted " + w);
    });
  });
});

/*
 * ---- export and import ----------------------------------------------------------------
 *
 * Plain text, one per line, so it survives any editor and so a list from
 * another blocker comes in after a copy and paste:
 *
 *   @veritasium                                  a handle
 *   https://www.youtube.com/@veritasium          a link to one
 *   UCHnyfMqiRRG1u-2MsSQLbXA                     a channel id, or a link with one
 *   word: crypto                                 a muted word
 *   Some Channel Name                            anything else is a channel's name
 *
 * A JSON file is read too: any strings in it are taken as lines, which covers
 * the exports of the blockers that write JSON.
 */
const MUTE_FILE_HEAD = "# Needle muted list. One per line: @handle, a channel link or UC id, \"word: something\", or a channel's name.";

$("muteExport").addEventListener("click", () => {
  readMuted((list, words) => {
    const lines = [MUTE_FILE_HEAD];
    for (const m of list) lines.push(m.handle ? "@" + m.handle : m.channelId ? m.channelId : m.name);
    for (const w of words) lines.push("word: " + w);
    const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "needle-muted.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    flash("Exported " + list.length + " channels, " + words.length + " words");
  });
});

$("muteImport").addEventListener("click", () => $("muteFile").click());

function muteLinesFrom(text) {
  try {
    const j = JSON.parse(text);
    const strings = [];
    (function walk(o) {
      if (typeof o === "string") strings.push(o);
      else if (o && typeof o === "object") for (const k in o) walk(o[k]);
    })(j);
    return strings;
  } catch (e) {
    return text.split(/\r?\n/);
  }
}

function parseMuteLine(raw) {
  const line = String(raw).trim();
  if (!line || line.charAt(0) === "#") return null;
  const word = line.match(/^(?:word|keyword)\s*:\s*(.+)$/i);
  if (word) return { word: word[1].replace(/\s+/g, " ").trim() };
  const id = line.match(/(UC[\w-]{22})(?![\w-])/);
  const handle = line.match(/(?:^|\/)@([\p{L}\p{N}._-]+)/u);
  if (id || handle) {
    return { channel: { name: "", handle: handle ? handle[1].toLowerCase() : "", channelId: id ? id[1] : "" } };
  }
  if (line.length > 80 || /^https?:/i.test(line)) return null;
  return { channel: { name: line.toLowerCase(), handle: "", channelId: "" } };
}

function sameMuted(a, b) {
  return (a.channelId && a.channelId === b.channelId) || (a.handle && a.handle === b.handle) ||
    (!a.channelId && !a.handle && !b.channelId && !b.handle && a.name && a.name === b.name);
}

$("muteFile").addEventListener("change", () => {
  const file = $("muteFile").files && $("muteFile").files[0];
  $("muteFile").value = "";
  if (!file) return;
  file.text().then((text) => {
    readMuted((list, words) => {
      let channels = 0, added = 0;
      for (const raw of muteLinesFrom(text)) {
        const p = parseMuteLine(raw);
        if (!p) continue;
        if (p.word) {
          if (p.word && !words.some((x) => x.toLowerCase() === p.word.toLowerCase())) { words = words.concat([p.word]); added++; }
          continue;
        }
        channels++;
        if (!list.some((m) => sameMuted(m, p.channel))) list = list.concat([p.channel]);
      }
      chrome.storage.local.set({ muted: list.slice(-5000), mutedWords: words.slice(-500) }, () => {
        paintLists();
        flash("Imported " + channels + " channels, " + added + " words");
      });
    });
  });
});

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
const SUBS = /^https:\/\/www\.youtube\.com\/feed\/subscriptions\/?$/;
const CHANNEL = /^https:\/\/www\.youtube\.com\/(@[^/]+|channel\/|c\/|user\/)/;
const RESULTS = /^https:\/\/www\.youtube\.com\/results$/;
const ANY_LIST = /^https:\/\/www\.youtube\.com\/playlist\?(?:.*&)?list=([\w-]+)/;
const PANEL_PAGE = (u) => CHANNEL.test(u) || HISTORY.test(u.split("?")[0]) || SUBS.test(u.split("?")[0]) ||
  RESULTS.test(u.split("?")[0]) || ANY_LIST.test(u);
const YOUTUBE = /^https:\/\/www\.youtube\.com\//;

/*
 * What's new, once. The card shows while the flag is set and the flag is
 * cleared as soon as it has been seen, which also clears the NEW badge.
 */
chrome.storage.local.get({ whatsNew: "" }, (got) => {
  if (!got || !got.whatsNew) return;
  $("whatsnew").hidden = false;
  chrome.storage.local.set({ whatsNew: "" });
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  const url = (tab && tab.url) || "";

  if (PANEL_PAGE(url)) {
    // "Open on this channel" is wrong anywhere but a channel, and a button that
    // misnames what it is about to do is worse than a generic one.
    const list = (url.match(ANY_LIST) || [])[1];
    if (HISTORY.test(url.split("?")[0])) $("open").textContent = "Open on your history";
    if (SUBS.test(url.split("?")[0])) $("open").textContent = "Open on your subscriptions";
    if (RESULTS.test(url.split("?")[0])) $("open").textContent = "Filter these results";
    if (list) $("open").textContent = list === "WL" ? "Open on your Watch Later" : list === "LL" ? "Open on your Liked videos" : "Open on this playlist";
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
    $("hint").textContent = "Open a channel, a search, a playlist, your history or your subscriptions.";
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
