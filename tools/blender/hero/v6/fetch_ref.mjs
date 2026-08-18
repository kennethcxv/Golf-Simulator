// Pull real photographs from Wikimedia Commons into Designs/ProShop/Apparel/v6/.
//
// WHY THIS EXISTS AGAIN. v4 had `tools/blender/hero/v4/fetch_ref.mjs` and it
// worked. Last session I reported "no way to save photos to disk" and built a
// whole set of hardgoods from construction knowledge instead. That was false,
// and it is why the brief opens with Part 0. Two real differences here:
//
//   * v4 saved into `qa/hero/v4/ref/`, and `/qa/` is GITIGNORED -- sixteen good
//     photographs sat outside the repo where the next session could not see
//     them, which is most of how "there is no reference on disk" became true.
//     v6 writes under `Designs/`, which is tracked.
//   * every file gets an entry in its asset's `sources.json` -- title, page,
//     licence, author. These are other people's photographs and they go into
//     the repository; the attribution goes with them.
//
// Kept from v4 because it was learned the hard way: Commons answers a too-fast
// request with a ~2 KB HTML error page, and `curl -o` writes it under the .jpg
// name without complaining. Validate magic bytes, refuse anything small, and
// never leave a partial file under the final name.
//
//   node fetch_ref.mjs --search "<commons search>" [limit]
//   node fetch_ref.mjs --get <asset> <slot> "File:Exact name.jpg"
//   node fetch_ref.mjs --audit [asset]
//   node fetch_ref.mjs --control
//
// SEARCH FIRST, THEN --get BY TITLE. Commons search ranks scanned books above
// photographs for anything with a common word in it, and the thumbnail costs a
// megabyte to find that out. Titles are descriptive; read them, pick, fetch.
//
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = path.join(ROOT, "Designs", "ProShop", "Apparel", "v6");
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

// the two ways a saved file has been wrong here, as one predicate
function verdict(buf) {
  const kind = kindOf(buf);
  if (kind === null) return { ok: false, why: "not an image (HTML error page?)", kind: null };
  if (buf.length < MIN_BYTES) return { ok: false, why: `${buf.length} B, under ${MIN_BYTES}`, kind };
  return { ok: true, why: "", kind };
}

// `min` is 0 for API JSON. It was 512 for everything, and an EMPTY SEARCH
// RESULT is the 20-byte body `{"batchcomplete":""}` -- so a query that simply
// matched nothing was retried four times with backoff and then thrown as a
// network failure. Twenty-two seconds to be told the wrong thing.
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

// Commons appends "?utm_source=commons.wikimedia.org&..." to every url it
// hands back now, so an extension test anchored at $ matches NOTHING. Two
// searches came back completely empty and looked like "no such photographs
// exist" rather than "the filter is broken", which is the same shape as
// every feature-smaller-than-its-sampling fault: the instrument was wrong,
// not the world.
const isBitmap = (u) => /\.(jpe?g|png)$/i.test((u ?? "").split("?")[0]);

