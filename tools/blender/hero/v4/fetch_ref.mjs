// Pull real retail photographs from Wikimedia Commons into qa/hero/v4/ref/.
//
// The brief's source of truth is real merchandise, so every reference here is
// a photograph of an actual garment, not a generated image.
//
// This exists because doing it by hand went wrong twice in the same way:
// Commons answers a too-fast request with a 1,989-byte HTML error page, and
// `curl -o` writes it out under the .jpg name without complaining. Six of
// those sat in the ref folder looking like references until sharp refused one.
// So: validate the magic bytes, refuse anything under 20 KB, and never leave a
// partial file behind under the final name.
//
//   node tools/blender/hero/v4/fetch_ref.mjs <slug> "<commons search>" [n]
//   node tools/blender/hero/v4/fetch_ref.mjs --title <slug><n> "File:Exact name.jpg"
//   node tools/blender/hero/v4/fetch_ref.mjs --audit
//
// Search ranks scanned books above photographs for anything with a common
// word in it -- "folded shirts retail" returns eleven 19th-century PDFs -- so
// --title is how you take the one good result search did surface.
//
import fs from "node:fs";
import path from "node:path";

const REF = path.join(process.cwd(), "qa", "hero", "v4", "ref");
const UA = "GolfEmpire-asset-reference/1.0 (contact: sebastian@primefairways.com)";
const MIN_BYTES = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function looksLikeImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  return null;
}

function audit() {
  const bad = [];
  for (const f of fs.readdirSync(REF)) {
    const p = path.join(REF, f);
    const st = fs.statSync(p);
    if (!st.isFile()) continue;
    const buf = fs.readFileSync(p);
    const kind = looksLikeImage(buf);
    const ok = kind !== null && st.size >= MIN_BYTES;
    console.log(`${ok ? "ok  " : "BAD "} ${f}  ${st.size} B  ${kind ?? "not-an-image"}`);
    if (!ok) bad.push(f);
  }
  if (bad.length) {
    console.log(`\n${bad.length} unusable reference file(s):`);
    for (const f of bad) console.log(`  ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\nall references are real images");
  }
}

async function get(url, tries = 4) {
  let wait = 1500;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && buf.length >= 512) return buf;
    console.log(`  retry (${res.status}, ${buf.length} B) in ${wait} ms`);
    await sleep(wait);
    wait *= 2;
  }
  throw new Error(`gave up on ${url}`);
}

async function save(name, buf, descurl, lic) {
  const kind = looksLikeImage(buf);
  if (kind === null || buf.length < MIN_BYTES) {
    console.log(`  reject: ${buf.length} B, ${kind ?? "not an image"}`);
    return false;
  }
  const out = path.join(REF, `${name}.${kind}`);
  const tmp = `${out}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, out);
  console.log(`wrote ${out}  ${buf.length} B`);
  if (descurl) console.log(`      ${descurl}${lic ? `  [${lic}]` : ""}`);
  return true;
}

async function byTitle(name, title) {
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo" +
    `&titles=${encodeURIComponent(title)}&iiprop=url|size|extmetadata` +
    "&iiurlwidth=1280&format=json";
  const j = JSON.parse((await get(api)).toString("utf8"));
  const pg = Object.values(j?.query?.pages ?? {})[0];
  const ii = pg?.imageinfo?.[0];
  if (!ii?.thumburl) throw new Error(`no image for ${title}`);
  await sleep(1500);
  const ok = await save(name, await get(ii.thumburl), ii.descriptionurl,
                        ii.extmetadata?.LicenseShortName?.value);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--audit") return audit();
  if (argv[0] === "--title") return byTitle(argv[1], argv[2]);

  const [slug, query, nRaw] = argv;
  if (!slug || !query) {
    console.error('usage: fetch_ref.mjs <slug> "<commons search>" [n]');
    process.exit(2);
  }
  const want = Number(nRaw ?? 1);

  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=24` +
    "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1280&format=json";
  const list = JSON.parse((await get(api)).toString("utf8"));
  const pages = Object.values(list?.query?.pages ?? {});
  if (!pages.length) throw new Error(`no Commons results for "${query}"`);

  let n = 0;
  for (const pg of pages) {
    if (n >= want) break;
    const ii = pg.imageinfo?.[0];
    if (!ii?.thumburl) continue;
    if (!/\.(jpe?g|png)$/i.test(ii.url)) continue;

    await sleep(1800); // Commons rate-limits harder than it admits
    let buf;
    try {
      buf = await get(ii.thumburl);
    } catch (e) {
      console.log(`  skip ${pg.title}: ${e.message}`);
      continue;
    }
    const kind = looksLikeImage(buf);
    if (kind === null || buf.length < MIN_BYTES) {
      console.log(`  skip ${pg.title}: ${buf.length} B, ${kind ?? "not an image"}`);
      continue;
    }
    n += 1;
    const out = path.join(REF, `${slug}-ref${n}.${kind}`);
    const tmp = `${out}.part`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, out);
    console.log(`wrote ${out}  ${buf.length} B  <- ${pg.title}`);
    const lic = ii.extmetadata?.LicenseShortName?.value;
    console.log(`      ${ii.descriptionurl}${lic ? `  [${lic}]` : ""}`);
  }
  if (n < want) {
    console.log(`only ${n} of ${want} usable results`);
    process.exitCode = 1;
  }
}

main();
