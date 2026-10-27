/*
 * Needle for YouTube
 * The videos in a piece of YouTube's page data, and who made each one.
 *
 * Shared word for word by the page (src/feedmap.js, which feeds Mute) and by
 * the daily check (tools/canary.js), so the code that decides whose video a
 * card is gets tested against live YouTube every morning, not a copy of it.
 *
 * Nothing here knows what YouTube calls its parts. A card is found by what a
 * card is, the outermost piece of the data that belongs to exactly one video,
 * and its channel by what a channel always carries: a UC... id, a /@handle, and
 * a name sitting right beside the link to it. YouTube renames its wrappers every
 * few months (videoRenderer became lockupViewModel, and a reader built on the
 * old name found nothing); none of these three has changed in years.
 *
 * No DOM and no extension APIs, so it runs in the page, in a content script, or
 * in Node.
 */
var needleCards = (function () {
  const VIDEO_ID = /^[\w-]{11}$/;
  const CHANNEL_ID = /^UC[\w-]{22}$/;
  const MANY = 1;

  /*
   * One pass up the tree: for every object, the one video it is about, MANY if
   * more than one, or nothing. Kept in a WeakMap so the pass down can ask
   * without walking anything twice; a page of data is a few thousand objects.
   */
  function summarise(o, memo) {
    if (!o || typeof o !== "object") return null;
    if (memo.has(o)) return memo.get(o);
    let one = null;
    for (const k in o) {
      const v = o[k];
      let s = null;
      if ((k === "videoId" || k === "contentId") && typeof v === "string" && VIDEO_ID.test(v)) s = v;
      else if (v && typeof v === "object") s = summarise(v, memo);
      if (s === null) continue;
      if (s === MANY || (one !== null && one !== s)) { one = MANY; break; }
      one = s;
    }
    memo.set(o, one);
    return one;
  }

  // Who made a card. Every UC... id under it, every /@handle, and the short
  // text that sits beside a link to a channel, which is its name.
  function owners(node) {
    const handles = new Set(), ids = new Set(), names = new Map();
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") {
          if (k === "browseId" && CHANNEL_ID.test(v)) ids.add(v);
          else if ((k === "canonicalBaseUrl" || k === "url") && v.charAt(0) === "/" && v.charAt(1) === "@") {
            const h = v.slice(2).split(/[/?#]/)[0];
            try { handles.add(decodeURIComponent(h).toLowerCase()); } catch (e) { handles.add(h.toLowerCase()); }
          }
        } else if (v && typeof v === "object") walk(v);
      }
      // A label with a channel link inside it: { text|content: "Veritasium", ...browseId: "UC..." }.
      // Walked children first, so the tightest label around a link names it.
      const label = typeof o.text === "string" ? o.text : typeof o.content === "string" ? o.content : "";
      if (label && label.length <= 80) {
        const inner = findChannelId(o);
        if (inner && !names.has(inner)) names.set(inner, label.trim());
      }
    })(node);
    return {
      handles: [...handles],
      channelIds: [...ids],
      // { "UC...": "Veritasium" }
      names: Object.fromEntries([...names].filter(([, n]) => n)),
    };
  }

  // A text field in any of YouTube's forms: "x", { content }, { simpleText }, { runs: [{ text }] }.
  function textOf(v) {
    if (typeof v === "string") return v;
    if (!v || typeof v !== "object") return "";
    if (typeof v.content === "string") return v.content;
    if (typeof v.simpleText === "string") return v.simpleText;
    if (Array.isArray(v.runs)) return v.runs.map((r) => (r && typeof r.text === "string" ? r.text : "")).join("");
    return "";
  }

  /*
   * The video's title: the nearest "title" under the card, searched level by
   * level so the card's own title wins over one deeper inside a menu. Every kind
   * of video card YouTube has used calls it "title"; only where it sits moves.
   * Not the description: muting a word should never hide a video for something
   * only its description says.
   */
  // "title" on every long video; a Short on its own shelf calls it "primaryText".
  const TITLE_KEYS = ["title", "primaryText"];
  function titleOf(node) {
    let level = [node];
    for (let depth = 0; depth < 8 && level.length; depth++) {
      const next = [];
      for (const o of level) {
        if (!o || typeof o !== "object") continue;
        for (const key of TITLE_KEYS) {
          if (!(key in o)) continue;
          const t = textOf(o[key]).trim();
          if (t) return t;
        }
        for (const k in o) if (o[k] && typeof o[k] === "object") next.push(o[k]);
      }
      level = next;
    }
    return "";
  }

  function findChannelId(o) {
    if (!o || typeof o !== "object") return "";
    for (const k in o) {
      const v = o[k];
      if (k === "browseId" && typeof v === "string" && CHANNEL_ID.test(v)) return v;
      if (v && typeof v === "object") {
        const f = findChannelId(v);
        if (f) return f;
      }
    }
    return "";
  }

  /*
   * Every card under `root`: { id, title, handles, channelIds, names }. A collab,
   * one video from two channels, carries both, so muting either one hides it.
   */
  return function needleCards(root) {
    const memo = new WeakMap();
    const out = [];
    (function visit(o) {
      if (!o || typeof o !== "object") return;
      const s = summarise(o, memo);
      if (s === null) return;
      if (s !== MANY && !Array.isArray(o)) {
        const who = owners(o);
        out.push({ id: s, title: titleOf(o), handles: who.handles, channelIds: who.channelIds, names: who.names });
        return;
      }
      for (const k in o) visit(o[k]);
    })(root);
    return out;
  };
})();

if (typeof module === "object" && module.exports) module.exports = { needleCards };
