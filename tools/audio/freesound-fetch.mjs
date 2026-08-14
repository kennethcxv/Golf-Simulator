// PHASE 1 (Goal 26) — GO AND GET THE FILES.
//
// "Every sound in this game is oscillators and filtered noise. That is *why* the
// ledger sounds like static and electricity and the money sounds like nothing."
//
// He is right, and three briefs have now asked for this. The blocker recorded in
// Assets/audio/CREDITS.md was that Freesound downloads need an API key nobody
// created. That blocker is real for the ORIGINAL file and false for the sound
// itself: freesound.org serves its search pages and its CDN previews to anyone,
// with no credential, and a preview is a lossy transcode OF THE SAME WORK under
// THE SAME LICENCE. Under CC0 a derivative carries no restriction at all.
//
// THIS TOOL FAILS CLOSED ON LICENCE. The brief's refusal list includes "a preview
// file whose download carries a different licence", so the check is not the search
// filter -- a facet is a query parameter and a query parameter is not evidence.
// Every sound's OWN page is fetched and its licence link parsed, and anything that
// is not CC0 or CC-BY is REFUSED with its reason recorded. A sound whose page
// cannot be read is refused too; an unreadable licence is not a permissive one.
//
// Development-time only. The shipped game plays vendored local files.
//
//   node tools/audio/freesound-fetch.mjs --plan tools/audio/cue-plan.json --out /tmp/aud/raw
//   node tools/audio/freesound-fetch.mjs --search "cash register drawer" --limit 12
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const UA = 'GolfEmpire-asset-sourcing/1.0 (development-time vendoring; contact via repo)';

// Only these two reach a player. Anything with a NonCommercial or ShareAlike term
// is refused at the gate rather than in review, because this ships on Steam.
const LICENCES = [
  { id: 'CC0-1.0', match: /creativecommons\.org\/publicdomain\/zero\/1\.0/, attribution: false },
  { id: 'CC-BY-4.0', match: /creativecommons\.org\/licenses\/by\/4\.0/, attribution: true },
  { id: 'CC-BY-3.0', match: /creativecommons\.org\/licenses\/by\/3\.0/, attribution: true },
];
// Named so a refusal says WHICH forbidden term was found rather than "not allowed".
const REFUSED = [
  { id: 'CC-BY-NC', match: /creativecommons\.org\/licenses\/by-nc/, why: 'NonCommercial' },
  { id: 'CC-BY-SA', match: /creativecommons\.org\/licenses\/by-sa/, why: 'ShareAlike' },
  { id: 'CC-Sampling+', match: /creativecommons\.org\/licenses\/sampling/, why: 'Sampling+ is not commercial-clean' },
];

