/*
 * Needle for YouTube
 * Runs before YouTube's own scripts, for one job.
 *
 * A shared filter link opens YouTube with the filters after "#needle=" in the
 * address, and YouTube rewrites the address within a couple of seconds of
 * loading, dropping that part (checked October 2026). The panel's scripts run
 * later than that, so this copies the filters into the tab's session storage,
 * where the panel picks them up once (see shareArrive in panel.js).
 *
 * The part of an address after "#" is never sent to any server, so the filters
 * stay between whoever shared the link and whoever opened it.
 */
(function () {
  const m = /^#needle=([^#]{0,1200})$/.exec(location.hash);
  if (!m) return;
  let q;
  try { q = decodeURIComponent(m[1]); } catch (e) { return; }
  try {
    sessionStorage.setItem("ytcsShare", JSON.stringify({
      q: q,
      path: location.pathname,
      list: new URLSearchParams(location.search).get("list") || "",
      at: Date.now(),
    }));
  } catch (e) { /* storage blocked: the page opens unfiltered, as it would without Needle */ }
})();
