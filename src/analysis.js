/*
 * YouTube Channel Search+
 * Channel comparison, plus title, format, and series analysis.
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
    ui.cmpStatus.textContent = cat.length + " videos";
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
function section(title, node) {
  const wrap = document.createElement("div");
  wrap.className = "ytcs-section";
  const h = document.createElement("div");
  h.className = "ytcs-sectitle";
  h.textContent = title;
  wrap.appendChild(h);
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

// Median views of the videos containing each word, versus the overall median.
function keywordStats(rows, minCount) {
  const buckets = new Map();
  rows.forEach((v) => {
    new Set(tokenize(v.title)).forEach((w) => {
      if (!buckets.has(w)) buckets.set(w, []);
      buckets.get(w).push(v.views);
    });
  });
  const base = median(rows.map((v) => v.views)) || 1;
  const out = [];
  buckets.forEach((views, word) => {
    if (views.length >= minCount) {
      const m = median(views);
      out.push({ word: word, count: views.length, medViews: m, lift: m / base });
    }
  });
  return out.sort((a, b) => b.lift - a.lift);
}

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

function patternStats(rows) {
  const base = median(rows.map((v) => v.views)) || 1;
  return TITLE_PATTERNS
    .map((p) => {
      const hit = rows.filter((v) => p[1](v.title));
      const m = hit.length ? median(hit.map((v) => v.views)) : 0;
      return { name: p[0], count: hit.length, medViews: m, lift: hit.length ? m / base : 0 };
    })
    .filter((r) => r.count >= 2)
    .sort((a, b) => b.lift - a.lift);
}

function titleLengthStats(rows) {
  const buckets = [["<30", 0, 30], ["30-45", 30, 45], ["45-60", 45, 60], ["60-75", 60, 75], ["75+", 75, Infinity]];
  return buckets
    .map((b) => {
      const hit = rows.filter((v) => v.title.length >= b[1] && v.title.length < b[2]);
      return { label: b[0], value: hit.length >= 2 ? Math.round(median(hit.map((v) => v.views))) : null };
    })
    .filter((d) => d.value != null);
}

function renderTitles(rows) {
  ui.titles.innerHTML = "";
  if (rows.length < 4) {
    ui.titles.appendChild(chartEmpty());
    return;
  }
  // Require a word to appear in a small share of the catalog, so big channels
  // do not surface three-video coincidences.
  const minCount = Math.max(3, Math.round(rows.length * 0.01));
  const lenData = titleLengthStats(rows);
  const kw = keywordStats(rows, minCount).slice(0, 18);
  const pat = patternStats(rows);

  const wordsTable = kw.length
    ? dataTable(["Word", "Videos", "Median views", "Lift"], kw.map((k) => [
        k.word, String(k.count), fmtCompact(Math.round(k.medViews)), k.lift.toFixed(2) + "x",
      ]))
    : chartEmpty();
  const formatsTable = pat.length
    ? dataTable(["Format", "Videos", "Median views", "Lift"], pat.map((p) => [
        p.name, String(p.count), fmtCompact(Math.round(p.medViews)), p.lift.toFixed(2) + "x",
      ]))
    : chartEmpty();

  const cols = document.createElement("div");
  cols.className = "ytcs-tcols";
  const left = document.createElement("div");
  left.className = "ytcs-tcol";
  left.appendChild(section("Words that lift performance", wordsTable));
  const right = document.createElement("div");
  right.className = "ytcs-tcol";
  right.appendChild(section("Median views by title length", lenData.length ? barChart(lenData) : chartEmpty()));
  right.appendChild(section("Title formats", formatsTable));
  cols.appendChild(left);
  cols.appendChild(right);
  ui.titles.appendChild(cols);
}

/* ---- series detection ----------------------------------------------------
 * Plenty of channels run long-form series and never build a playlist for
 * them, which leaves the episodes scattered through hundreds of uploads.
 * Two signals recover them: an explicit episode marker in the title, and a
 * shared prefix ahead of a delimiter. Both collapse to a stem, and a stem
 * only counts as a series once enough episodes agree on it.
 */
const EPISODE_PATTERNS = [
  /\b(?:ep|episode|pt|part|day|week|chapter|lesson|round|round)\s*\.?\s*#?(\d{1,3})\b/i,
  /#(\d{1,3})\b/,
  /\b(\d{1,3})\s*(?:of|\/)\s*\d{1,3}\b/i,
];

