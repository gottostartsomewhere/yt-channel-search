/* Toolbar popup. Settings save as you change them, so there is no Save button. */
const DEFAULTS = {
  maxVideos: 1800,
  finishedAt: 90,
  defaultSort: "newest",
  hideWatched: false,
  autoOpen: false,
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

// Firefox keeps shortcuts under about:addons and refuses the chrome:// URL.
const IS_GECKO = navigator.userAgent.indexOf("Firefox") !== -1;
$("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: IS_GECKO ? "about:addons" : "chrome://extensions/shortcuts" });
});

// The panel lives in the page, so opening it means messaging the active tab.
const CHANNEL = /^https:\/\/www\.youtube\.com\/(@[^/]+|channel\/|c\/|user\/)/;
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  const ok = tab && CHANNEL.test(tab.url || "");
  if (!ok) {
    $("open").disabled = true;
    $("hint").textContent = "Open a YouTube channel to use the panel.";
    return;
  }
  $("open").addEventListener("click", () => {
    chrome.tabs.sendMessage(tab.id, { type: "ytcs-toggle" }, () => {
      if (chrome.runtime.lastError) {
        $("hint").textContent = "Reload the YouTube tab, then try again.";
        return;
      }
      window.close();
    });
  });
});
