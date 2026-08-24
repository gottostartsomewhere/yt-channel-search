/*
 * Exercises the shorts parser against a real captured payload.
 *
 *   node test-shorts.js
 *
 * src/core.js is a browser content script, so it runs here inside a vm with the
 * handful of globals it touches stubbed out. Cheaper than splitting the parsers
 * into their own module, and it keeps the extension dependency-free.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const sandbox = {
  location: { origin: "https://www.youtube.com", pathname: "/@SceneCityOfficial/shorts" },
  navigator: { userAgent: "node" },
  console: console,
  setTimeout: setTimeout,
  setInterval: function () { return 0; },
  chrome: { runtime: { id: "test", sendMessage: function () {} } },
  fetch: function () { throw new Error("tests do not hit the network"); },
  document: { addEventListener: function () {}, createElement: function () { return {}; } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "src", "core.js"), "utf8"), sandbox, { filename: "core.js" });

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "shorts-sample.json"), "utf8"));
const grid = fixture.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer;
const parsed = sandbox.parseItemArray(grid.contents);
const videos = parsed.videos;

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    (ok ? "ok   " : "FAIL ") + label +
    "  got " + JSON.stringify(actual) + (ok ? "" : ", want " + JSON.stringify(expected))
  );
}

check("videos parsed", videos.length, 3);
check("continuation token read", typeof parsed.token === "string" && parsed.token.length > 0, true);
check("id from reelWatchEndpoint", videos[0].id, "epBNXKvop4Q");
check("id from entityId fallback", videos[2].id, "pJsPE_r4SJo");
check("title", videos[1].title, "my arachnophobia just kicked in 🫣🕷️ #spidernoir #shorts");
check("views 4.8k", videos[0].views, 4800);
check("views 20k", videos[1].views, 20000);
check("views 127k", videos[2].views, 127000);
check("flagged as short", videos[0].isShort, true);
check("no duration available", videos[0].seconds, 0);
check("no upload age available", videos[0].days, 0);

// The rounding filter has to treat shorts exactly like long-form: a 127k lockup
// moves in steps of 10,000, so a one-step jump is not a measurement.
check("rounding step at 127k", sandbox.roundingStep(127000), 10000);
check("one step is not real growth", sandbox.beyondRounding(10000, 127000), false);
check("three steps is", sandbox.beyondRounding(30000, 127000), true);

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);
