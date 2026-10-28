/*
 * Needle for YouTube
 * Mute everywhere: a muted channel or word disappears from search, Home,
 * Subscriptions and the videos beside the one you're watching. A channel is
 * muted from YouTube's own ⋮ menu on any video, or from the panel's cards.
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
 *     /@handle or /channel/ link on the card, then from its name. A Short
 *     names nobody in either place, so YouTube's oEmbed is asked (askWhoMade).
 *
 * Your own lists, a channel's own page and the Shorts player are left alone:
 * something you went to on purpose is not noise.
 */

// ---- who made each video, from YouTube's data --------------------------------------------
const muteOwners = new Map(); // video id -> { channelIds, handles, names }
const MUTE_OWNERS_MAX = 6000;
// A channel's /@handle and its UC... id, paired whenever one card shows both, so
// a Short named only by handle (see askWhoMade) still matches a channel muted by id.
const muteHandleIds = new Map();

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
    // A Short comes back from YouTube with a title and no channel. Keep the
    // channel askWhoMade already found for it rather than forget it.
    const had = muteOwners.get(row[0]);
    const keep = had && !ids.length && !handles.length && !names.length;
    muteOwners.delete(row[0]);
    muteOwners.set(row[0], keep ? Object.assign({}, had, { title: title || had.title }) : { channelIds: ids, handles, names, nameOf, title });
    if (ids.length === 1 && handles.length === 1) muteHandleIds.set(handles[0], ids[0]);
    added++;
  }
  // Oldest out first; a long session on Home would otherwise grow this forever.
  while (muteOwners.size > MUTE_OWNERS_MAX) muteOwners.delete(muteOwners.keys().next().value);
  while (muteHandleIds.size > MUTE_OWNERS_MAX) muteHandleIds.delete(muteHandleIds.keys().next().value);
  if (added && typeof scheduleBadges === "function") scheduleBadges();
});

/*
 * ---- whose Short, when YouTube's data does not say ------------------------------------
 * A Short on Home or in search arrives with no channel at all, in the data or on
 * the page. YouTube's oEmbed answer, the one any website uses to embed a video,
 * names it: the channel's name and its /@handle. Asked only once you have muted
 * a channel (or opened a card's ⋮ menu), only for a video nothing else could
 * name, once per video, a few at a time, of youtube.com, and without cookies.
 */
const muteAsked = new Set();
const muteAskQueue = [];
const MUTE_ASK_AT_ONCE = 4;
let muteAsking = 0;

function askWhoMade(id) {
  if (muteAsked.has(id)) return;
  muteAsked.add(id);
  if (muteAsked.size > MUTE_OWNERS_MAX) muteAsked.delete(muteAsked.values().next().value);
  muteAskQueue.push(id);
  pumpAsks();
}

