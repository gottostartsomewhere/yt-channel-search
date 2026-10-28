/*
 * node tools/check-all.js
 *
 * Everything, in one go, before an upload: names declared twice across the
 * content scripts, the saved pages (no network), the
 * data check on live public pages, then the browser check, signed in too if the
 * check's profile is. The same checks the scheduled tasks run each morning,
 * without the notifications. Exit 1 if any part failed.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const PARTS = [
  ["names", "names-check.js"],
  ["saved pages", "fixtures-test.js"],
  ["data check", "canary.js"],
  ["browser check", "browser-check.js"],
];

let failed = 0;
const summary = [];
for (const [name, file] of PARTS) {
  const t0 = Date.now();
  console.log(`\n==== ${name} (tools/${file})`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  const ok = r.status === 0;
  if (!ok) failed++;
  summary.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${Math.round((Date.now() - t0) / 1000)}s`);
}
console.log("\n==== summary\n" + summary.join("\n"));
process.exit(failed ? 1 : 0);
