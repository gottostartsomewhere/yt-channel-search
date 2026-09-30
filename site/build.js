// node site/build.js
// Writes the site into site/public/. A home page, plus one guide per thing
// people actually type into Google ("search watch later", "search youtube
// history"...), each answering it honestly, YouTube's own way first.
const fs = require("fs");
const path = require("path");

const BASE = "https://gottostartsomewhere.github.io/needle/";
const UPDATED = "2026-09-30";
const UPDATED_TEXT = "30 September 2026";
const STORE = "https://chromewebstore.google.com/detail/needle-for-youtube-channe/magofcbhfhpfabphcldhodhgehhclokc";
const REPO = "https://github.com/gottostartsomewhere/yt-channel-search";
const PRIVACY = REPO + "/blob/main/PRIVACY.md";
const WALKTHROUGH = ""; // the full walkthrough on YouTube; the button hides while this is empty
const GOOGLE_VERIFY = "wJhPw44jUD5iJfyrFXwTOOI03u5a8x-EcJHtOchnTqI"; // Search Console's HTML-tag code, just the content="..." value
const OUT = path.join(__dirname, "public");

// UTM on every store link, so the listing's Analytics says which page sent who.
const store = (slug) => `${STORE}?utm_source=needle-site&utm_medium=web&utm_campaign=${slug || "home"}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const o = (s) => `<code class="op">${esc(s)}</code>`;
const ARROW = `<svg class="arr" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const eyebrow = (n, label) => `<p class="eyebrow">${n ? `<span>${n}</span><i>·</i>` : ""}${esc(label)}</p>`;

const MARK = (size, id) => `<svg class="mark" viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true"><g transform="translate(64 64) scale(0.93) translate(-78 -66.4)"><mask id="${id}"><rect width="128" height="128" fill="#000"/><path d="M45 30 L45 98 L101 64 Z" fill="#fff" stroke="#fff" stroke-width="13" stroke-linejoin="round"/><path d="M40 118 L110.9 33.2 Q119 30.4 117.1 38.8 Z" fill="#000" stroke="#000" stroke-width="9" stroke-linejoin="round"/></mask><rect width="128" height="128" fill="currentColor" mask="url(#${id})"/><path d="M40 118 L110.9 33.2 Q119 30.4 117.1 38.8 Z" fill="currentColor"/><path d="M108.2 42.5 C104 22 86 12 77 20 C70 26 78 34.5 86 27.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></g></svg>`;