function pumpAsks() {
  while (muteAsking < MUTE_ASK_AT_ONCE && muteAskQueue.length) {
    const id = muteAskQueue.shift();
    muteAsking++;
    fetch("/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) learnFromEmbed(id, j); })
      .catch(() => { /* stays unnamed: muted words still apply */ })
      .finally(() => { muteAsking--; pumpAsks(); });
  }
}

function learnFromEmbed(id, j) {
  const url = typeof j.author_url === "string" ? j.author_url : "";
  const h = url.match(/\/@([^/?#]+)/), c = url.match(/\/channel\/(UC[\w-]{22})/);
  let handle = "";
  if (h) { try { handle = decodeURIComponent(h[1]).toLowerCase(); } catch (e) { handle = h[1].toLowerCase(); } }
  const name = typeof j.author_name === "string" ? j.author_name.trim() : "";
  if (!handle && !c && !name) return;
  const had = muteOwners.get(id);
  muteOwners.set(id, {
    channelIds: c ? [c[1]] : [], handles: handle ? [handle] : [], names: name ? [name] : [],
    nameOf: c && name ? { [c[1]]: name } : {},
    title: (had && had.title) || (typeof j.title === "string" ? j.title : ""),
  });
  if (typeof scheduleBadges === "function") scheduleBadges();
}

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
  const handles = [...new Set(data.handles.concat(page.handles))];
  const channelIds = [...new Set(data.channelIds.concat(page.channelIds))];
  for (const h of handles) {
    const uc = muteHandleIds.get(h);
    if (uc && !channelIds.includes(uc)) channelIds.push(uc);
  }
  return {
    channelIds,
    handles,
    names: [...new Set(data.names.concat(page.names))],
    nameOf: data.nameOf || {},
    title: data.title || muteTitle(card, id),
  };
}

// The one channel a card is by: the uploader, who comes first in YouTube's data
// (a collab's guest after). Null when nothing names it.
function muteOwnerOf(card, id) {
  const who = muteWho(card, id);
  const channelId = who.channelIds[0] || "";
  const handle = who.handles[0] || "";
  const name = (channelId && who.nameOf[channelId]) || who.names[0] || "";
  return channelId || handle || name ? { name, handle, channelId } : null;
}

// ---- the pass ------------------------------------------------------------------------------
/*
 * Run with the rest of Needle's marks, after YouTube adds cards (scheduleBadges
 * in omnibar.js) and whenever the lists or YouTube's data change. Each card is
 * looked at once per pass, hidden with an attribute and a stylesheet rule, so
 * YouTube's own layout code never sees a removed element.
 */
const muteVerdict = new WeakMap(); // card -> { id, ver, known, reason, skip }

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
     * when the lists changed, or when what is known about who made it changed
     * (`known` is that record itself, replaced whenever it is).
     */
    const known = muteOwners.get(id) || null;
    let v = muteVerdict.get(card);
    if (!v || v.id !== id || v.ver !== muted.ver || v.known !== known) {
      // A column or a page is never hidden, and nothing inside the player,
      // the comments or the rest of MUTE_NEVER is touched.
      if (notACard(card) || card.closest(MUTE_NEVER)) {
        muteVerdict.set(card, { id, ver: muted.ver, known, skip: true });
        continue;
      }
      const who = muteWho(card, id);
      v = { id, ver: muted.ver, known, reason: muteReason(who) };
      muteVerdict.set(card, v);
      // Nothing names its channel (a Short, mostly): ask, and judge it again on the answer.
      if (!who.channelIds.length && !who.handles.length && muted.list.length) askWhoMade(id);
    }
    if (v.skip) continue;
    if (card.getAttribute("data-ytcs-vid") !== id) card.setAttribute("data-ytcs-vid", id);
    if (v.reason) {
      if (card.getAttribute("data-ytcs-muted") !== v.reason) card.setAttribute("data-ytcs-muted", v.reason);
      if (card.closest("ytd-search")) hiddenInSearch++;
    } else if (card.hasAttribute("data-ytcs-muted")) {
      card.removeAttribute("data-ytcs-muted");
    }
  }
  if (location.pathname === "/results" && typeof renderMuteNote === "function") renderMuteNote(hiddenInSearch);
}

// ---- muting, and saying so -----------------------------------------------------------------
function muteAndSay(who) {
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
}

function unmuteAndSay(entry, who) {
  unmuteChannel(entry);
  const label = who.name || (who.handle ? "@" + who.handle : "this channel");
  toast("Unmuted " + label, "Undo", () => {
    muteChannel(entry.name, entry.handle, entry.channelId);
    muteScan();
    if (state.active) applyView();
  });
  muteScan();
  if (state.active) applyView();
}

/*
 * ---- the ⋮ menu ------------------------------------------------------------------------------
 * "Mute channel everywhere" in YouTube's own ⋮ menu on every video, which is
 * where people already go when they are done with a channel ("Don't recommend
 * channel" lives there, and does not reach search).
 *
 * Found the way a screen reader finds it, not by YouTube's element names, which
 * change: a click on a button inside a card (a card as muteCard defines it),
 * then the element marked role="menu" that opens beside that button. In October
 * 2026 YouTube draws two different menus for this, one on search and one beside
 * a video, and both are marked so. If no menu opens, or none is marked, nothing
 * is added and nothing breaks.
 *
 * (A button on the thumbnail itself cannot work on YouTube's cards: hovering one
 * starts YouTube's preview, which covers the thumbnail within a third of a
 * second. It stays on the panel's cards, which have no preview.)
 */
// How long after the click to keep looking: for the menu to open, and, for a
// card nothing names, for YouTube's oEmbed to answer whose it is.
// An answer still coming is waited for as long as the menu stays open, up to the second figure.
const MUTE_MENU_WAIT = 1500, MUTE_MENU_WAIT_ASKING = 10000;
let muteMenuAt = 0;

// The card a button sits in: up to the first element holding a video link, if
// that element links to that one video only.
function cardAround(el) {
  if (el.closest(MUTE_NEVER)) return null;
  for (let up = el.parentElement, i = 0; up && up !== document.body && i < 16; up = up.parentElement, i++) {
    const a = up.querySelector(MUTE_VIDEO_LINK);
    if (!a) continue;
    const id = muteLinkId(a);
    return id && linksOnlyTo(up, id) && !notACard(up) ? { card: up, id } : null;
  }
  return null;
}

// The open menu nearest the button that opened it, once it has items in it.
function openMenuNear(r) {
  let best = null, bestGap = 400;
  for (const m of document.querySelectorAll("[role=menu]")) {
    const mr = m.getBoundingClientRect();
    if (!mr.width || !mr.height || m.closest(".ytcs-wrap") || !m.querySelector("[role=menuitem], [role=option]")) continue;
    const gap = Math.hypot(Math.max(0, mr.left - r.right, r.left - mr.right), Math.max(0, mr.top - r.bottom, r.top - mr.bottom));
    if (gap < bestGap) { best = m; bestGap = gap; }
  }
  return best;
}

function dropMenuItems() {
  for (const el of document.querySelectorAll(".ytcs-ytrow")) el.remove();
}

function watchForMenu(found, button) {
  const at = muteMenuAt = Date.now();
  const r = button.getBoundingClientRect();
  const named = (o) => o && (o.channelId || o.handle);
  // A Short, or a channel's own page, names nobody: ask now, while the menu opens.
  const asking = !named(muteOwnerOf(found.card, found.id));
  if (asking) askWhoMade(found.id);
  let opened = false;
  const look = () => {
    if (muteMenuAt !== at) return; // another click since
    const menu = openMenuNear(r);
    if (opened && !menu) return; // closed while the answer was on its way
    opened = opened || !!menu;
    const owner = menu && muteOwnerOf(found.card, found.id);
    if (named(owner)) return addMenuItem(menu, found, owner);
    if (Date.now() - at < (asking ? MUTE_MENU_WAIT_ASKING : MUTE_MENU_WAIT)) setTimeout(look, 80);
  };
  setTimeout(look, 60);
}

function addMenuItem(menu, found, owner) {
  dropMenuItems();
  const entry = muted.list.find((m) => sameChannel(m, muteEntry(owner.name, owner.handle, owner.channelId)));
  const it = document.createElement("div");
  it.className = "ytcs-ytrow";
  it.setAttribute("role", "menuitem");
  it.tabIndex = 0;
  it.appendChild(omniIcon("mute", 24));
  const label = document.createElement("span");
  label.textContent = entry ? "Unmute channel" : "Mute channel everywhere";
  const by = document.createElement("span");
  by.className = "ytcs-ytrow-by";
  by.textContent = "Needle";
  it.append(label, by);
  it.title = entry ? "Bring " + (owner.name || "this channel") + " back" : "Hide " + (owner.name || "this channel") + " from search, Home and next to videos";
  it.__needle = { owner, entry };
  menu.appendChild(it);
  makeRoom(it);
  // YouTube draws its rows' icons a moment after the rows themselves.
  for (const ms of [0, 150, 500]) setTimeout(() => { if (it.isConnected) alignMenuItem(it, menu); }, ms);
}

// In line with YouTube's own rows: its icon column and its text column.
// Measured, not assumed: the two menus lay their rows out differently, so the
// row is moved by however far its icon and label landed from YouTube's.
function alignMenuItem(it, menu) {
  const first = menu.querySelector("[role=menuitem], [role=option]");
  const ico = first && first !== it && first.querySelector("svg");
  const mine = it.firstElementChild, label = mine && mine.nextElementSibling;
  if (!ico || !label) return;
  const i = ico.getBoundingClientRect();
  const shift = Math.round(i.left - mine.getBoundingClientRect().left);
  const cs = getComputedStyle(it);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.marginLeft) + shift;
  it.style.paddingLeft = Math.max(0, pad) + "px";
  it.style.marginLeft = Math.min(0, pad) + "px";
  const text = [...first.querySelectorAll("*")].find((el) => !el.children.length && el.textContent.trim() && el.getBoundingClientRect().left > i.right);
  if (text) {
    const gap = parseFloat(getComputedStyle(it).columnGap) || 16;
    it.style.gap = Math.max(8, gap + Math.round(text.getBoundingClientRect().left - label.getBoundingClientRect().left)) + "px";
  }
  fitMenuItem(it, label);
}

