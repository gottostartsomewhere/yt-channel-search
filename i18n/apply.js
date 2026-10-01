/*
 * Writes the translated store listing from i18n/listing-*.js:
 *   _locales/<code>/messages.json   name + summary, shipped in the package
 *   docs/listing/<code>.txt         long description, pasted per language in
 *                                   the dashboard (the store keeps newlines,
 *                                   so each paragraph is one unbroken line)
 *
 * The dashboard only offers a language when the package has its _locales
 * folder, so the package has to ship before the descriptions can be pasted.
 * English is left alone: it is edited by hand in _locales/en.
 *
 *   node i18n/apply.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// Chrome's list. Any other folder name is silently ignored by Chrome.
const SUPPORTED = ("ar am bg bn ca cs da de el es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt " +
  "lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW").split(" ");
const DASHES = String.fromCharCode(0x2013, 0x2014);

const all = {};
for (const f of fs.readdirSync(__dirname).filter((f) => /^listing-\d+\.js$/.test(f)).sort()) {
  for (const [code, t] of Object.entries(require(path.join(__dirname, f)))) {
    if (all[code]) throw new Error(code + " is translated twice");
    all[code] = t;
  }
}

const len = (s) => [...s].length;
const problems = [];
function check(code, t) {
  const say = (m) => problems.push(code + ": " + m);
  if (!SUPPORTED.includes(code)) say("not a locale Chrome supports");
  if (!t.n || !t.s || !t.d) return say("missing name, summary or description");
  if (len(t.n) > 75) say("name is " + len(t.n) + " characters, store limit 75");
  if (len(t.s) > 132) say("summary is " + len(t.s) + " characters, store limit 132");
  if (!t.n.includes("Needle") || !t.n.includes("YouTube")) say("name must keep Needle and YouTube");
  if (!t.d.includes("Needle")) say("description never names Needle");
  for (const [field, s] of [["name", t.n], ["summary", t.s], ["description", t.d]]) {
    if ([...s].some((ch) => DASHES.includes(ch))) say(field + " has an em or en dash");
    // Lone surrogates and noncharacters make Chrome refuse the whole package.
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if ((cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe) say(field + " has an unreadable character U+" + cp.toString(16));
    }
    if (/\s$|^\s/.test(s.split("\n")[0])) say(field + " starts or ends with a space");
  }
  if (/\n{3,}/.test(t.d)) say("description has a double blank line");
}

for (const [code, t] of Object.entries(all)) check(code, t);
const missing = SUPPORTED.filter((c) => !all[c]);
if (missing.length) problems.push("no translation for: " + missing.join(" "));
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

fs.mkdirSync(path.join(ROOT, "docs", "listing"), { recursive: true });
for (const [code, t] of Object.entries(all)) {
  const dir = path.join(ROOT, "_locales", code);
  fs.mkdirSync(dir, { recursive: true });
  const msg = { extName: { message: t.n }, extDesc: { message: t.s } };
  fs.writeFileSync(path.join(dir, "messages.json"), JSON.stringify(msg, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, "docs", "listing", code + ".txt"), t.d.trim() + "\n");
}

// A local page for the dashboard pass: one Copy button per language, biggest
// YouTube markets first, a tick box per row remembered in localStorage.
const ORDER = ("pt_BR es_419 es id hi ja ru de fr tr vi ko it pl th ar zh_TW fil uk nl ms bn ta te mr gu kn ml " +
  "fa he cs ro hu el sv da no fi pt_PT ca sk hr sl bg sr lt lv et sw am zh_CN").split(" ");
const names = new Intl.DisplayNames(["en"], { type: "language" });
const entries = ORDER.filter((c) => all[c]).map((c) => ({ code: c, lang: names.of(c.replace("_", "-")), d: all[c].d.trim() }));
const data = JSON.stringify(entries).replace(/</g, "\\u003c");
fs.writeFileSync(path.join(ROOT, "docs", "listing", "paste.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Needle listing paste</title>
<style>
:root{--bg:#fff;--fg:#111;--mute:#666;--line:#e3e3e3;--acc:#e0242e}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f0f;--fg:#eee;--mute:#999;--line:#2a2a2a}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:760px;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--mute);margin:0 0 20px}
.row{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.row.done .lang{text-decoration:line-through;color:var(--mute)}
.code{color:var(--mute);font:12px ui-monospace,monospace;margin-left:6px}
button{font:inherit;border:1px solid var(--line);background:none;color:var(--fg);border-radius:6px;padding:4px 12px;cursor:pointer}
button.ok{border-color:var(--acc);color:var(--acc)}
details{grid-column:1/-1}summary{color:var(--mute);cursor:pointer;font-size:13px}
pre{white-space:pre-wrap;font:13px/1.5 system-ui,sans-serif;margin:8px 0 0}
</style></head><body>
<h1>Needle store listing, ${entries.length} languages</h1>
<p>Dashboard, Store listing, pick the language, paste into Description. Name and summary come from the package.</p>
<div id="list"></div>
<script>
const items = ${data};
let done = {};
try { done = JSON.parse(localStorage.getItem("needle-paste") || "{}"); } catch (e) {}
const save = () => { try { localStorage.setItem("needle-paste", JSON.stringify(done)); } catch (e) {} };
const list = document.getElementById("list");
for (const it of items) {
  const row = document.createElement("div");
  row.className = "row" + (done[it.code] ? " done" : "");
  const tick = document.createElement("input");
  tick.type = "checkbox"; tick.checked = !!done[it.code];
  tick.onchange = () => { done[it.code] = tick.checked; row.classList.toggle("done", tick.checked); save(); };
  const label = document.createElement("div");
  label.innerHTML = '<span class="lang"></span><span class="code"></span>';
  label.firstChild.textContent = it.lang; label.lastChild.textContent = it.code;
  const btn = document.createElement("button");
  btn.textContent = "Copy";
  btn.onclick = async () => {
    try { await navigator.clipboard.writeText(it.d); }
    catch (e) { const t = document.createElement("textarea"); t.value = it.d; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    btn.textContent = "Copied"; btn.classList.add("ok");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("ok"); }, 1500);
  };
  const more = document.createElement("details");
  more.innerHTML = "<summary>Show text</summary><pre></pre>";
  more.querySelector("pre").textContent = it.d;
  row.append(tick, label, btn, more);
  list.appendChild(row);
}
</script></body></html>
`);

const rows = Object.entries(all).map(([c, t]) => `${c.padEnd(6)} name ${String(len(t.n)).padStart(2)}  summary ${String(len(t.s)).padStart(3)}  description ${len(t.d)}`);
console.log(rows.join("\n"));
console.log(`\n${Object.keys(all).length} languages written to _locales/ and docs/listing/`);