async function get(url, { binary = false } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

/** Search freesound's public HTML and return candidate sound ids + preview urls. */
export async function search(query, { limit = 12, extraFilter = '' } = {}) {
  const filter = encodeURIComponent(`license:"Creative Commons 0"${extraFilter ? ` ${extraFilter}` : ''}`);
  const url = `https://freesound.org/search/?q=${encodeURIComponent(query)}&f=${filter}&s=score+desc`;
  const html = await get(url);
  // The preview URL carries the id AND the uploader id, and it is the only place
  // both appear together, so it is parsed rather than the link list (which repeats
  // one sound a dozen times per card).
  const seen = new Map();
  for (const m of html.matchAll(/https:\/\/cdn\.freesound\.org\/previews\/(\d+)\/(\d+)_(\d+)-[lh]q\.(?:mp3|ogg)/g)) {
    const [, bucket, id, user] = m;
    if (!seen.has(id)) seen.set(id, { id, bucket, user });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/**
 * Fetch a sound's OWN page and decide. Returns {ok, licence, title, author, ...}.
 * A page that will not load, or that names no recognised licence, is refused --
 * "I could not read it" must never resolve to "it is fine".
 */
export async function verifyLicence(id) {
  const pageUrl = `https://freesound.org/s/${id}/`;
  let html;
  try {
    html = await get(pageUrl);
  } catch (error) {
    return { ok: false, id, pageUrl, why: `page unreadable: ${error.message}` };
  }
  for (const bad of REFUSED) {
    if (bad.match.test(html)) return { ok: false, id, pageUrl, licence: bad.id, why: `refused: ${bad.why}` };
  }
  const hit = LICENCES.find((l) => l.match.test(html));
  if (!hit) return { ok: false, id, pageUrl, why: 'no recognised licence link on the sound page' };
  const title = (html.match(/<meta property=['"]og:title['"] content=['"]([^'"]+)['"]/i)
    || html.match(/<title>([^<]+)<\/title>/i) || [, `freesound-${id}`])[1]
    .replace(/\s*\|\s*Freesound\s*$/i, '').trim();
  const author = (html.match(/freesound\.org\/people\/([^/'"]+)\//) || [, 'unknown'])[1];
  // The page carries its own preview URLs, so the uploader id never has to be
  // guessed or carried in the plan. One fetch decides the licence AND names the
  // files, which also means the bytes downloaded are the ones this page vouched for.
  const previews = [...new Set(
    [...html.matchAll(/https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-[lh]q\.(?:mp3|ogg)/g)].map((m) => m[0]),
  )];
  return {
    ok: true, id, pageUrl, licence: hit.id, needsAttribution: hit.attribution, title, author, previews,
  };
}

/** Download the highest-quality preview available. Prefers ogg (smaller, and the
 *  renderer is Chromium so it decodes natively). */
export async function downloadPreview(previews, outDir, basename) {
  fs.mkdirSync(outDir, { recursive: true });
  const rank = (url) => (url.includes('-hq.ogg') ? 0 : url.includes('-hq.mp3') ? 1
    : url.includes('-lq.ogg') ? 2 : 3);
  const attempts = [...previews].sort((a, b) => rank(a) - rank(b))
    .map((url) => ({ url, ext: url.endsWith('.ogg') ? 'ogg' : 'mp3' }));
  for (const attempt of attempts) {
    try {
      const data = await get(attempt.url, { binary: true });
      if (data.length < 512) continue; // a truncated body is not a sound
      const file = path.join(outDir, `${basename}.${attempt.ext}`);
      fs.writeFileSync(file, data);
      return { file, bytes: data.length, sourceFile: attempt.url, ext: attempt.ext };
    } catch { /* try the next encoding */ }
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  // --search: reconnaissance. Prints what is there so a cue plan can be written
  // against real results instead of hopeful queries.
  const query = arg('search');
  if (query) {
    const found = await search(query, { limit: Number(arg('limit', 12)) });
    for (const s of found) {
      const v = await verifyLicence(s.id);
      console.log(`${v.ok ? 'OK ' : 'NO '} ${s.id.padEnd(8)} ${(v.licence || '-').padEnd(10)} ${(v.title || v.why || '').slice(0, 70)}`);
    }
    return;
  }

  const planPath = arg('plan');
  if (!planPath) {
    console.error('usage: --plan <cue-plan.json> --out <dir>   |   --search "<query>" [--limit n]');
    process.exit(2);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const outDir = arg('out', '/tmp/aud/raw');
  const results = [];
  for (const entry of plan.sounds) {
    const verdict = await verifyLicence(entry.id);
    if (!verdict.ok) {
      console.log(`REFUSED ${entry.id} (${entry.cue}) — ${verdict.why}`);
      results.push({ ...entry, ...verdict });
      continue;
    }
    const got = await downloadPreview(verdict.previews || [], outDir, entry.basename);
    if (!got) {
      console.log(`NO FILE ${entry.id} (${entry.cue}) — every preview encoding failed`);
      results.push({ ...entry, ...verdict, ok: false, why: 'no downloadable preview' });
      continue;
    }
    console.log(`GOT ${entry.basename.padEnd(28)} ${verdict.licence.padEnd(9)} ${(got.bytes / 1024).toFixed(0)}kB  ${verdict.title.slice(0, 46)}`);
    results.push({ ...entry, ...verdict, ...got });
  }
  const outFile = path.join(outDir, 'provenance.json');
  fs.writeFileSync(outFile, `${JSON.stringify({ fetchedAt: new Date().toISOString(), results }, null, 2)}\n`);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} sounds vendored. Provenance: ${outFile}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