/*
 * YouTube sizes the menu to its own rows, which can be narrower than "Mute
 * channel everywhere" plus "Needle" (signed out, at the right edge of the
 * page). Cut short, the row would read "Mute channel everywl". So it drops the
 * tag and says "Mute channel", no longer than YouTube's own "Save to playlist",
 * and only if even that does not fit, wraps.
 */
function fitMenuItem(it, label) {
  const by = it.querySelector(".ytcs-ytrow-by");
  if (!cutOff(it, by || label)) return;
  if (by) by.remove();
  label.textContent = it.__needle && it.__needle.entry ? "Unmute channel" : "Mute channel";
  if (cutOff(it, label)) it.style.whiteSpace = "normal";
  makeRoom(it);
}

// Whether `el` runs past the right edge of a box around the row that clips it.
function cutOff(it, el) {
  const right = el.getBoundingClientRect().right;
  for (let up = it; up && up !== document.body; up = up.parentElement) {
    const cs = getComputedStyle(up);
    if (cs.overflowX !== "visible" || up === it) {
      if (right > up.getBoundingClientRect().right - 4) return true;
    }
    if (cs.position === "fixed") break;
  }
  return right > window.innerWidth - 4;
}

/*
 * YouTube sizes its menu to the rows it had when it opened, with a max-height
 * on a box that scrolls. A row added after that is drawn past the bottom of that
 * box, where a click lands on whatever is underneath. So every box between the
 * row and the menu's fixed frame with a max-height the row pokes out of grows
 * by that much, and the frame moves up if that pushed it off the bottom of the
 * window.
 */
