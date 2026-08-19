// Pull real photographs of TURF into Designs/Course/Ground/.
//
// Descended from tools/blender/hero/v6/fetch_ref.mjs, which is the apparel
// board's fetcher and is left alone. Copied rather than refactored because the
// apparel line is out of scope this session; what is carried over is the part
// that was learned the hard way, and is repeated here so it is not re-learned:
//
//   * /qa/ is GITIGNORED. v4 saved sixteen good photographs there and the next
//     session could not see them. This writes under Designs/, which is tracked.
//   * Commons answers a too-fast request with a ~2 KB HTML error page and
//     `curl -o` writes it under the .jpg name without complaining. Check magic
//     bytes, refuse anything small, never leave a partial under the final name.
//   * CATEGORIES, NOT FULL-TEXT SEARCH. Search reads OCR, so it ranks scanned
//     books above photographs. Categories are curated and hold the pictures.
//   * Every file gets an entry in sources.json — title, page, licence, author.
//     These are other people's photographs and they go into the repository.
//
//   node tools/course/fetch_ground_ref.mjs --cat "Golf course bunkers" [limit]
//   node tools/course/fetch_ground_ref.mjs --search "<query>" [limit]
//   node tools/course/fetch_ground_ref.mjs --get <surface> <slot> "File:Exact.jpg"
//   node tools/course/fetch_ground_ref.mjs --audit
//   node tools/course/fetch_ground_ref.mjs --control
//
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = path.join(ROOT, "Designs", "Course", "Ground");
const UA = "GolfEmpire-asset-reference/2.0 (contact: sebastian@primefairways.com)";
const MIN_BYTES = 20000;
const API = "https://commons.wikimedia.org/w/api.php";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function kindOf(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  return null;
}

function verdict(buf) {
  const kind = kindOf(buf);
  if (kind === null) return { ok: false, why: "not an image (HTML error page?)", kind: null };
  if (buf.length < MIN_BYTES) return { ok: false, why: `${buf.length} B, under ${MIN_BYTES}`, kind };
  return { ok: true, why: "", kind };
}

async function get(url, tries = 4, min = 0) {
  let wait = 1500;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && buf.length >= min) return buf;
    console.log(`  retry (${res.status}, ${buf.length} B) in ${wait} ms`);
    await sleep(wait);
    wait *= 2;
  }
  throw new Error(`gave up on ${url}`);
}

