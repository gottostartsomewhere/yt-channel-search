/*
 * Needle for YouTube
 * Mute everywhere: a muted channel or word disappears from search, Home,
 * Subscriptions and the videos beside the one you're watching.
 *
 * Built on the few things YouTube does not change, so it keeps working when it
 * redesigns, which is the thing every blocker in the store is reviewed badly for:
 *
 *   - A video is found by its link (/watch?v= or /shorts/), never by the name of
 *     the element it sits in. Those names change every few months.
 *   - Its card is the outermost element that links to that one video and no
 *     other. A row holds several videos and a card holds one, whatever either
 *     is called. Nothing tall enough to be a page is ever treated as a card, so
 *     the player, the description and the comments are safe.
 *   - Who made it comes from YouTube's own data (src/feedmap.js reads it in the
 *     page and posts it here), by the UC... id that never changes, then from any
 *     /@handle or /channel/ link on the card, then from its name.
 *
 * Your own lists, a channel's own page and the Shorts player are left alone:
 * something you went to on purpose is not noise.
 */

// ---- who made each video, from YouTube's data --------------------------------------------
const muteOwners = new Map(); // video id -> { channelIds, handles, names }
const MUTE_OWNERS_MAX = 6000;

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || !Array.isArray(e.data.needleCards)) return;
  let added = 0;
  for (const row of e.data.needleCards) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !/^[\w-]{11}$/.test(row[0])) continue;
    const ids = Array.isArray(row[1]) ? row[1].filter((x) => typeof x === "string") : [];
    const handles = Array.isArray(row[2]) ? row[2].filter((x) => typeof x === "string") : [];
    const names = row[3] && typeof row[3] === "object" ? Object.values(row[3]).filter((x) => typeof x === "string") : [];
    const nameOf = row[3] && typeof row[3] === "object" ? row[3] : {};
    const title = typeof row[4] === "string" ? row[4] : "";
    muteOwners.delete(row[0]);
    muteOwners.set(row[0], { channelIds: ids, handles, names, nameOf, title });
    added++;
  }
  // Oldest out first; a long session on Home would otherwise grow this forever.
  while (muteOwners.size > MUTE_OWNERS_MAX) muteOwners.delete(muteOwners.keys().next().value);
  if (added && typeof scheduleBadges === "function") scheduleBadges();
});

// The page's data was read before this script was listening (feedmap.js runs
// first); ask for it again, now that something is here to hear it.
window.postMessage({ needleHello: 1 }, location.origin);

// ---- where Mute applies, and what it never touches -------------------------------------------
function mutePage() {
  const p = location.pathname;
  return p === "/" || p === "/results" || p === "/watch" || p.startsWith("/feed/subscriptions");
}

const MUTE_VIDEO_LINK = "a[href*='/watch?v='], a[href^='/shorts/']";
// The player and its end screens, the video's own title and description, the
// comments, a playlist you are playing through, the miniplayer, and Needle's own UI.
const MUTE_NEVER = "#movie_player, ytd-watch-metadata, #below #comments, ytd-comments, ytd-playlist-panel-renderer, ytd-miniplayer, #masthead-container, .ytcs-wrap, .ytcs-libstrip";
/*
 * What a card can never be. The column around a watch page's player links to
 * that one video only, so the climb could reach it; it holds thousands of
 * elements and YouTube's page sections, where a card holds a few hundred and
 * none. Counted, not measured: reading a height makes the browser lay out the
 * whole page again, and on a page YouTube keeps adding to that cost 100ms a pass.
 */
const MUTE_CARD_MAX_NODES = 1500;
const MUTE_NOT_A_CARD = "ytd-app, ytd-page-manager, ytd-browse, ytd-search, ytd-watch-flexy, #columns, #primary, #secondary, #contents";

function notACard(card) {
  return card.matches(MUTE_NOT_A_CARD) || !!card.querySelector(MUTE_NEVER) ||
    card.getElementsByTagName("*").length > MUTE_CARD_MAX_NODES;
}

function muteLinkId(a) {
  const h = a.getAttribute("href") || "";
  const m = h.match(/[?&]v=([\w-]{11})/) || h.match(/^\/shorts\/([\w-]{11})/);
  return m ? m[1] : "";
}

