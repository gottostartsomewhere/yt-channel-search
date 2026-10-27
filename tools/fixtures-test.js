/*
 * node tools/fixtures-test.js
 *
 * Runs Needle's readers over every YouTube page the daily check has saved in
 * tools/fixtures/, one file per page kind per day the shape changed. YouTube
 * serves old and new layouts side by side for months, so a fix for today's
 * shape has to keep reading the old ones too. Run it before every release, and
 * after any change to how Needle reads a page. No network: it only reads files.
 */
const fs = require("fs");
const path = require("path");
const { loadCore } = require("./yt-harness");
const { CHECKS, judge } = require("./canary");

const DIR = path.join(__dirname, "fixtures");
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort() : [];
if (!files.length) {
  console.log("No fixtures yet. The daily check saves one per page kind on its first run.");
  process.exit(0);
}

const core = loadCore();
let failed = 0, skipped = 0;
for (const f of files) {
  const key = f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, "");
  const check = CHECKS.find((c) => c.key === key);
  if (!check) { console.log(`SKIP  ${f}: no check called "${key}"`); skipped++; continue; }
  let line;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    // Before 27 October the daily check could save an empty page YouTube sent by mistake.
    if (!data || !Object.keys(data).length) { console.log(`SKIP  ${f}: empty page, nothing to read`); skipped++; continue; }
    const { videos, problems } = judge(check.parse(core, data), check.fixtureMin, check.fields);
    line = problems.length ? `FAIL  ${f}: ${problems.join("; ")}` : `PASS  ${f}: ${videos.length} videos`;
    if (problems.length) failed++;
  } catch (e) {
    line = `FAIL  ${f}: threw ${e.message}`;
    failed++;
  }
  console.log(line);
}
console.log(`\n${files.length - skipped - failed} of ${files.length - skipped} saved pages read correctly`);
process.exit(failed ? 1 : 0);
