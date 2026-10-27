/*
 * Needle for YouTube
 * Who made each video on the page, read from YouTube's own data as it arrives.
 *
 * Runs in the page itself (the MAIN world), because that is the only place
 * YouTube's data exists: the first page's ytInitialData, the data every
 * navigation hands to yt-navigate-finish, and the replies that bring more
 * results as you scroll. The page shows a channel's name as plain text on a
 * sidebar card and no channel at all on a Shorts shelf, so reading the screen
 * alone cannot tell whose video a card is. The data always says, by the UC...
 * id that never changes.
 *
 * What it finds goes to Needle's content script (src/mute.js) by postMessage,
 * on this window only: video id, channel ids, handles, names, title. Nothing leaves the
 * browser, nothing is stored, and YouTube's replies are read from a copy and
 * passed on untouched. Every step is wrapped, so a failure here costs Mute some
 * accuracy and costs YouTube nothing.
 *
 * Needs src/cards.js loaded before it, in the same world.
 */
(function () {
  if (window.__needleFeedMap || typeof needleCards !== "function") return;
  window.__needleFeedMap = true;

  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));

  function send(data) {
    idle(() => {
      try {
        const cards = needleCards(data).filter((c) => c.channelIds.length || c.handles.length || c.title);
        if (!cards.length) return;
        window.postMessage({ needleCards: cards.map((c) => [c.id, c.channelIds, c.handles, c.names, c.title]) }, location.origin);
      } catch (e) { /* Mute falls back to what the page shows */ }
    });
  }

  // More results as you scroll, more of the sidebar, a new search: all arrive
  // as replies from YouTube's own API. Read from a clone; the original goes
  // back to YouTube exactly as it came.
  const MORE = /\/youtubei\/v1\/(browse|next|search)\b/;
  const original = window.fetch;
  if (typeof original === "function") {
    window.fetch = function (input) {
      const reply = original.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (MORE.test(url)) {
          reply.then((r) => {
            if (r && r.ok) r.clone().json().then(send, () => {});
          }, () => {});
        }
      } catch (e) { /* never in YouTube's way */ }
      return reply;
    };
  }

  // The first page, and every page after it without a reload. The latest one is
  // kept (a reference, not a copy) for the handshake below.
  let latest = null;
  function firstPage() {
    if (window.ytInitialData) {
      latest = window.ytInitialData;
      send(latest);
    }
  }
  document.addEventListener("yt-navigate-finish", (e) => {
    const r = e && e.detail && e.detail.response;
    if (r) {
      latest = r;
      send(r);
    } else firstPage();
  });

  /*
   * The handshake. This runs at document_start and Mute at document_idle, so on
   * a fresh load the first page's cards are sent before Mute is listening and
   * would be lost: a muted channel would stay in the sidebar until you scrolled.
   * Mute says hello when it starts, and the page it missed is sent again.
   */
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.needleHello !== 1) return;
    if (latest) send(latest);
    else firstPage();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", firstPage);
  else firstPage();
})();
