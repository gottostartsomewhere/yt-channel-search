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

const rows = Object.entries(all).map(([c, t]) => `${c.padEnd(6)} name ${String(len(t.n)).padStart(2)}  summary ${String(len(t.s)).padStart(3)}  description ${len(t.d)}`);
console.log(rows.join("\n"));
console.log(`\n${Object.keys(all).length} languages written to _locales/ and docs/listing/`);
