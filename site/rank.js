// node rank.js "query one" "query two" ...
// Reads the Chrome Web Store's server-rendered search page and prints where
// Needle sits, plus the top results with their user counts.
const ME = "magofcbhfhpfabphcldhodhgehhclokc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function rank(q) {
  const res = await fetch("https://chromewebstore.google.com/search/" + encodeURIComponent(q) + "?hl=en", { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } });
  const html = await res.text();
  // rendered order
  const ids = [...html.matchAll(/data-item-id="([a-p]{32})"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  // name + users from the data blob: ["id","icon","Name",rating,count,...,users,...]
  const info = {};
  for (const m of html.matchAll(/\[\["([a-p]{32})","[^"]*","((?:[^"\\]|\\.)*)",([\d.]+|null),(\d+|null),/g)) {
    const tail = html.slice(m.index, m.index + 3000);
    const u = tail.match(/\["[a-z_\/]+",null,\d+\],\d+,null,(\d+),/);
    info[m[1]] = { name: JSON.parse('"' + m[2] + '"'), rating: m[3], count: m[4], users: u ? +u[1] : null };
  }
  const pos = ids.indexOf(ME);
  const top = ids.slice(0, 5).map((id, i) => `   ${i + 1}. ${(info[id] ? info[id].name : id).slice(0, 60)}  [${info[id] ? info[id].users : "?"} users]`).join("\n");
  return `"${q}"  ->  ${pos < 0 ? "not in first " + ids.length : "#" + (pos + 1) + " of " + ids.length}\n${top}`;
}

(async () => {
  for (const q of process.argv.slice(2)) {
    try { console.log(await rank(q)); } catch (e) { console.log(`"${q}" failed: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 800));
  }
})();