const strip = (s) => (s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
// Commons appends "?utm_source=..." to every url, so an extension test anchored
// at $ matches NOTHING and an empty list reads as "no such photographs exist".
const isBitmap = (u) => /\.(jpe?g|png)$/i.test((u ?? "").split("?")[0]);

function line(pg) {
  const ii = pg.imageinfo?.[0] ?? {};
  const lic = strip(ii.extmetadata?.LicenseShortName?.value);
  const desc = strip(ii.extmetadata?.ImageDescription?.value).slice(0, 84);
  console.log(`${pg.title}`);
  console.log(`    ${ii.width}x${ii.height}  ${lic}  ${desc}`);
}

async function listing(url, what) {
  const j = JSON.parse((await get(url)).toString("utf8"));
  const pages = Object.values(j?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  let shown = 0;
  for (const pg of pages) {
    if (!isBitmap(pg.imageinfo?.[0]?.url)) continue;
    shown += 1;
    line(pg);
  }
  // ALWAYS say how many. Printing nothing when everything was filtered reads as
  // "there is none of this in the world".
  console.log(`-- ${shown} bitmap(s) of ${pages.length} in ${what}`);
}

const cat = (name, limit) => listing(
  `${API}?action=query&generator=categorymembers&gcmtitle=${encodeURIComponent(/^Category:/i.test(name) ? name : `Category:${name}`)}` +
  `&gcmtype=file&gcmlimit=${limit}&prop=imageinfo&iiprop=url|size|extmetadata&format=json`,
  /^Category:/i.test(name) ? name : `Category:${name}`,
);

const search = (q, limit) => listing(
  `${API}?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}` +
  `&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size|extmetadata&format=json`,
  `"${q}"`,
);

async function grab(surface, slot, title) {
  const url = `${API}?action=query&prop=imageinfo&titles=${encodeURIComponent(title)}` +
    "&iiprop=url|size|extmetadata&iiurlwidth=1800&format=json";
  const j = JSON.parse((await get(url)).toString("utf8"));
  const pg = Object.values(j?.query?.pages ?? {})[0];
  const ii = pg?.imageinfo?.[0];
  if (!ii?.thumburl) throw new Error(`no image for ${title}`);
  await sleep(1200);
  const buf = await get(ii.thumburl, 4, 512);
  const v = verdict(buf);
  if (!v.ok) { console.log(`REJECT ${title}: ${v.why}`); process.exitCode = 1; return; }

  const dir = path.join(BASE, surface);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${slot}.${v.kind}`;
  const out = path.join(dir, file);
  const tmp = `${out}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, out);

  const sfile = path.join(dir, "sources.json");
  const src = fs.existsSync(sfile) ? JSON.parse(fs.readFileSync(sfile, "utf8")) : {};
  src[file] = {
    title: pg.title,
    page: ii.descriptionurl,
    licence: strip(ii.extmetadata?.LicenseShortName?.value),
    author: strip(ii.extmetadata?.Artist?.value),
    original: `${ii.width}x${ii.height}`,
    bytes: buf.length,
  };
  fs.writeFileSync(sfile, JSON.stringify(src, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, out)}  ${buf.length} B  [${src[file].licence}]`);
}

function audit(only) {
  if (!fs.existsSync(BASE)) { console.log(`no ${BASE}`); process.exitCode = 1; return; }
  const dirs = only ? [only] : fs.readdirSync(BASE).filter((d) =>
    fs.statSync(path.join(BASE, d)).isDirectory());
  let bad = 0, n = 0;
  for (const a of dirs) {
    const dir = path.join(BASE, a);
    const sfile = path.join(dir, "sources.json");
    const src = fs.existsSync(sfile) ? JSON.parse(fs.readFileSync(sfile, "utf8")) : {};
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png)$/i.test(f)) continue;
      n += 1;
      const buf = fs.readFileSync(path.join(dir, f));
      const v = verdict(buf);
      const cited = Boolean(src[f]?.page) && Boolean(src[f]?.licence);
      const ok = v.ok && cited;
      if (!ok) bad += 1;
      console.log(`${ok ? "ok  " : "BAD "} ${a}/${f}  ${buf.length} B  ${v.ok ? v.kind : v.why}` +
        `${cited ? `  [${src[f].licence}]` : "  NO ATTRIBUTION"}`);
    }
  }
  console.log(`\n${n} reference image(s), ${bad} unusable`);
  if (bad) process.exitCode = 1;
}

// NEGATIVE CONTROL for the audit above, on the three shapes that have occurred:
// a Commons HTML error page saved under .jpg, a truncated download, and a real
// image nobody credited.
function control() {
  const dir = path.join(BASE, "_control");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "html-error.jpg"),
    Buffer.from("<!DOCTYPE html><html><body>Error 429</body></html>".repeat(60)));
  const stub = Buffer.alloc(4096);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(stub);
  fs.writeFileSync(path.join(dir, "truncated.jpg"), stub);
  const real = Buffer.alloc(MIN_BYTES + 10);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(real);
  fs.writeFileSync(path.join(dir, "uncredited.jpg"), real);
  fs.writeFileSync(path.join(dir, "sources.json"), "{}\n");

  const seen = [];
  for (const f of ["html-error.jpg", "truncated.jpg", "uncredited.jpg"]) {
    const buf = fs.readFileSync(path.join(dir, f));
    const v = verdict(buf);
    seen.push({ f, why: v.ok ? "NO ATTRIBUTION" : v.why });
  }
  for (const s of seen) console.log(`  ${s.f}: rejected -- ${s.why}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const ok = seen[0].why.includes("not an image") && seen[1].why.includes("under")
    && seen[2].why.includes("ATTRIBUTION");
  console.log(ok
    ? "CONTROL OK: an HTML error page, a truncated file and an uncredited image all FAIL the audit, as they must"
    : "CONTROL FAILED: the audit does not catch what it claims to");
  if (!ok) process.exitCode = 1;
}

const argv = process.argv.slice(2);
const mode = argv[0];
if (mode === "--search") await search(argv[1], Number(argv[2] ?? 24));
else if (mode === "--cat") await cat(argv[1], Number(argv[2] ?? 200));
else if (mode === "--get") await grab(argv[1], argv[2], argv[3]);
else if (mode === "--audit") audit(argv[1]);
else if (mode === "--control") control();
else { console.error("usage: --search | --cat <Category> | --get <surface> <slot> <File:...> | --audit | --control"); process.exit(2); }
