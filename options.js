/* Options page. Mirrors the defaults declared in content.js. */
const DEFAULTS = {
  maxVideos: 1800,
  outlierX: 2,
  finishedAt: 90,
  defaultSort: "newest",
  hideWatched: false,
  autoOpen: false,
};

const $ = (id) => document.getElementById(id);
const FIELDS = Object.keys(DEFAULTS);

function read(key, value) {
  const el = $(key);
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") {
    const n = parseFloat(el.value);
    return isNaN(n) ? DEFAULTS[key] : n;
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

function flash(msg) {
  const el = $("saved");
  el.textContent = msg;
  setTimeout(() => { el.textContent = ""; }, 1600);
}

chrome.storage.sync.get(DEFAULTS, paint);

$("save").addEventListener("click", () => {
  const next = {};
  FIELDS.forEach((key) => { next[key] = read(key); });
  chrome.storage.sync.set(next, () => flash("Saved"));
});

$("reset").addEventListener("click", () => {
  paint(DEFAULTS);
  chrome.storage.sync.set(DEFAULTS, () => flash("Reset"));
});

$("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