function watchingId() {
  return location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") || "" : "";
}

function linksOnlyTo(el, id) {
  for (const x of el.querySelectorAll(MUTE_VIDEO_LINK)) {
    const v = muteLinkId(x);
    if (v && v !== id) return false;
  }
  return true;
}

// Whether everything beside `card` in its parent links to this video or none.
// Only the siblings are looked at: `card` itself is already known to, and the
// first sibling that is another card ends it, instead of a search through the
// whole results list for every new card.
function onlyThisBeside(card, id) {
  for (let sib = card.parentElement.firstElementChild; sib; sib = sib.nextElementSibling) {
    if (sib === card) continue;
    const v = sib.matches(MUTE_VIDEO_LINK) ? muteLinkId(sib) : "";
    if ((v && v !== id) || !linksOnlyTo(sib, id)) return false;
  }
  return true;
}

/*
 * The card around one video link: climb while the next element up still links
 * to this video and no other. Remembered on the link, and redone when YouTube
 * reuses the same element for another video, which it does as you scroll.
 */
const muteCardOf = new WeakMap();
function muteCard(a, id) {
  const known = muteCardOf.get(a);
  if (known && known.id === id && known.card.isConnected) return known.card;
  let card = a;
  for (let i = 0; i < 14; i++) {
    const up = card.parentElement;
    if (!up || up === document.body || !onlyThisBeside(card, id)) break;
    card = up;
  }
  muteCardOf.set(a, { id, card });
  return card;
}

