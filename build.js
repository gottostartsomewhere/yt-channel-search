/*
 * Assembles dist/chrome and dist/firefox. The two stores need different
 * manifests, since Chrome MV3 wants a service worker and Firefox wants an
 * event page, but every other file is shared verbatim.
 *
 *   node build.js
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const SHARED = ["src", "styles.css", "background.js", "popup.html", "popup.css", "popup.js", "icons"];
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

  // Content scripts share one scope and run in listed order, so a missing or
  // renamed module is a runtime break. Catch it at build time instead.
  for (const cs of manifest.content_scripts || []) {
    for (const file of cs.js || []) {
      if (!fs.existsSync(path.join(out, file))) {
        throw new Error(target.name + " manifest lists " + file + ", which is not in the build");
      }
    }
  }

  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // Both stores take a zip of the extension directory. Shell out rather than
  // take a dependency: PowerShell ships with Windows, zip with everything else.
  const zip = path.join(DIST, target.name + "-" + manifest.version + ".zip");
  try {
    if (process.platform === "win32") {
      execFileSync("powershell", [
        "-NoProfile", "-Command",
        "Compress-Archive -Path '" + out + "\\*' -DestinationPath '" + zip + "' -Force",
      ], { stdio: "ignore" });
    } else {
      execFileSync("zip", ["-qr", zip, "."], { cwd: out });
    }
    console.log(target.name + ": " + manifest.version + " -> dist/" + target.name + " and " + path.basename(zip));
  } catch (e) {
    console.log(target.name + ": " + manifest.version + " -> dist/" + target.name + " (zip skipped: " + e.message.split("\n")[0] + ")");
  }
}
