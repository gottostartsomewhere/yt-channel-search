/*
 * Assembles dist/chrome and dist/firefox. The two stores need different
 * manifests, since Chrome MV3 wants a service worker and Firefox wants an
 * event page, but every other file is shared verbatim.
 *
 *   node build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const SHARED = ["content.js", "styles.css", "background.js", "popup.html", "popup.css", "popup.js", "icons"];
const TARGETS = [
  { name: "chrome", manifest: "manifest.json" },
  { name: "firefox", manifest: "manifest.firefox.json" },
];

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((entry) => copy(path.join(src, entry), path.join(dest, entry)));
  } else {
    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(DIST, { recursive: true, force: true });

for (const target of TARGETS) {
  const out = path.join(DIST, target.name);
  fs.mkdirSync(out, { recursive: true });

  for (const entry of SHARED) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) throw new Error("missing " + entry);
    copy(src, path.join(out, entry));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, target.manifest), "utf8"));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(target.name + ": " + manifest.version + " -> dist/" + target.name);
}
