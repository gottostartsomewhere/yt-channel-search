/*
 * YouTube Channel Search+
 * Channel comparison, plus title and format analysis.
 *
 * Loaded as an ordered content script, so every module shares one scope.
 * See the js array in manifest.json for the order.
 */

// ---- compare channels ----------------------------------------------------
function normalizeChannelInput(input) {
  input = (input || "").trim();
  if (!input) return null;
  const m = input.match(/youtube\.com\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/i);
  if (m) return "https://www.youtube.com/" + m[1] + "/videos";
  if (input.charAt(0) === "@") return "https://www.youtube.com/" + input + "/videos";
  if (/^UC[\w-]{20,}$/.test(input)) return "https://www.youtube.com/channel/" + input + "/videos";
  if (/^[\w.-]+$/.test(input)) return "https://www.youtube.com/@" + input + "/videos";
  return null;
}
async function runCompare() {
  const raw = ui.cmpInput.value.trim();
  if (!raw) return;
  const url = normalizeChannelInput(raw);
  if (!url) { ui.cmpStatus.textContent = "couldn't parse that channel"; return; }
  ui.cmpBtn.disabled = true;
  ui.cmpStatus.textContent = "loading… 0";
  try {
    const cat = await fetchCatalogFrom(url, (n) => (ui.cmpStatus.textContent = "loading… " + n));
    ui.cmpStatus.textContent = plural(cat.length, "video");
    const label = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, "").replace(/\/.*$/, "");
    renderCompare(state.catalog, cat, label);
  } catch (e) {
    ui.cmpStatus.textContent = "error: " + e.message;
  } finally {
    ui.cmpBtn.disabled = false;
  }
}
function renderCompare(catA, catB, labelB) {
  const a = statsOf(catA), b = statsOf(catB);
  const metrics = [
    ["Videos", a.n, b.n, String(a.n), String(b.n)],
    ["Total views", a.total, b.total, fmtCompact(a.total), fmtCompact(b.total)],
    ["Median views", a.medViews, b.medViews, fmtCompact(a.medViews), fmtCompact(b.medViews)],
    ["Avg length", a.avgDur, b.avgDur, fmtDuration(a.avgDur) || "–", fmtDuration(b.avgDur) || "–"],
    ["Median views/day", a.medVpd, b.medVpd, fmtCompact(Math.round(a.medVpd)), fmtCompact(Math.round(b.medVpd))],
    ["Top views/day", a.topVpd, b.topVpd, fmtCompact(Math.round(a.topVpd)), fmtCompact(Math.round(b.topVpd))],
  ];
  const thisLabel = (channelBasePath() || "this channel").replace(/^\//, "");
  const tbl = document.createElement("table");
  tbl.className = "ytcs-cmptable";
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  ["", thisLabel, labelB].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  tbl.appendChild(thead);
  const tb = document.createElement("tbody");
  for (const row of metrics) {
    const tr = document.createElement("tr");
    const k = document.createElement("td");
    k.className = "ytcs-cmpk";
    k.textContent = row[0];
    const ta = document.createElement("td");
    ta.textContent = row[3];
    if (row[1] > row[2]) ta.className = "ytcs-win";
    const td = document.createElement("td");
    td.textContent = row[4];
    if (row[2] > row[1]) td.className = "ytcs-win";
    tr.appendChild(k);
    tr.appendChild(ta);
    tr.appendChild(td);
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  ui.cmpResult.innerHTML = "";
  ui.cmpResult.appendChild(tbl);
}

// ---- small layout helpers ------------------------------------------------
function section(title, node, note) {
  const wrap = document.createElement("div");
  wrap.className = "ytcs-section";
  const h = document.createElement("div");
  h.className = "ytcs-sectitle";
  h.textContent = title;
  wrap.appendChild(h);
  // Same reasoning as the chart notes: a heading names the table, this says
  // what it is for. Optional, so existing callers are unaffected.
  if (note) {
    const n = document.createElement("div");
    n.className = "ytcs-secnote";
    n.textContent = note;
    wrap.appendChild(n);
  }
  wrap.appendChild(node);
  return wrap;
}

function dataTable(headers, rows) {
  const t = document.createElement("table");
  t.className = "ytcs-dtable";
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  t.appendChild(thead);
  const tb = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    r.forEach((cell, i) => {
      const td = document.createElement("td");
      td.textContent = cell;
      if (i === 0) td.className = "ytcs-dk";
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}

function emptyNote(msg) {
  const d = document.createElement("div");
  d.className = "ytcs-emptybox";
  d.textContent = msg;
  return d;
}

// ---- title and format analysis -------------------------------------------
const STOPWORDS = new Set((
  "the a an and or but of to in on for with at by from up about into over after " +
  "is are was were be been being do does did doing have has had this that these " +
  "those it its you your my our their his her they them we he she who what why " +
  "when where which how all any can will just not no yes more most out " +
  "one two new now than then there here another every each " +
  // common verbs and filler that co-occur with anything
  "get gets got getting make makes made making go goes going gone let lets " +
  "like want wants need needs know think see saw look looks watch watching " +
  "off again really very still even back away only also too way ways thing " +
  "things stuff day days time today first last next " +
  // contractions, after the apostrophe is stripped
  "dont doesnt didnt wasnt werent isnt arent wont wouldnt couldnt shouldnt " +
  "hasnt havent hadnt cant youre theyre weve ive im id ill hes shes thats " +
  "whats theres heres wheres whos gonna wanna gotta aint"
).split(/\s+/));

function tokenize(title) {
  return String(title)
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/*
 * There used to be a "words that lift performance" table here, ranking every
 * word in the catalogue by the median views of the videos containing it.
 *
 * It was removed rather than tuned, because no threshold saves it. Ranking
 * hundreds of words by three-video samples guarantees that whichever words
 * happened to land on hits float to the top, and raising the floor only trades
 * that for a shorter list of the same coincidences. The deeper problem is that
 * a word does not cause views, its subject does: "zombies" was not lifting
 * anything, it was marking the videos about zombies, which that audience
 * already wanted. There is no move on the other end of the finding, because
 * you cannot put "zombies" in a title about phones.
 *
 * Formats survived the same audit. Eight categories fixed in advance is eight
 * hypotheses, not a dredge through the corpus, and "does a question in the
 * title help" is a change someone can actually make and test.
 *
 * tokenize and STOPWORDS stay: the watchlist still uses them for content gaps,
 * which only claims a topic is present in one catalogue and absent from
 * another. That is an observation about coverage, not a causal claim.
 */
const TITLE_PATTERNS = [
  ["Question", (t) => /\?/.test(t)],
  ["Versus / comparison", (t) => /\bvs\.?\b|\bversus\b/i.test(t)],
  ["Numbered or list", (t) => /^\s*\d+\b|\btop\s+\d+\b|\b\d+\s+(things|ways|tips|reasons|rules)\b/i.test(t)],
  ["Bracketed tag", (t) => /\[[^\]]+\]|\([^)]+\)/.test(t)],
  ["First person", (t) => /\b(i|my|me|we)\b/i.test(t)],
  ["All-caps word", (t) => (String(t).match(/\b[A-Z]{4,}\b/g) || []).some((w) => !/^[IVXLCDM]+$/.test(w))],
  ["Superlative", (t) => /\b(best|worst|ultimate|greatest|craziest|insane)\b/i.test(t)],
  ["How to", (t) => /\bhow to\b/i.test(t)],
];

/*
 * A format has to cover a real share of the catalogue before it is allowed a
 * row. Two videos was enough before, which is how "Question, 4 videos, 1.88x"
 * became a line item on a 236-video channel.
 */
function patternStats(rows) {
  const base = median(rows.map((v) => v.views)) || 1;
  const floor = Math.max(5, Math.round(rows.length * 0.03));
  return TITLE_PATTERNS
    .map((p) => {
      const hit = rows.filter((v) => p[1](v.title));
      const m = hit.length ? median(hit.map((v) => v.views)) : 0;
      return { name: p[0], count: hit.length, medViews: m, lift: hit.length ? m / base : 0 };
    })
    .filter((r) => r.count >= floor)
    .sort((a, b) => b.lift - a.lift);
}

function renderFormats(rows) {
  const floor = Math.max(5, Math.round(rows.length * 0.03));
  const pat = patternStats(rows);
  if (!pat.length) {
    return section(
      "Title formats",
      emptyNote("No title format appears in enough of this catalogue to compare. " +
        "A format needs " + floor + " videos before it gets a row.")
    );
  }
  return section(
    "Title formats",
    dataTable(["Format", "Videos", "Median views", "Lift"], pat.map((p) => [
      p.name, String(p.count), fmtCompact(Math.round(p.medViews)), p.lift.toFixed(2) + "x",
    ])),
    "Lift is each format's median against the channel's own median, so it " +
    "compares this channel to itself rather than to anyone else. It shows which " +
    "framings this audience has responded to, not which ones caused the response."
  );
}