const figure = (src, w, h, alt, caption) =>
  `<figure><img src="${src}" width="${w}" height="${h}" alt="${esc(alt)}" loading="lazy" decoding="async">${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;

const opsTable = (rows) =>
  `<table class="ops"><tbody>${rows.map(([k, v]) => `<tr><td>${o(k)}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const closer = (slug, line) => `
<section class="band band-close">
  <div class="wrap center">
    <h2 class="closer">${line}<span class="red">.</span></h2>
    <a class="btn" href="${store(slug)}">Add to Chrome ${ARROW}</a>
    <p class="mono small">Free. No account. Nothing leaves your browser.</p>
  </div>
</section>`;

// ---------------------------------------------------------------------------
// the guides

const LABELS = {
  why: "The problem", "ctrl-f": "The workaround", needle: "With Needle", filters: "Filters", faq: "Questions",
  youtube: "On YouTube", "my-activity": "My Activity", popular: "Most viewed", missing: "The gap",
};

const GUIDES = [
  {
    slug: "search-watch-later",
    tag: "Watch Later",
    card: "Search your Watch Later",
    blurb: "YouTube has no search box for it. The workaround, and the proper fix.",
    title: "How to search your YouTube Watch Later list",
    h1: "How to search your YouTube Watch Later",
    description: "YouTube has no search box for Watch Later, and Ctrl+F only sees what's loaded. How to search the whole list and filter it by length, views and channel.",
    answer: `YouTube has no search box for Watch Later. The search bar at the top searches all of YouTube, and Ctrl+F only finds the videos the page has already loaded. To search the whole list, and filter it by length, views or channel, you need an extension that reads the list first. <a href="${store("search-watch-later")}">Needle</a> does this for free, inside YouTube.`,
    faq: [
      ["Can you search Watch Later in the YouTube app?", "Not in the app, and not with Needle either. Needle is for YouTube in a desktop browser: Chrome, or another browser that installs extensions from the Chrome Web Store."],
      ["Does this work for Liked videos too?", "Yes. The same panel opens on your Liked videos page, and in:liked searches them from the search bar."],
      ["Is my Watch Later sent anywhere?", "No. Needle has no server. It reads the list from youtube.com with the session you're already signed in with, keeps it on your device, and never sends it anywhere."],
      ["Is it free?", "Yes. No account, no trial, no paid tier."],
    ],
    body: () => `
<h2 id="why">Why YouTube won't search it for you</h2>
<p>Watch Later is a playlist, and YouTube doesn't let you search inside playlists. You can reorder it, but there's no search box and no filters. The big search bar at the top doesn't help either: type into it and you're searching all of YouTube, not your list.</p>
<p>It gets worse as the list grows. The page loads your first 100 videos and fetches the rest in batches as you scroll, so anything further down isn't on the page yet and nothing can find it.</p>

<h2 id="ctrl-f">The quick fix: Ctrl+F</h2>
<ol class="steps">
  <li>Open your Watch Later at <a href="https://www.youtube.com/playlist?list=WL">youtube.com/playlist?list=WL</a>.</li>
  <li>Scroll to the bottom and keep going until no more videos load. Long lists take a while.</li>
  <li>Press <kbd>Ctrl</kbd>+<kbd>F</kbd> (<kbd>Cmd</kbd>+<kbd>F</kbd> on a Mac) and type a word from the title or the channel name.</li>
</ol>
<p>It works, but only on words. You can't ask for the videos under 20 minutes, or the ones you haven't started, and you have to scroll the whole list in again every time.</p>

<h2 id="needle">Search and filter the whole list with Needle</h2>
<p>Needle is a free Chrome extension that reads your Watch Later and lets you search it two ways.</p>

<h3>From YouTube's search bar</h3>
<p>Start typing anywhere on YouTube. Matches from your Watch Later show up under <em>In your Watch Later</em>, above YouTube's usual suggestions, with each video's length and whether you've started it.</p>
<p>Add ${o("in:wl")} to search only Watch Later. ${o("in:wl cooking <20m")} finds the cooking videos you saved that are under 20 minutes.</p>

<h3>On the Watch Later page</h3>
<ol class="steps">
  <li>Open your Watch Later.</li>
  <li>Press the needle button in the bottom right corner, or <kbd>Alt</kbd>+<kbd>Y</kbd>.</li>
  <li>Type to search, or add a filter: Length, Views, Date, Watched, or Free time, which shows only what fits in the minutes you have.</li>
</ol>
${figure("../img/wl.webp", 1195, 540, "Needle's panel on a Watch Later page, searching for the word last and finding one match out of 100 videos", "One word, one match, out of the first 100. Filtering is instant because the list is already in your browser.")}

<h3>Lists longer than 100 videos</h3>
<p>Out of the box Needle reads the first 100 videos, same as the page. For longer lists, open the Needle popup and turn on <strong>Deep reading</strong>. It reads the rest of the list the way YouTube's own page does when you scroll, and what it reads stays on your device. The <a href="${PRIVACY}">privacy policy</a> explains exactly how.</p>

<h2 id="filters">Filters that work on Watch Later</h2>
${opsTable([
  ["<20m", "Shorter than 20 minutes"],
  [">45m", "Longer than 45 minutes"],
  [">100k", "More than 100K views"],
  ["unwatched", "Never started"],
  ["is:started", "Started, not finished"],
  ["@name", "From that channel"],
  ["-word", "Leave out anything mentioning it"],
  ["sort:shortest", "Shortest first (also longest, views, newest, oldest)"],
])}
<p>They combine, so ${o("in:wl unwatched <15m")} is the answer to "what can I watch on my break".</p>`,
  },

  {
    slug: "search-watch-history",
    tag: "Watch history",
    card: "Search your watch history",
    blurb: "By channel, length or the week you watched it, not just the title.",
    title: "Search your YouTube watch history by channel, length or date",
    h1: "How to search your YouTube watch history",
    description: "YouTube's history search only takes words. Find a video you watched by channel, length or when you watched it, with YouTube, My Activity and Needle.",
    answer: `On a computer, open <a href="https://www.youtube.com/feed/history">youtube.com/feed/history</a> and use the <em>Search watch history</em> box. It finds videos you've watched by the words in them. It can't filter by channel, length or date, so for "that 20 minute video from last month" you need Google's My Activity, or <a href="${store("search-watch-history")}">Needle</a>, which adds those filters and shows your history right in YouTube's search bar.`,
    faq: [
      ["Why can't I find a video I know I watched?", "Usually one of three things: you watched it signed out or in an incognito window, your history was paused at the time, or auto-delete has removed it. If none of those fit, it may be further back than what's been read, so turn on Deep reading."],
      ["Does Needle keep a copy of my history?", "Only on your device, in the browser's own storage, so searching it is instant. It never leaves your computer, and Clear cached data in the popup wipes it."],
      ["Does it change my history?", "No. Needle only reads. It never adds, removes or pauses anything in your YouTube account."],
      ["Is it free?", "Yes. No account, no trial, no paid tier."],
    ],
    body: () => `
<h2 id="youtube">Search your history on YouTube</h2>
<ol class="steps">
  <li>Go to <a href="https://www.youtube.com/feed/history">youtube.com/feed/history</a>, or History in the left menu.</li>
  <li>Find the <em>Search watch history</em> box.</li>
  <li>Type a word you remember from the title.</li>
</ol>
<p>Good when you remember the title. Less good when you remember it was about twenty minutes long, from a channel you'd never heard of, sometime in August. The box takes words and nothing else.</p>

<h2 id="my-activity">Filter by date with Google My Activity</h2>
<p>Google keeps the same history with dates attached. Open <a href="https://myactivity.google.com/product/youtube">myactivity.google.com/product/youtube</a> and use <em>Filter by date</em> to narrow it to a day or a range. You can search by keyword there too. It's slow to scroll, though, and it doesn't know how long a video is or whether you finished it.</p>

<h2 id="needle">Search it by channel, length and date with Needle</h2>
<p>Needle reads your history into your browser and makes it searchable the way you actually remember videos.</p>

<h3>From the search bar</h3>
<p>Type anything on YouTube and videos you've watched appear under <em>You watched</em>, with when you watched them and how far you got. Close spellings still match, so half a title is usually enough.</p>
${figure("../img/type-drop.webp", 682, 305, "YouTube's search dropdown with Needle's sections: two videos in Watch Later and two already watched, one of them 21 percent watched", "Typing “last”. Two saved in Watch Later, two already watched, one of them only 21% of the way through.")}
<p>Add filters as you go:</p>
${opsTable([
  ["in:history @veritasium", "Everything you've watched from Veritasium"],
  ["watched:august <20m", "Short videos you watched in August"],
  ["in:history is:started", "Things you started and never finished"],
  ["watched:yesterday", "Also today, week, last-week, month, or a month like 2026-08"],
])}

<h3>On the History page</h3>
<p>Press the needle button in the bottom right corner of your History page, or <kbd>Alt</kbd>+<kbd>Y</kbd>, for the full panel: filter by channel, length, views or when you watched it, and sort any way you like.</p>

<h3>Going further back</h3>
<p>Needle reads the first page of your history by default. Turn on <strong>Deep reading</strong> in the popup to go further. In one test it read 1,464 videos going back 68 days, and still hadn't run out. The <a href="${PRIVACY}">privacy policy</a> explains how it works.</p>`,
  },

  {
    slug: "search-youtube-channel",
    tag: "Channels",
    card: "Search every video on a channel",
    blurb: "Filter a whole channel by length, views and what you haven't finished.",
    title: "Search every video on a YouTube channel by length and views",
    h1: "How to search every video on a YouTube channel",
    description: "Search inside any YouTube channel, sort it by most viewed, and filter every upload by length, view count, date and what you haven't finished.",
    answer: `Open the channel and click the magnifying glass next to its tabs to search it by keyword. For its most viewed videos, open the Videos tab and pick <em>Popular</em>. YouTube can't filter a channel by length or view count, or hide what you've already watched. <a href="${store("search-youtube-channel")}">Needle</a>, a free Chrome extension, reads every upload on the channel and filters them however you like.`,
    faq: [
      ["How many videos can it read?", "The whole channel, up to the Video limit in the popup, which you can raise for very large channels. A few hundred videos take a few seconds, and after that the channel is cached and opens instantly."],
      ["Does it include Shorts?", "Shorts are kept out of the main list, since YouTube doesn't give them a length or upload date to filter on."],
      ["Does it use the YouTube API?", "No. It reads the same pages your browser already loads from youtube.com, so there's no API key and no quota to run out of."],
      ["Is it free?", "Yes. No account, no trial, no paid tier."],
    ],
    body: () => `
<h2 id="youtube">Search inside a channel on YouTube</h2>
<ol class="steps">
  <li>Open the channel.</li>
  <li>Click the magnifying glass at the end of the tab row, after Home, Videos, Shorts and the rest.</li>
  <li>Type a keyword and press Enter.</li>
</ol>
<p>You get the channel's videos that match the word, in YouTube's order. No sorting and no filters.</p>

<h2 id="popular">Sort a channel by most viewed</h2>
<p>On the Videos tab, the chips above the grid switch between <em>Latest</em>, <em>Popular</em> and <em>Oldest</em>. Popular is the closest YouTube gets to a "best of". On a big channel it tends to be a wall of old hits, and you can't combine it with anything else.</p>

<h2 id="needle">Filter the whole channel with Needle</h2>
<ol class="steps">
  <li>Open the channel's Videos tab.</li>
  <li>Press the needle button in the bottom right corner, or <kbd>Alt</kbd>+<kbd>Y</kbd>.</li>
  <li>Needle reads every upload, not only the ones on screen.</li>
  <li>Filter by Length, Views, Date and Watched, type a keyword, or sort by views, length or date.</li>
</ol>
${figure("../img/channel.webp", 1156, 560, "Needle's panel on the MrBeast Gaming channel, filtered to 12 of 180 videos", "180 videos cut to 12: four to twenty minutes long, not finished, fits in 45 minutes, title contains “last”.")}

<h3>What you can do that YouTube can't</h3>
<ul class="list">
  <li>Hide everything you've already finished, or find the ones you gave up on halfway.</li>
  <li><strong>Free time:</strong> say you have 45 minutes and see only what fits.</li>
  <li>Exact ranges: under 12 minutes, over a million views, uploaded before 2020.</li>
  <li><strong>Insights:</strong> which video lengths do best on this channel, and two channels side by side.</li>
  <li>Export the list as CSV or JSON.</li>
</ul>
<p>The same filters work from the search bar: ${o("@veritasium >1m views <15m")} is every Veritasium video under 15 minutes with over a million views. Turn on <em>Index channels you watch</em> in the popup and ${o("in:channels")} searches the full catalogues of the channels you actually watch.</p>`,
  },

  {
    slug: "youtube-search-filters",
    tag: "Search filters",
    card: "Filter search by views and exact length",
    blurb: "The filters YouTube's Filters button doesn't have, typed into the search bar.",
    title: "Filter YouTube search by view count and exact length",
    h1: "How to filter YouTube search by views and exact length",
    description: "YouTube's Filters menu has three length buckets and no view count filter. How to filter search results by exact length, view count and what you haven't watched.",
    answer: `YouTube's Filters button offers three length buckets (under 3 minutes, 3 to 20, over 20), an upload date, and a Popularity sort. There's no view count filter and no exact length. With <a href="${store("youtube-search-filters")}">Needle</a>, a free Chrome extension, you type them into the search bar instead: ${o("<12m")}, ${o(">100k")}, ${o("unwatched")}.`,
    faq: [
      ["Did YouTube remove sort by view count?", "Yes. The old view count sort became Popularity, which weighs things like watch time as well as views. In Needle, >100k filters by the actual view count, and sort:views sorts by it."],
      ["Does YouTube see my filters?", "Only the ones it has itself, like upload date. Needle takes the rest out of the query before YouTube sees it, so <12m never turns into a search for “<12m”."],
      ["Does it work on my phone?", "No. Needle is for YouTube in a desktop browser: Chrome, or another browser that installs extensions from the Chrome Web Store."],
      ["Is it free?", "Yes. No account, no trial, no paid tier."],
    ],
    body: () => `
<h2 id="youtube">What YouTube's Filters menu can do</h2>
<p>Search for something, then click <em>Filters</em> above the results. You get:</p>
<ul class="list">
  <li><strong>Upload date:</strong> today, this week, this month, this year.</li>
  <li><strong>Type:</strong> videos, channels, playlists and a few more.</li>
  <li><strong>Duration:</strong> under 3 minutes, 3 to 20 minutes, over 20 minutes.</li>
  <li><strong>Features:</strong> live, 4K, HD, subtitles, Creative Commons, 360, VR180, 3D, HDR.</li>
  <li><strong>Prioritize:</strong> relevance or popularity.</li>
</ul>
<p>YouTube has also started showing Watched and Unwatched chips on some results pages.</p>

<h2 id="missing">What it can't do</h2>
<ul class="list">
  <li><strong>View counts.</strong> Popularity isn't view count, and there's no way to say "only videos over 100K views".</li>
  <li><strong>Exact lengths.</strong> Three buckets, that's it. A 10 minute limit isn't possible.</li>
  <li><strong>Leaving a channel out.</strong> If one creator floods every search, you can't mute them.</li>
</ul>

<h2 id="needle">Type your filters with Needle</h2>
<p>Needle lets you write filters straight into YouTube's search bar. Press Enter and anything YouTube can do itself, like ${o("date:week")} or ${o("is:4k")}, goes to YouTube as its own filter. The rest, like exact lengths and view counts, is applied to the results in Needle's panel. When a strict filter leaves too few, <em>Load more</em> keeps reading further down YouTube's results.</p>
${figure("../img/filters.webp", 1406, 620, "Needle's panel on a YouTube search for C++, filtered to over 20 minutes and over 100K views, 130 of 207 results", "C++ tutorials over 20 minutes with more than 100K views: 130 of the first 207 results.")}

<h3>Every filter</h3>
${opsTable([
  ["<20m", "Shorter than 20 minutes (also >45m, <1h, >90s)"],
  [">100k", "More than 100K views (also <5k, >1m views)"],
  ["unwatched", "Never started (is:started for half watched, is:watched for done)"],
  ["is:fresh", "Nothing you were shown in an earlier search"],
  ["date:week", "Uploaded this week (also today, month, year)"],
  ["after:2023", "Uploaded after 2023 (before: works too, with a year, month or day)"],
  ["@name", "Only from that channel"],
  ["-@name", "Never from that channel"],
  ["-word", "Leave out anything mentioning it"],
  ["sort:views", "Most viewed first (also newest, oldest, longest, shortest)"],
  ["lang:en", "Titles in English"],
  ["is:4k", "YouTube's own feature filters: also is:live, is:hd, has:subtitles, is:creative-commons"],
])}

<h3>Try these</h3>
<ul class="list">
  <li>${o("python tutorial <30m >100k")} proper tutorials that aren't three hours long.</li>
  <li>${o("lofi is:fresh")} only results you haven't already scrolled past.</li>
  <li>${o("phone review -@mkbhd")} for when one channel fills the whole page.</li>
  <li>${o("recipe date:month unwatched")} new this month, and not something you've seen.</li>
</ul>`,
  },
];

