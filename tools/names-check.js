/*
 * node tools/names-check.js
 *
 * The content scripts share one scope, in the order the manifest loads them, so
 * a function declared in two files does not fail: the later one silently
 * replaces the earlier everywhere. 2.3.0 shipped mute.js with its own
 * closeMenu(), which replaced panel.js's and broke every menu in the panel. This
 * lists any top-level name declared in more than one of them. No network.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const seen = new Map();
const clashes = [];
for (const group of manifest.content_scripts.filter((c) => !c.world)) {
  for (const file of group.js) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = m[1] || m[2];
      if (seen.has(name)) clashes.push(`${name}: ${seen.get(name)} and ${file}`);
      else seen.set(name, file);
    }
  }
}
if (clashes.length) {
  console.log("FAIL  names declared in more than one content script:\n  " + clashes.join("\n  "));
  process.exit(1);
}
console.log(`PASS  ${seen.size} top-level names across the content scripts, none declared twice`);