function makeRoom(it) {
  for (let el = it.parentElement; el && el !== document.body; el = el.parentElement) {
    const past = it.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
    if (el.style.maxHeight && past > 1) el.style.maxHeight = parseFloat(el.style.maxHeight) + past + "px";
    if (getComputedStyle(el).position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    const over = r.bottom - (window.innerHeight - 8);
    if (over > 0) el.style.top = Math.max(8, r.top - over) + "px";
    break;
  }
}

// YouTube closes its menu on Escape, as it does for anyone using a keyboard.
function closeYouTubeMenu(item) {
  item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, composed: true }));
}

// ---- the panel's button --------------------------------------------------------------------
// On the panel's own cards, bottom left of the thumbnail, the one corner nothing else uses.
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

// Who the button means: the panel's cards say so in data attributes.
function muteTarget(b) {
  const panelCard = b.closest("a.ytcs-card");
  if (!panelCard) return null;
  const d = panelCard.dataset;
  return { name: d.ch || "", handle: d.h || "", channelId: d.cid || "" };
}

/*
 * On the window, in the capture phase, so it runs before the link the panel's
 * button sits inside can navigate, and before YouTube's own handlers see a click
 * on the menu item. Every other click is let through untouched; one on a button
 * inside a card starts watching for the menu it may open.
 */
window.addEventListener("click", (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  const item = t.closest(".ytcs-ytrow");
  if (item) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const { owner, entry } = item.__needle || {};
    closeYouTubeMenu(item);
    item.remove();
    if (entry) unmuteAndSay(entry, owner);
    else if (owner) muteAndSay(owner);
    return;
  }
  const b = t.closest(".ytcs-mutebtn");
  if (b) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const who = muteTarget(b);
    if (who) muteAndSay(who);
    return;
  }
  muteMenuAt = 0;
  dropMenuItems();
  const button = t.closest("button, [role=button]");
  if (!button || button.closest("a")) return;
  const found = cardAround(button);
  if (found) watchForMenu(found, button);
}, true);

// The same item, chosen from the keyboard.
window.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target && e.target.classList && e.target.classList.contains("ytcs-ytrow")) {
    e.preventDefault();
    e.target.click();
  }
}, true);