// History leads: the least contested search, and the thing nobody else does in the search bar.
const ORDER = ["search-watch-history", "search-watch-later", "search-youtube-channel", "youtube-search-filters"];
GUIDES.sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));

// ---------------------------------------------------------------------------
// page shell

function shell({ slug, title, description, body, jsonld, depth, robots }) {
  const root = depth ? "../" : "./";
  const url = BASE + (slug ? slug + "/" : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${GOOGLE_VERIFY && !slug && !robots ? `\n<meta name="google-site-verification" content="${GOOGLE_VERIFY}">` : ""}
<meta name="description" content="${esc(description)}">
${robots ? `<meta name="robots" content="${robots}">` : `<link rel="canonical" href="${url}">`}
<meta property="og:type" content="${slug ? "article" : "website"}">
<meta property="og:site_name" content="Needle for YouTube">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE}img/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#000000">
<link rel="icon" href="${root}needle.svg" type="image/svg+xml">
<link rel="icon" href="${root}icon128.png" sizes="128x128" type="image/png">
<link rel="apple-touch-icon" href="${root}icon128.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap">
<link rel="stylesheet" href="${root}style.css">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="logo" href="${root}" aria-label="Needle for YouTube, home">${MARK(28, "m-top")}<span class="word">Needle</span><span class="sep" aria-hidden="true"></span><span class="logo-sub">For YouTube</span></a>
    <nav>
      <a class="navlink" href="${root}#guides">Guides</a>
      <a class="btn-line btn-sm" href="${store(slug)}">Add to Chrome</a>
    </nav>
  </div>
</header>
${body}
<footer class="foot">
  <div class="foot-in">
    <a class="logo" href="${root}" aria-label="Needle for YouTube, home">${MARK(26, "m-foot")}<span class="word">Needle</span></a>
    <nav>
      <a href="${root}#guides">Guides</a>
      <a href="${PRIVACY}">Privacy</a>
      <a href="${REPO}">Source</a>
      <a href="${store(slug)}">Chrome Web Store</a>
    </nav>
  </div>
  <p class="foot-note">Not affiliated with YouTube or Google.</p>
</footer>
</body>
</html>
`;
}

function guidePage(g, i) {
  const others = GUIDES.filter((x) => x !== g);
  let n = 0;
  const bodyHtml = g.body().replace(/<h2 id="([^"]+)">/g, (m, id) => `${eyebrow(String(++n).padStart(2, "0"), LABELS[id] || id)}\n<h2 id="${id}">`);
  const faqHtml = g.faq.map(([q, a]) => `<div class="qa"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join("\n");
  const body = `
<main>
  <section class="band band-article">
    <article class="article">
      ${eyebrow("Guide " + String(i + 1).padStart(2, "0"), g.tag)}
      <h1>${esc(g.h1)}<span class="red">.</span></h1>
      <p class="mono small">Updated ${UPDATED_TEXT}</p>
      <section class="answer" aria-label="Short answer">
        <p class="eyebrow"><span>Short answer</span></p>
        <p>${g.answer}</p>
      </section>
      ${bodyHtml}
      ${eyebrow(String(++n).padStart(2, "0"), LABELS.faq)}
      <h2 id="faq">Questions<span class="red">?</span></h2>
      <div class="faq">${faqHtml}</div>
    </article>
  </section>
  ${closer(g.slug, "Start searching")}
  <section class="band band-alt">
    <div class="wrap">
      ${eyebrow("", "More guides")}
      <div class="cards cards-3">
        ${others.map((x) => `<a class="card card-link" href="../${x.slug}/"><p class="eyebrow eyebrow-grey"><span>${esc(x.tag)}</span></p><h3>${esc(x.card)}</h3><p class="mono">${esc(x.blurb)}</p><span class="go">Read ${ARROW}</span></a>`).join("\n        ")}
      </div>
    </div>
  </section>
</main>`;
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Article", headline: g.h1, description: g.description, dateModified: UPDATED, datePublished: UPDATED, image: BASE + "img/og.jpg", mainEntityOfPage: BASE + g.slug + "/", publisher: { "@type": "Organization", name: "Needle for YouTube", logo: { "@type": "ImageObject", url: BASE + "icon128.png" } } },
      { "@type": "FAQPage", mainEntity: g.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Needle", item: BASE },
        { "@type": "ListItem", position: 2, name: g.card, item: BASE + g.slug + "/" },
      ] },
    ],
  };
  return shell({ slug: g.slug, title: g.title, description: g.description, body, jsonld, depth: 1 });
}

