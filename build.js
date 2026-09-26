/*
 * Assembles dist/chrome and dist/firefox. The two stores need different
 * manifests, since Chrome MV3 wants a service worker and Firefox wants an
 * event page, but every other file is shared verbatim.
 *
 *   node build.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const SHARED = ["src", "styles.css", "background.js", "popup.html", "popup.css", "popup.js", "icons", "_locales"];
const TARGETS = [
  { name: "chrome", manifest: "manifest.json" },
  { name: "firefox", manifest: "manifest.firefox.json" },
];

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((entry) => copy(path.join(src, entry), path.join(dest, entry)));
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ---- zip ------------------------------------------------------------------
/*
 * Written by hand rather than shelled out to.
 *
 * PowerShell's Compress-Archive is the only zip tool guaranteed to exist on a
 * Windows box, and it writes entry names with backslashes: "icons\icon16.png".
 * The ZIP spec says forward slashes, always. Chrome happens to tolerate it,
 * Firefox's AMO validator does not, so the store that is meant to be the quick
 * free one is exactly the store it breaks. Node ships zlib and nothing else
 * here needs a dependency, so the format is written out directly.
 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

// Every file under dir, as { name, body }, with names relative and
// forward-slashed. Sorted so a rebuild of unchanged sources is byte-identical.
function collect(dir, prefix, out) {
  prefix = prefix || "";
  out = out || [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const name = prefix + entry;
    if (fs.statSync(full).isDirectory()) collect(full, name + "/", out);
    else out.push({ name: name, body: fs.readFileSync(full) });
  }
  return out;
}

function writeZip(dir, zipPath) {
  const when = new Date();
  const time = dosTime(when);
  const date = dosDate(when);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of collect(dir)) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.body);
    const deflated = zlib.deflateRawSync(file.body, { level: 9 });
    // Storing beats deflating when deflating made it bigger, which happens on
    // tiny files such as the 379-byte icon.
    const stored = deflated.length >= file.body.length;
    const body = stored ? file.body : deflated;
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with directory
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  fs.writeFileSync(zipPath, Buffer.concat([Buffer.concat(locals), directory, end]));
}

/*
 * Chrome refuses to load a content script that is not "UTF-8" by its own,
 * stricter definition: valid encoding is not enough, it also rejects
 * noncharacters such as U+FFFF and lone surrogates, and then refuses the whole
 * extension with "Could not load manifest". A literal U+FFFF in a regex range
 * did exactly that once, and nothing short of loading the extension showed it.
 * So every text file in the build is held to Chrome's rule here, and the build
 * fails with the file and line instead of the browser failing without either.
 */
function assertChromeReadable(dir) {
  const strict = new TextDecoder("utf-8", { fatal: true });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(dir).filter((f) => /\.(js|css|html|json)$/.test(f))) {
    let text;
    try {
      text = strict.decode(fs.readFileSync(file));
    } catch (e) {
      throw new Error(path.relative(dir, file) + " is not valid UTF-8");
    }
    for (let i = 0; i < text.length; i++) {
      const c = text.codePointAt(i);
      const bad = (c >= 0xd800 && c <= 0xdfff) || (c >= 0xfdd0 && c <= 0xfdef) || (c & 0xfffe) === 0xfffe;
      if (bad) {
        const line = text.slice(0, i).split("\n").length;
        throw new Error(path.relative(dir, file) + " line " + line + " contains U+" +
          c.toString(16).toUpperCase() + ", which Chrome refuses to load. Write it as an escape instead.");
      }
      if (c > 0xffff) i++;
    }
  }
}

// ---- build ----------------------------------------------------------------
fs.rmSync(DIST, { recursive: true, force: true });

for (const target of TARGETS) {
  const out = path.join(DIST, target.name);
  fs.mkdirSync(out, { recursive: true });

  for (const entry of SHARED) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) throw new Error("missing " + entry);
    copy(src, path.join(out, entry));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, target.manifest), "utf8"));

  // Content scripts share one scope and run in listed order, so a missing or
  // renamed module is a runtime break. Catch it at build time instead.
  for (const cs of manifest.content_scripts || []) {
    for (const file of cs.js || []) {
      if (!fs.existsSync(path.join(out, file))) {
        throw new Error(target.name + " manifest lists " + file + ", which is not in the build");
      }
    }
  }

  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  assertChromeReadable(out);

  const zip = path.join(DIST, target.name + "-" + manifest.version + ".zip");
  writeZip(out, zip);
  console.log(target.name + ": " + manifest.version + " -> dist/" + target.name + " and " + path.basename(zip));
}