async function search(query, limit) {
  // NO SERVER-SIDE FILE FILTER. `filetype:bitmap` returns zero hits for a
  // query that has 33 without it, and `-filemime:application/djvu` is silently
  // ignored -- the first page back for "polo shirt hanger" is still a 506-page
  // scan of Popular Science 1918. So ask for plenty and filter on the URL here,
  // where I can see it work.
  const q = query;
  const url = `${API}?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}` +
    `&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size|extmetadata&format=json`;
  const j = JSON.parse((await get(url)).toString("utf8"));
  const pages = Object.values(j?.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  if (!pages.length) { console.log(`no results for "${q}"`); return; }
  let shown = 0;
  for (const pg of pages) {
    const ii = pg.imageinfo?.[0] ?? {};
    if (!isBitmap(ii.url)) continue;   // no SVG, no PDF, no DjVu, no TIFF
    shown += 1;
    const lic = strip(ii.extmetadata?.LicenseShortName?.value);
    console.log(`${pg.title}`);
    console.log(`    ${ii.width}x${ii.height}  ${lic}  ${strip(ii.extmetadata?.ImageDescription?.value).slice(0, 90)}`);
  }
  // ALWAYS SAY HOW MANY. Printing nothing when everything is filtered reads as
  // "no such photographs exist"; it took two wrong diagnoses to learn that.
  console.log(`-- ${shown} bitmap(s) of ${pages.length} results for "${q}"`);
}

// CATEGORIES, NOT FULL-TEXT SEARCH. Every one of the 33 hits for "polo shirt
// hanger" was a scanned book -- Popular Science 1918, the Federal Register
// 1955 -- because search reads OCR. Commons categories are curated and hold
// the actual photographs: 37 in Polo shirts, 157 in Baseball caps, 75 in
// Clothes hangers. This is how the reference gets found.
async function cat(name, limit) {
  const title = /^Category:/i.test(name) ? name : `Category:${name}`;
  const url = `${API}?action=query&generator=categorymembers&gcmtitle=${encodeURIComponent(title)}` +
    `&gcmtype=file&gcmlimit=${limit}&prop=imageinfo&iiprop=url|size|extmetadata&format=json`;
  const j = JSON.parse((await get(url)).toString("utf8"));
  const pages = Object.values(j?.query?.pages ?? {});
  let shown = 0;
  for (const pg of pages) {
    const ii = pg.imageinfo?.[0] ?? {};
    if (!isBitmap(ii.url)) continue;
    shown += 1;
    console.log(`${pg.title}`);
    console.log(`    ${ii.width}x${ii.height}  ${strip(ii.extmetadata?.LicenseShortName?.value)}`);
  }
  console.log(`-- ${shown} bitmap(s) of ${pages.length} in ${title}`);
}

async function grab(asset, slot, title) {
  const url = `${API}?action=query&prop=imageinfo&titles=${encodeURIComponent(title)}` +
    "&iiprop=url|size|extmetadata&iiurlwidth=1600&format=json";
  const j = JSON.parse((await get(url)).toString("utf8"));
  const pg = Object.values(j?.query?.pages ?? {})[0];
  const ii = pg?.imageinfo?.[0];
  if (!ii?.thumburl) throw new Error(`no image for ${title}`);
  await sleep(1500);
  const buf = await get(ii.thumburl, 4, 512);
  const v = verdict(buf);
  if (!v.ok) { console.log(`REJECT ${title}: ${v.why}`); process.exitCode = 1; return; }

  const dir = path.join(BASE, asset);
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
  const assets = only ? [only] : fs.readdirSync(BASE).filter((d) =>
    fs.statSync(path.join(BASE, d)).isDirectory());
  let bad = 0, n = 0;
  for (const a of assets) {
    const dir = path.join(BASE, a);
    const sfile = path.join(dir, "sources.json");
    const src = fs.existsSync(sfile) ? JSON.parse(fs.readFileSync(sfile, "utf8")) : {};
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png)$/i.test(f)) continue;
      n += 1;
      const buf = fs.readFileSync(path.join(dir, f));
      const v = verdict(buf);
      const cited = Boolean(src[f]?.page);
      const ok = v.ok && cited;
      if (!ok) bad += 1;
      console.log(`${ok ? "ok  " : "BAD "} ${a}/${f}  ${buf.length} B  ${v.ok ? v.kind : v.why}` +
        `${cited ? "" : "  NO ATTRIBUTION"}`);
    }
  }
  console.log(`\n${n} reference image(s), ${bad} unusable`);
  if (bad) process.exitCode = 1;
}

// NEGATIVE CONTROL. The audit above is the instrument that says "these are real
// photographs with attribution". Before trusting it, make it fail on the three
// shapes that have actually occurred: a Commons HTML error page saved under
// .jpg, a truncated download, and a real image nobody credited.
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
  const htmlCaught = seen[0].why.includes("not an image");
  const shortCaught = seen[1].why.includes("under");
  const creditCaught = seen[2].why.includes("ATTRIBUTION");
  fs.rmSync(dir, { recursive: true, force: true });
  if (htmlCaught && shortCaught && creditCaught) {
    console.log("CONTROL OK: an HTML error page, a truncated file and an uncredited image all FAIL the audit, as they must");
  } else {
    console.log("CONTROL FAILED: the audit does not catch what it claims to");
    process.exitCode = 1;
  }
}

const argv = process.argv.slice(2);
const mode = argv[0];
if (mode === "--search") await search(argv[1], Number(argv[2] ?? 24));
else if (mode === "--cat") await cat(argv[1], Number(argv[2] ?? 200));
else if (mode === "--get") await grab(argv[1], argv[2], argv[3]);
else if (mode === "--audit") audit(argv[1]);
else if (mode === "--control") control();
else { console.error("usage: --search | --cat <Category> | --get <asset> <slot> <File:...> | --audit | --control"); process.exit(2); }