// The haystack behind the hero: rows of blank video cards, the same one the trailer opens on.
function haystack() {
  let cards = "";
  for (let r = 0; r < 7; r++) for (let c = 0; c < 9; c++) {
    const s = Math.sin((r + 1) * 12.9898 + (c + 1) * 78.233) * 43758.5453;
    cards += `<div class="hay-card" style="left:${c * 196}px;top:${r * 162}px;opacity:${(0.35 + 0.65 * (s - Math.floor(s))).toFixed(2)}"><div></div><i></i><b></b></div>`;
  }
  return `<div class="hay" aria-hidden="true"><div class="hay-plane">${cards}</div></div>`;
}

function homePage() {
  const gaps = [
    ["History", "You watched it last week, but what was it called", "Type what you remember. Videos you've watched show up right in the search bar, with when you watched them and how far you got.", "search-watch-history/"],
    ["Watch Later", "Saved it months ago, can't find it now", "YouTube has no search box for Watch Later. Needle searches the whole list by title, channel, length and views.", "search-watch-later/"],
    ["Channels", "Nine hundred uploads, and you want the good twenty-minute ones", "Needle reads every video on the channel, then filters by length, views, date and what you haven't finished.", "search-youtube-channel/"],
    ["Search", "Only videos over 100K views, and under 12 minutes", "YouTube's filters stop at three length buckets and have no view counts. Type <12m >100k and that's exactly what you get.", "youtube-search-filters/"],
  ];
  const queries = [
    ["in:wl cooking <20m", "Saved cooking videos under 20 minutes"],
    ["watched:august @veritasium", "That Veritasium video from August"],
    ["python tutorial >100k unwatched", "Popular tutorials you haven't seen yet"],
  ];
  const grammar = [
    ["<20m", "Shorter than 20 minutes"],
    [">100k", "More than 100K views"],
    ["unwatched", "Never started"],
    ["is:fresh", "Nothing you were shown before"],
    ["date:week", "Uploaded this week"],
    ["watched:august", "What you watched in August"],
    ["in:wl", "Only your Watch Later"],
    ["in:channels", "Every video from channels you watch"],
    ["@name", "From that channel"],
    ["-@name", "Never from that channel"],
    ["lang:en", "Titles in English"],
    ["is:4k", "YouTube's own filters, also is:live"],
  ];
  const body = `
<main>
  <section class="hero">
    ${haystack()}
    <div class="hero-shade" aria-hidden="true"></div>
    <div class="wrap hero-in">
      <div class="hero-copy">
        ${eyebrow("", "Nothing left to scroll")}
        <h1>Search it.<br>Filter it.<br><span class="red">Find it.</span></h1>
        <p class="promise"><strong>Free</strong> and nothing leaves your browser.</p>
        <p class="lede">The YouTube search that knows what you've watched. Your history, Watch Later and likes show up in YouTube's own search bar, with the filters YouTube leaves out: exact lengths, view counts, and only what you haven't seen.</p>
        <div class="stack">
          <a class="btn btn-wide" href="${store()}">Add to Chrome ${ARROW}</a>
          <a class="btn-line btn-wide" href="#tour">Take the tour ${ARROW}</a>
          <a class="btn-line btn-wide btn-red-line" href="search-watch-history/"><span class="new">New</span>Search your watch history ${ARROW}</a>
        </div>
      </div>
      <div class="found" aria-hidden="true">
        <div class="found-card">
          <div class="bar">${SEARCH_ICON}<span>last</span><i></i></div>
          <img src="img/type-drop.webp" width="682" height="305" alt="">
        </div>
        <svg class="needle" viewBox="0 0 200 200" width="200" height="200">
          <defs><linearGradient id="ndl" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#c23540"/><stop offset="0.6" stop-color="#e5484d"/><stop offset="1" stop-color="#ff8084"/></linearGradient></defs>
          <path d="M252 -30 C 220 -2, 196 18, 170 40" fill="none" stroke="#e5484d" stroke-width="2.6" stroke-linecap="round"/>
          <g transform="translate(172 36) scale(1.9)">
            <path d="M-73.5 82 L-2.6 -2.8 Q5.5 -5.6 3.6 2.8 Z" fill="url(#ndl)"/>
            <path d="M-9.8 8.6 L-4.8 3.2" stroke="#0a0a0b" stroke-width="2.2" stroke-linecap="round"/>
            <path d="M-66 71 L-5 1.5" stroke="#fff" stroke-opacity="0.4" stroke-width="1" stroke-linecap="round"/>
          </g>
        </svg>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      ${eyebrow("01", "The gap")}
      <h2>Sound <span class="red">familiar?</span></h2>
      <div class="gaps">
        ${gaps.map(([tag, q, a, href], i) => `<div class="gap"><span class="num">0${i + 1}</span><div><p class="eyebrow eyebrow-grey"><span>${esc(tag)}</span></p><h3>${esc(q)}<span class="red">?</span></h3><p class="chev">${esc(a)}</p><a class="more-link" href="${href}">How to do it ${ARROW}</a></div></div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="band band-alt">
    <div class="wrap">
      ${eyebrow("02", "The fix")}
      <h2 class="strike"><s>Not another Watch Later cleaner.</s><br><s>Not another hide-watched button.</s><br><span class="red">Built to find the one video you're thinking of.</span></h2>
      <div class="cards cards-3">
        <div class="card"><p class="eyebrow eyebrow-grey"><span>Cleaners</span></p><h3 class="dim">Tidier lists</h3><p class="mono">Sort and bulk delete your Watch Later. Neater, and you still can't search it.</p></div>
        <div class="card"><p class="eyebrow eyebrow-grey"><span>Hiders</span></p><h3 class="dim">Fewer videos</h3><p class="mono">Hide what you've watched from the home page. YouTube has started doing this itself.</p></div>
        <div class="card card-hot"><p class="eyebrow"><span>Built for</span></p><h3>Finding it.</h3><p class="mono">Your Watch Later, likes, history and all of YouTube, in the search bar you already use, filtered however you like.</p></div>
      </div>
    </div>
  </section>

  <section class="band band-glow">
    <div class="wrap">
      ${eyebrow("03", "Privacy")}
      <div class="big"><span class="big-n">0</span><span class="big-l">Servers to send<br>your data to</span></div>
      <p class="lede">Not a promise, just how it's built. Needle runs inside youtube.com with the session you already have, and what it reads stays in your browser. The source is public, so you can check.</p>
      <a class="btn" href="${PRIVACY}">Read the privacy policy ${ARROW}</a>
      <div class="strip">
        <div><b>0</b><span>Accounts</span></div>
        <div><b>0</b><span>API keys</span></div>
        <div><b>0</b><span>Analytics</span></div>
        <div><b>1</b><span>Site it reads: YouTube</span></div>
      </div>
    </div>
  </section>

  <section class="band band-alt">
    <div class="wrap">
      ${eyebrow("04", "How")}
      <h2>Type. Filter. <span class="red">Watch.</span></h2>
      <p class="mono sub">Filters go straight into YouTube's search bar. Each one narrows what's left.</p>
      <div class="how">
        <div class="queries">
          ${queries.map(([q, a]) => `<div class="q"><div class="bar">${SEARCH_ICON}${q.split(" ").map((w) => /[<>:@]/.test(w) ? o(w) : `<span>${esc(w)}</span>`).join(" ")}</div><p class="mono">${esc(a)}</p></div>`).join("\n          ")}
        </div>
        <div class="grammar">
          <p class="eyebrow eyebrow-grey"><span>Every filter</span></p>
          ${opsTable(grammar)}
        </div>
      </div>
    </div>
  </section>

  <section class="band" id="tour">
    <div class="wrap center">
      ${eyebrow("05", "The tour")}
      <h2>See the whole thing run<span class="red">.</span></h2>
      <p class="mono sub center-sub">Forty seconds, no voiceover. Every place Needle shows up on YouTube.</p>
      <div class="video"><video src="tour.mp4" poster="img/tour.jpg" controls preload="none" playsinline width="1280" height="720"></video></div>
      ${WALKTHROUGH ? `<a class="btn" href="${WALKTHROUGH}">Watch the full walkthrough ${ARROW}</a>` : ""}
    </div>
  </section>

  <section class="band band-alt">
    <div class="wrap">
      ${eyebrow("06", "In action")}
      <h2>Real screens.<br><span class="grey">Real YouTube.</span></h2>
      <div class="cards cards-3 shots">
        <a class="shot" href="search-watch-later/"><img src="img/wl.webp" width="1195" height="540" alt="Needle searching a Watch Later list" loading="lazy"><span>Watch Later</span></a>
        <a class="shot" href="search-youtube-channel/"><img src="img/channel.webp" width="1156" height="560" alt="Needle filtering every video on a channel" loading="lazy"><span>A whole channel</span></a>
        <a class="shot" href="youtube-search-filters/"><img src="img/filters.webp" width="1406" height="620" alt="Needle filtering YouTube search results by length and views" loading="lazy"><span>Search results</span></a>
      </div>
    </div>
  </section>

  <section class="band" id="guides">
    <div class="wrap">
      ${eyebrow("07", "Guides")}
      <h2>How do I<span class="red">...?</span></h2>
      <p class="mono sub">Step by step, YouTube's own way first.</p>
      <div class="cards cards-2">
        ${GUIDES.map((g, i) => `<a class="card card-link" href="${g.slug}/"><p class="eyebrow eyebrow-grey"><span>Guide 0${i + 1}</span><i>·</i>${esc(g.tag)}</p><h3>${esc(g.card)}</h3><p class="mono">${esc(g.blurb)}</p><span class="go">Read ${ARROW}</span></a>`).join("\n        ")}
      </div>
    </div>
  </section>

  ${closer("home", "Start searching")}
</main>`;
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Needle for YouTube",
    alternateName: "Channel Search+ for YouTube",
    applicationCategory: "BrowserApplication",
    operatingSystem: "Chrome",
    description: "The YouTube search that knows what you've watched. Channel search, history and Watch Later, filtered by length, views and date.",
    url: BASE,
    downloadUrl: STORE,
    image: BASE + "img/og.jpg",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  return shell({
    slug: "",
    title: "Needle for YouTube: search Watch Later, history and channels",
    description: "Free Chrome extension that puts your Watch Later, likes and history in YouTube's search bar, with filters YouTube lacks: exact length, views, unwatched.",
    body,
    jsonld,
    depth: 0,
  });
}

function notFound() {
  return shell({
    slug: "",
    title: "Not found | Needle for YouTube",
    description: "This page doesn't exist.",
    body: `<main><section class="band band-article"><div class="article">${eyebrow("404", "Not found")}<h1>Nothing here<span class="red">.</span></h1><p>This page doesn't exist. Try the <a href="./">home page</a> or one of the <a href="./#guides">guides</a>.</p></div></section></main>`,
    jsonld: { "@context": "https://schema.org", "@type": "WebPage", name: "Not found" },
    depth: 0,
    robots: "noindex",
  }).replace("<head>", "<head>\n<base href=\"/needle/\">");
}

// ---------------------------------------------------------------------------

function write(rel, text) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // No em or en dashes anywhere in the copy.
  if (/[–—]/.test(text.replace(/<svg[\s\S]*?<\/svg>/g, ""))) throw new Error(rel + " has a dash in it");
  fs.writeFileSync(file, text);
}

write("index.html", homePage());
GUIDES.forEach((g, i) => write(g.slug + "/index.html", guidePage(g, i)));
write("404.html", notFound());
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${BASE}sitemap.xml\n`);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["", ...GUIDES.map((g) => g.slug + "/")].map((p) => `  <url><loc>${BASE}${p}</loc><lastmod>${UPDATED}</lastmod></url>`).join("\n")}
</urlset>
`);
write(".nojekyll", "");
fs.copyFileSync(path.join(__dirname, "..", "icons", "icon128.png"), path.join(OUT, "icon128.png"));
fs.writeFileSync(path.join(OUT, "needle.svg"), fs.readFileSync(path.join(__dirname, "..", "icons", "logo-mono.svg")));
console.log("built " + (GUIDES.length + 1) + " pages into " + OUT);
