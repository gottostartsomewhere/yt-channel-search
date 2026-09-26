/*
 * Needle for YouTube
 * The one file that runs in the page's own JavaScript world rather than the
 * extension's isolated one, because that is the only place YouTube's router
 * listens. It does two things and reads nothing else.
 *
 * First, it opens pages the way YouTube's own links do, without a reload. The
 * content scripts put a URL in an attribute on <html> and fire
 * "ytcs-navigate"; this hands YouTube the same "yt-navigate" event its own
 * links fire. Only two shapes of URL are accepted: a video (/watch?v=) and a
 * search (/results?search_query=, optionally with YouTube's own filter
 * parameter). Nothing else on the page can use this to send YouTube elsewhere.
 *
 * Second, it copies YouTube's public API key and client version onto <html>,
 * so a followed search can be checked with one small API call instead of
 * downloading a whole results page first. The key is the one embedded in every
 * YouTube page for every visitor; it identifies the website, not the person.
 *
 * It marks <html> as present only when it can see YouTube's page globals. An
 * older Firefox ignores "world": "MAIN" and would run this in the isolated world
 * instead, where the events would go nowhere; there the mark is never set and
 * the content scripts fall back to ordinary page loads.
 */
(function () {
  if (window.__ytcsNav) return;
  window.__ytcsNav = true;
  if (typeof window.ytcfg === "undefined" || !window.ytcfg.get) return;
  const root = document.documentElement;
  root.setAttribute("data-ytcs-nav", "1");
  const publish = () => {
    const key = window.ytcfg.get("INNERTUBE_API_KEY");
    const ver = window.ytcfg.get("INNERTUBE_CLIENT_VERSION");
    if (key) root.setAttribute("data-ytcs-key", key);
    if (ver) root.setAttribute("data-ytcs-ver", ver);
  };
  publish();
  document.addEventListener("yt-navigate-finish", publish);

  const endpointFor = (url) => {
    let m = url.match(/^\/watch\?v=([\w-]{6,20})$/);
    if (m) {
      return {
        commandMetadata: { webCommandMetadata: { url: url, webPageType: "WEB_PAGE_TYPE_WATCH", rootVe: 3832 } },
        watchEndpoint: { videoId: m[1] },
      };
    }
    m = url.match(/^\/results\?(.+)$/);
    if (m) {
      const p = new URLSearchParams(m[1]);
      const query = p.get("search_query");
      const sp = p.get("sp") || "";
      if (!query || !/^[\w+/=%-]*$/.test(sp)) return null;
      const endpoint = {
        commandMetadata: { webCommandMetadata: { url: url, webPageType: "WEB_PAGE_TYPE_SEARCH", rootVe: 4724 } },
        searchEndpoint: { query: query },
      };
      if (sp) endpoint.searchEndpoint.params = sp;
      return endpoint;
    }
    return null;
  };

  document.addEventListener("ytcs-navigate", () => {
    const url = root.getAttribute("data-ytcs-go") || "";
    root.removeAttribute("data-ytcs-go");
    const endpoint = endpointFor(url);
    const app = document.querySelector("ytd-app");
    if (!endpoint || !app) return;
    app.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail: { endpoint: endpoint } }));
  });
})();
