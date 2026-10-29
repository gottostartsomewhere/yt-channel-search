/*
 * node tools/site-check.js
 *
 * The guide site, live: every page in the sitemap answers with a title and a way to the store, the pages the
 * extension itself opens (welcome on install, bye on uninstall, f for shared links) answer, and a page that
 * doesn't exist says so with a 404 rather than a blank 200. Exit 1 if anything is off.
 */
const SITE = "https://gottostartsomewhere.github.io/needle/";

async function get(url) {
  const r = await fetch(url, { redirect: "follow" });
  return { status: r.status, text: await r.text() };
}

(async () => {
  const problems = [], seen = [];
  const map = await get(SITE + "sitemap.xml");
  const urls = [...map.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (map.status !== 200 || urls.length < 5) problems.push(`sitemap: ${map.status}, ${urls.length} pages`);
  for (const u of urls) {
    const r = await get(u);
    const title = (r.text.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    if (r.status !== 200) problems.push(`${u}: ${r.status}`);
    else if (!title) problems.push(`${u}: no title`);
    else if (!r.text.includes("chromewebstore.google.com/detail/")) problems.push(`${u}: no link to the store`);
    else seen.push(u.replace(SITE, "/") || "/");
  }
  for (const page of ["welcome/", "bye/", "f/"]) {
    const r = await get(SITE + page);
    if (r.status !== 200) problems.push(`/${page}: ${r.status}`);
    else seen.push("/" + page);
  }
  const missing = await get(SITE + "no-such-page-" + Date.now() + "/");
  if (missing.status !== 404) problems.push(`a page that doesn't exist answers ${missing.status}`);
  if (problems.length) {
    console.log("FAIL  site: " + problems.join("; "));
    process.exit(1);
  }
  console.log(`PASS  site: ${seen.length} pages answer (${seen.join(" ")}), and a missing page is a 404`);
})().catch((e) => { console.log("FAIL  site: " + e.message); process.exit(1); });