function episodeOf(title) {
  for (const re of EPISODE_PATTERNS) {
    const m = title.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      // A bare year or a huge number is almost never an episode index.
      if (n > 0 && n < 500 && !/^(19|20)\d{2}$/.test(m[1])) {
        return { num: n, stem: title.replace(re, " ") };
      }
    }
  }
  return null;
}

function cleanStem(s) {
  return s
    .replace(/[\[(][^\])]*[\])]/g, " ")
    .replace(/[|\-–—:•·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Pulling a marker out of the middle can strand a connector at either
    // end, as in "Day 5 of building X" leaving "of building X".
    .replace(/^(?:of|the|a|an|in|on|at|to|for|and|with|my)\s+/i, "")
    .replace(/\s+(?:of|the|a|an|in|on|at|to|for|and|with|my)$/i, "")
    .trim();
}

function prefixStem(title) {
  const m = title.match(/^(.{6,60}?)\s*[|:\-–—]\s*\S/);
  return m ? cleanStem(m[1]) : null;
}

function detectSeries(rows) {
  const groups = new Map();
  const add = (stem, v, num) => {
    const key = stem.toLowerCase();
    if (key.length < 4) return;
    if (!groups.has(key)) groups.set(key, { label: stem, items: [], numbered: 0 });
    const g = groups.get(key);
    g.items.push({ v: v, num: num });
    if (num != null) g.numbered++;
  };

  rows.forEach((v) => {
    const ep = episodeOf(v.title);
    if (ep) {
      const stem = cleanStem(ep.stem);
      if (stem) { add(stem, v, ep.num); return; }
    }
    const pre = prefixStem(v.title);
    if (pre) add(pre, v, null);
  });

  const out = [];
  groups.forEach((g) => {
    if (g.items.length < 3) return;
    // Numbered series sort by episode, prefix-only series read oldest first.
    const items = g.numbered >= 2
      ? g.items.slice().sort((a, b) => (a.num || 0) - (b.num || 0))
      : g.items.slice().reverse();
    const done = items.filter((i) => watchState(i.v) === "done").length;
    out.push({
      label: g.label,
      items: items,
      count: items.length,
      numbered: g.numbered >= 2,
      done: done,
      views: median(items.map((i) => i.v.views)),
    });
  });
  return out.sort((a, b) => b.count - a.count);
}

function renderSeries(rows) {
  ui.series.innerHTML = "";
  const found = detectSeries(rows);
  if (!found.length) {
    ui.series.appendChild(emptyNote(
      "No repeating series found in these titles. This channel probably names each upload on its own."
    ));
    return;
  }

  const intro = document.createElement("p");
  intro.className = "ytcs-explain";
  intro.textContent =
    "Runs of episodes recovered from the titles, including the ones this channel never made a playlist for. " +
    "Numbered series are ordered by episode, the rest run oldest first.";
  ui.series.appendChild(intro);

  found.slice(0, 40).forEach((s) => {
    const box = document.createElement("div");
    box.className = "ytcs-series";

    const head = document.createElement("button");
    head.className = "ytcs-shead";
    const name = document.createElement("span");
    name.className = "ytcs-sname";
    name.textContent = s.label;
    const meta = document.createElement("span");
    meta.className = "ytcs-smeta";
    const bits = [s.count + " episodes"];
    if (s.done) bits.push(s.done + " watched");
    bits.push(fmtCompact(Math.round(s.views)) + " median views");
    meta.textContent = bits.join("  ·  ");
    head.appendChild(name);
    head.appendChild(meta);

    const list = document.createElement("div");
    list.className = "ytcs-slist";
    list.style.display = "none";
    s.items.forEach((it, i) => {
      const row = document.createElement("a");
      row.className = "ytcs-srow" + (watchState(it.v) === "done" ? " ytcs-seen" : "");
      row.href = "/watch?v=" + it.v.id;
      const idx = document.createElement("span");
      idx.className = "ytcs-sidx";
      idx.textContent = s.numbered && it.num != null ? String(it.num) : String(i + 1);
      const t = document.createElement("span");
      t.className = "ytcs-stitle";
      t.textContent = it.v.title;
      const d = document.createElement("span");
      d.className = "ytcs-sdur";
      d.textContent = fmtDuration(it.v.seconds);
      row.appendChild(idx);
      row.appendChild(t);
      row.appendChild(d);
      list.appendChild(row);
    });

    head.onclick = () => {
      const open = list.style.display !== "none";
      list.style.display = open ? "none" : "";
      head.classList.toggle("ytcs-sopen", !open);
    };

    box.appendChild(head);
    box.appendChild(list);
    ui.series.appendChild(box);
  });
}