// Who made it, by what the card itself shows: /@handle and /channel/UC... links, and their text.
function muteFromPage(card) {
  const handles = [], channelIds = [], names = [];
  for (const a of card.querySelectorAll("a[href^='/@'], a[href^='/channel/UC']")) {
    const href = (a.getAttribute("href") || "").split(/[?#]/)[0];
    const h = href.match(/^\/@([^/]+)/);
    const c = href.match(/^\/channel\/(UC[\w-]{22})/);
    if (h) { try { handles.push(decodeURIComponent(h[1]).toLowerCase()); } catch (e) { handles.push(h[1].toLowerCase()); } }
    if (c) channelIds.push(c[1]);
    const t = a.textContent.trim();
    if (t && t.length <= 80) names.push(t);
  }
  return { handles, channelIds, names };
}

/*
 * The title as the page shows it, for a card YouTube's data has not described:
 * a link to the video or a heading that carries a title attribute, which is the
 * title and only the title. Never the longest text on the card, which on a
 * search result is the description, and a muted word should never hide a video
 * for something only its description says.
 */
function muteTitle(card, id) {
  for (const el of card.querySelectorAll("a[title], h3[title], #video-title")) {
    if (el.tagName === "A" && muteLinkId(el) !== id) continue;
    const t = (el.getAttribute("title") || el.textContent || "").replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  const h = card.querySelector("h3, h4");
  return h ? h.textContent.replace(/\s+/g, " ").trim() : "";
}

function muteWho(card, id) {
  const data = muteOwners.get(id) || { channelIds: [], handles: [], names: [], nameOf: {}, title: "" };
  const page = muteFromPage(card);
  return {
    channelIds: [...new Set(data.channelIds.concat(page.channelIds))],
    handles: [...new Set(data.handles.concat(page.handles))],
    names: [...new Set(data.names.concat(page.names))],
    nameOf: data.nameOf || {},
    title: data.title || muteTitle(card, id),
  };
}

// ---- the pass ------------------------------------------------------------------------------
/*
 * Run with the rest of Needle's marks, after YouTube adds cards (scheduleBadges
 * in omnibar.js) and whenever the lists or YouTube's data change. Each card is
 * looked at once per pass, hidden with an attribute and a stylesheet rule, so
 * YouTube's own layout code never sees a removed element.
 */
const muteVerdict = new WeakMap(); // card -> { id, ver, known, reason, canMute, button, skip }

function muteScan() {
  const here = mutePage() && !(typeof omni === "object" && omni && omni.showMuted && location.pathname === "/results");
  if (!here) {
    for (const el of document.querySelectorAll("[data-ytcs-muted]")) el.removeAttribute("data-ytcs-muted");
    if (typeof renderMuteNote === "function" && location.pathname === "/results") renderMuteNote(0);
    return;
  }
  const watching = watchingId();
  const done = new Set();
  let hiddenInSearch = 0;
  for (const a of document.querySelectorAll(MUTE_VIDEO_LINK)) {
    const id = muteLinkId(a);
    if (!id || id === watching || a.closest(MUTE_NEVER)) continue;
    const card = muteCard(a, id);
    if (done.has(card)) continue;
    done.add(card);
    /*
     * Judged once, then remembered, so a long scroll costs only its new cards.
     * Judged again when the card now shows another video (YouTube reuses them),
     * when the lists changed, or when YouTube's data about it has just arrived.
     */
    const known = muteOwners.has(id);
    let v = muteVerdict.get(card);
    if (!v || v.id !== id || v.ver !== muted.ver || v.known !== known) {
      // A column or a page is never hidden, and nothing inside the player,
      // the comments or the rest of MUTE_NEVER is touched.
      if (notACard(card) || card.closest(MUTE_NEVER)) {
        muteVerdict.set(card, { id, ver: muted.ver, known, skip: true });
        continue;
      }
      const who = muteWho(card, id);
      v = { id, ver: muted.ver, known, reason: muteReason(who), canMute: !!(who.channelIds.length || who.handles.length), button: false };
      muteVerdict.set(card, v);
    }
    if (v.skip) continue;
    if (card.getAttribute("data-ytcs-vid") !== id) card.setAttribute("data-ytcs-vid", id);
    if (v.reason) {
      if (card.getAttribute("data-ytcs-muted") !== v.reason) card.setAttribute("data-ytcs-muted", v.reason);
      if (card.closest("ytd-search")) hiddenInSearch++;
    } else if (card.hasAttribute("data-ytcs-muted")) {
      card.removeAttribute("data-ytcs-muted");
    }
    // A mute button wherever we know whose video it is.
    if (!v.reason && v.canMute && !v.button) {
      const thumb = [...card.querySelectorAll(MUTE_VIDEO_LINK)].find((x) => muteLinkId(x) === id && x.querySelector("img, yt-image, yt-thumbnail-view-model"));
      if (thumb) addMuteButton(thumb);
      v.button = true;
    }
  }
  if (location.pathname === "/results" && typeof renderMuteNote === "function") renderMuteNote(hiddenInSearch);
}

// ---- the button ----------------------------------------------------------------------------
// Shows on hover, bottom left of a thumbnail, the one corner nothing else uses.
function addMuteButton(host) {
  if (host.querySelector(":scope > .ytcs-mutebtn")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ytcs-mutebtn";
  b.title = "Mute this channel";
  b.setAttribute("aria-label", "Mute this channel");
  b.appendChild(omniIcon("mute", 14));
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(b);
}

// Who the button means: the panel's cards say so in data attributes; YouTube's
// carry the video id we stamped on the card, and the owner comes from there.
function muteTarget(b) {
  const panelCard = b.closest("a.ytcs-card");
  if (panelCard) {
    const d = panelCard.dataset;
    return { name: d.ch || "", handle: d.h || "", channelId: d.cid || "" };
  }
  const card = b.closest("[data-ytcs-vid]");
  if (!card) return null;
  const id = card.getAttribute("data-ytcs-vid");
  const who = muteWho(card, id);
  // The uploader comes first in YouTube's data, a collab's guest after.
  const channelId = who.channelIds[0] || "";
  const handle = who.handles[0] || "";
  const name = (channelId && who.nameOf[channelId]) || who.names[0] || "";
  return channelId || handle || name ? { name, handle, channelId } : null;
}

// On the window, in the capture phase, so it runs before the link the button
// sits inside can navigate, and before YouTube's own handlers see the click.
window.addEventListener("click", (e) => {
  const b = e.target && e.target.closest && e.target.closest(".ytcs-mutebtn");
  if (!b) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const who = muteTarget(b);
  if (!who) return;
  const entry = muteChannel(who.name, who.handle, who.channelId);
  if (!entry) return;
  const label = who.name || (who.handle ? "@" + who.handle : "this channel");
  toast("Muted " + label + ". Gone from search, Home and next to videos", "Undo", () => {
    unmuteChannel(entry);
    muteScan();
    if (state.active) applyView();
  });
  muteScan();
  if (state.active) applyView();
}, true);
