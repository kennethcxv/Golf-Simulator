#!/usr/bin/env node
// THE ASSET MANIFEST — one derived source of truth for which asset ships.
//
// WHY THIS EXISTS. hero/v3, hero/v4 and hero/v5 all sat on disk with the same
// ten filenames, and nothing on disk said which one the game loads. A session
// picking by name has a one-in-three chance of picking a dead one, and that has
// happened. The same shape repeats across vendor/models/{clubhouse,checkout,
// course,shed} and the assets_51_100 sheets: 553 files, no statement of intent.
//
// So the statement is DERIVED, not typed. This tool reads the loaders in src/
// and the files on disk and answers one question per asset:
//
//   SHIPPING    a loader in src/ can reach it
//   NOT WIRED   it exists and nothing loads it
//   SUPERSEDED  it is declared dead in Assets/_archive/ARCHIVED.json
//
// `--write` regenerates Assets/MANIFEST.md. `--check` fails when the manifest
// is stale or when anything references an archived path. Both are in the suite.
//
// WHAT THIS CANNOT SEE, stated so the numbers are not read as more than they
// are: a loader like `vendor/models/flora/${id}.glb` names its file at runtime
// from a registry this tool does not evaluate. Every file under such a
// directory is therefore reported SHIPPING with the loader site named, and the
// per-file truth is whether the id is in that registry. Directory-level wiring
// is still the thing that stops version mixing, which is the job here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const abs = (p) => path.join(ROOT, p);

// Runtime-loadable classes. A .blend or a .py is a source tool, not an asset
// the game may load, and listing them would bury the ones that matter.
const ASSET_EXT = new Set(['.glb', '.gltf', '.jpg', '.jpeg', '.png', '.webp', '.hdr', '.exr']);

// Where the game's assets live. vendor/ is what the renderer fetches; Assets/
// is where they are authored.
const ASSET_ROOTS = ['vendor/models', 'vendor/textures', 'Assets'];

// Where a reference to an asset can come from. main.cjs and index.html matter:
// the main process and the import map both name files.
const CODE_ROOTS = ['src', 'index.html', 'main.cjs'];

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__pycache__') continue;
      walk(full, out);
    } else if (ASSET_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function codeFiles() {
  const out = [];
  for (const r of CODE_ROOTS) {
    const full = abs(r);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isFile()) { out.push(full); continue; }
    const stack = [full];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) stack.push(f);
        else if (/\.(js|mjs|cjs|html)$/.test(e.name)) out.push(f);
      }
    }
  }
  return out;
}

// A path literal: everything up to the quote/backtick, or up to a ${ if the
// name is built at runtime. Both are evidence; they differ in precision.
const LITERAL_RE = /(?:vendor|Assets)\/[A-Za-z0-9_+\-./]*\.(?:glb|gltf|jpg|jpeg|png|webp|hdr|exr)/g;
const DYNAMIC_RE = /(?:vendor|Assets)\/[A-Za-z0-9_+\-./]*(?=\$\{)/g;
// A whole quoted string that is a DIRECTORY is the third way a loader names its
// files, and missing it is not cosmetic: `const KIT_DIR = 'vendor/models/shed/'`
// followed by `KIT_DIR + name` is how the entire shed kit loads, and the first
// cut of this tool reported all five of its GLBs NOT WIRED.
const DIR_RE = /['"`]((?:vendor|Assets)\/[A-Za-z0-9_+\-./]*\/)['"`]/g;

export function scanReferences() {
  const literals = new Map();   // asset path -> [code sites]
  const dynamicDirs = new Map(); // directory prefix -> [code sites]
  for (const file of codeFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const site = `${rel(file)}:${i + 1}`;
      for (const m of line.matchAll(LITERAL_RE)) {
        if (!literals.has(m[0])) literals.set(m[0], []);
        literals.get(m[0]).push(site);
      }
      for (const m of line.matchAll(DYNAMIC_RE)) {
        // keep the static directory part only — `.../sheet_${n}/x_${y}.glb`
        // proves the directory, never the file
        const dir = m[0].slice(0, m[0].lastIndexOf('/') + 1);
        if (!dir) continue;
        if (!dynamicDirs.has(dir)) dynamicDirs.set(dir, []);
        dynamicDirs.get(dir).push(site);
      }
      for (const m of line.matchAll(DIR_RE)) {
        if (!dynamicDirs.has(m[1])) dynamicDirs.set(m[1], []);
        dynamicDirs.get(m[1]).push(site);
      }
    });
  }
  return { literals, dynamicDirs };
}

export function readArchive() {
  const f = abs('Assets/_archive/ARCHIVED.json');
  if (!fs.existsSync(f)) return { entries: [] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function stagingMap() {
  // Assets/ source -> vendor/ copy, from the generated-models manifest first
  // (authoritative) and then by basename for the direct Blender exports, which
  // have no manifest entry but are plainly the same asset.
  const byManifest = new Map();
  const mf = abs('tools/vendor-models.manifest.json');
  if (fs.existsSync(mf)) {
    for (const e of JSON.parse(fs.readFileSync(mf, 'utf8'))) byManifest.set(e.from, e.to);
  }
  return byManifest;
}

export function inventory() {
  const { literals, dynamicDirs } = scanReferences();
  const archive = readArchive();
  const archivedPrefixes = archive.entries.flatMap((e) => [e.path, e.formerPath]).filter(Boolean);
  const byManifest = stagingMap();

  const vendorByBase = new Map();
  const files = [];
  for (const root of ASSET_ROOTS) {
    for (const f of walk(abs(root))) files.push(rel(f));
  }
  for (const f of files) {
    if (!f.startsWith('vendor/')) continue;
    const base = path.basename(f).toLowerCase();
    if (!vendorByBase.has(base)) vendorByBase.set(base, []);
    vendorByBase.get(base).push(f);
  }

  const rows = files.sort().map((file) => {
    const archived = archivedPrefixes.some((p) => file === p || file.startsWith(`${p}/`));
    const litSites = literals.get(file) || [];
    let dynSite = null;
    for (const [dir, sites] of dynamicDirs) {
      if (file.startsWith(dir) && (!dynSite || dir.length > dynSite.dir.length)) {
        dynSite = { dir, site: sites[0] };
      }
    }
    // An Assets/ source inherits the status of the vendor copy it is staged to.
    let staged = byManifest.get(file) || null;
    if (!staged && file.startsWith('Assets/')) {
      const twins = vendorByBase.get(path.basename(file).toLowerCase()) || [];
      if (twins.length === 1) staged = twins[0];
    }
    let stagedRef = null;
    if (staged) {
      const sLit = literals.get(staged) || [];
      let sDyn = null;
      for (const [dir, sites] of dynamicDirs) {
        if (staged.startsWith(dir) && (!sDyn || dir.length > sDyn.dir.length)) sDyn = { dir, site: sites[0] };
      }
      stagedRef = sLit.length ? { kind: 'literal', site: sLit[0] } : (sDyn ? { kind: 'dynamic', site: sDyn.site } : null);
    }

    let status;
    let evidence;
    if (archived) {
      status = 'SUPERSEDED';
      const entry = archive.entries.find((e) => file.startsWith(`${e.path}/`) || file.startsWith(`${e.formerPath}/`));
      evidence = entry ? `superseded by ${entry.supersededBy}` : 'declared in ARCHIVED.json';
    } else if (litSites.length) {
      status = 'SHIPPING';
      evidence = `loaded at ${litSites[0]}${litSites.length > 1 ? ` (+${litSites.length - 1})` : ''}`;
    } else if (dynSite) {
      status = 'SHIPPING';
      evidence = `loaded by name from ${dynSite.site}`;
    } else if (stagedRef) {
      status = 'SHIPPING';
      evidence = `source of ${staged}, ${stagedRef.kind === 'literal' ? 'loaded at' : 'loaded by name from'} ${stagedRef.site}`;
    } else if (staged) {
      status = 'NOT WIRED';
      evidence = `source of ${staged}, which nothing loads`;
    } else {
      status = 'NOT WIRED';
      evidence = 'no loader in src/';
    }
    return { file, status, evidence, bytes: fs.statSync(abs(file)).size };
  });

  // Loaders that name a file nothing on disk answers to. This is the other
  // half of "which version is current": a path that rotted when a file moved.
  const missing = [];
  for (const [p, sites] of literals) {
    if (!fs.existsSync(abs(p))) missing.push({ path: p, sites });
  }
  return { rows, missing, archive, literals, dynamicDirs };
}

// ---------------------------------------------------------------------------

const FAMILY_NOTE = {
  'vendor/models/clubhouse': 'clubhouse interior props, merch and the hero garments/hardgoods, loaded by name through merch.js',
  'vendor/models/checkout': 'the checkout kit: register, tender, bags, fixtures',
  'vendor/models/course': 'outdoor course props loaded by type name',
  'vendor/models/flora': 'trees and shrubs for the scatter, loaded by id',
  'vendor/models/trees': 'tree GLBs',
  'vendor/models/shed': 'the maintenance shed interior',
  'vendor/models/assets_51_100': 'the numbered asset sheets 51-100, placed through placeableCatalog',
  'vendor/models/pro_shop_furniture': 'the furniture catalogue, one GLB per category/tier',
  'vendor/models/architecture': 'door systems',
  'vendor/models/ceiling_lights': 'ceiling light fixtures',
  'vendor/models/golf_carts': 'cart bodies and their configs',
  'vendor/models/hands': 'first-person hand meshes',
  'vendor/models/premium_clubhouse': 'the premium clubhouse variant shell',
  'vendor/textures': 'the ground and shell PBR sets (Poly Haven CC0) — see vendor/textures/_manifest.json',
  'Assets/models/hero': 'hero-quality authored garments and hardgoods (v5 is current)',
  'Assets/pro_shop': 'the pro-shop product/fixture library (PF)',
  'Assets/checkout': 'checkout kit sources',
  'Assets/assets_51_100': 'sheet 51-100 sources',
  'Assets/pro_shop_furniture': 'furniture catalogue sources',
  'Assets/architecture': 'door sources',
  'Assets/ceiling_lights': 'ceiling light sources',
  'Assets/course_props': 'course prop sources',
  'Assets/loading': 'loading-screen plates',
  'Assets/_archive': 'ARCHIVED — kept for history, must never be referenced',
};

// A family is a DIRECTORY, never a file: `Assets/armchair+3d+model.glb` is one
// of twenty-nine loose downloads at the Assets root and they belong together in
// one row, not twenty-nine one-file families.
function familyOf(file) {
  const dir = file.split('/').slice(0, -1);
  for (let n = Math.min(3, dir.length); n >= 1; n -= 1) {
    const key = dir.slice(0, n).join('/');
    if (FAMILY_NOTE[key]) return key;
  }
  return dir.slice(0, Math.min(2, dir.length)).join('/');
}

const mib = (b) => `${(b / 1048576).toFixed(1)} MiB`;

export function renderManifest({ rows, missing, archive }) {
  const fams = new Map();
  for (const r of rows) {
    const f = familyOf(r.file);
    if (!fams.has(f)) fams.set(f, []);
    fams.get(f).push(r);
  }
  const count = (list, s) => list.filter((r) => r.status === s).length;

  const L = [];
  L.push('# ASSET MANIFEST');
  L.push('');
  L.push('<!-- GENERATED by `node tools/asset-manifest.mjs --write`. Do not hand-edit:');
  L.push('     the statuses are derived from the loaders in src/ and the files on disk,');
  L.push('     and `--check` fails the suite when this file disagrees with them. -->');
  L.push('');
  L.push('This answers one question: **which copy of an asset does the game load?**');
  L.push('');
  L.push('| status | meaning |');
  L.push('|---|---|');
  L.push('| `SHIPPING` | a loader in `src/` can reach it |');
  L.push('| `NOT WIRED` | it exists and nothing in `src/` loads it |');
  L.push('| `SUPERSEDED` | declared dead in `Assets/_archive/ARCHIVED.json`; referencing it fails the suite |');
  L.push('');
  L.push('A loader that builds its filename at runtime — `` `vendor/models/flora/${id}.glb` `` —');
  L.push('proves the *directory*, not the file. Those rows say "loaded by name from", and the');
  L.push('remaining question for them is whether the id is in that loader\'s registry.');
  L.push('');
  L.push(`Totals: **${rows.length}** asset files — ${count(rows, 'SHIPPING')} SHIPPING, ` +
    `${count(rows, 'NOT WIRED')} NOT WIRED, ${count(rows, 'SUPERSEDED')} SUPERSEDED.`);
  L.push('');

  if (archive.entries.length) {
    L.push('## Archived');
    L.push('');
    L.push('| was | now | superseded by | why |');
    L.push('|---|---|---|---|');
    for (const e of archive.entries) {
      L.push(`| \`${e.formerPath}\` | \`${e.path}\` | \`${e.supersededBy}\` | ${e.reason} |`);
    }
    L.push('');
  }

  if (missing.length) {
    L.push('## Loaders pointing at nothing');
    L.push('');
    L.push('A path named in `src/` with no file on disk. Each one is a silent 404 at runtime.');
    L.push('');
    L.push('| path | named at |');
    L.push('|---|---|');
    for (const m of missing) L.push(`| \`${m.path}\` | ${m.sites.join(', ')} |`);
    L.push('');
  }

  L.push('## Families');
  L.push('');
  L.push('| family | what it is | files | SHIPPING | NOT WIRED | SUPERSEDED | size |');
  L.push('|---|---|--:|--:|--:|--:|--:|');
  for (const [fam, list] of [...fams].sort()) {
    const bytes = list.reduce((a, r) => a + r.bytes, 0);
    L.push(`| \`${fam}\` | ${FAMILY_NOTE[fam] || '—'} | ${list.length} | ${count(list, 'SHIPPING')} | ` +
      `${count(list, 'NOT WIRED')} | ${count(list, 'SUPERSEDED')} | ${mib(bytes)} |`);
  }
  L.push('');

  L.push('## Every asset');
  L.push('');
  for (const [fam, list] of [...fams].sort()) {
    L.push(`### \`${fam}\``);
    L.push('');
    L.push('| file | status | evidence |');
    L.push('|---|---|---|');
    for (const r of list.sort((a, b) => a.file.localeCompare(b.file))) {
      L.push(`| \`${r.file.slice(fam.length + 1)}\` | ${r.status} | ${r.evidence} |`);
    }
    L.push('');
  }
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------

export function archivedTargets() {
  const archive = readArchive();
  // BOTH paths. A loader still naming `Assets/models/hero/v4/...` is the exact
  // mistake the move is meant to stop, and after the move that path resolves to
  // nothing, so it would fail silently rather than loudly.
  return archive.entries.flatMap((e) => [e.path, e.formerPath]).filter(Boolean);
}

// The scanner, taken apart so a control can run it over a fixture line without
// touching the repo. A check that can only be exercised by breaking the tree is
// a check nobody exercises.
export function scanLinesForArchived(lines, targets, label = 'fixture') {
  const hits = [];
  lines.forEach((line, i) => {
    for (const t of targets) {
      if (line.includes(t)) hits.push({ file: label, line: i + 1, target: t, text: line.trim() });
    }
  });
  return hits;
}

export function checkArchivedReferences() {
  const targets = archivedTargets();
  const hits = [];
  if (!targets.length) return hits;
  for (const file of codeFiles()) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    hits.push(...scanLinesForArchived(lines, targets, rel(file)));
  }
  // The staging manifest is the other way an archived asset reaches the game:
  // it does not live in src/, but a `from` pointing into the archive would put
  // a dead GLB into vendor/models on the next build.
  const mf = abs('tools/vendor-models.manifest.json');
  if (fs.existsSync(mf)) {
    const entries = JSON.parse(fs.readFileSync(mf, 'utf8'));
    for (const e of entries) {
      for (const t of targets) {
        if (String(e.from).startsWith(t)) {
          hits.push({ file: 'tools/vendor-models.manifest.json', line: 0, target: t, text: `${e.from} -> ${e.to}` });
        }
      }
    }
  }
  return hits;
}

const MANIFEST_PATH = 'Assets/MANIFEST.md';

function main() {
  const args = process.argv.slice(2);
  const inv = inventory();
  const text = renderManifest(inv);

  if (args.includes('--write')) {
    fs.writeFileSync(abs(MANIFEST_PATH), text);
    console.log(`wrote ${MANIFEST_PATH}: ${inv.rows.length} assets, ${inv.missing.length} dead loaders`);
    return;
  }

  if (args.includes('--check')) {
    let bad = 0;
    const hits = checkArchivedReferences();
    if (hits.length) {
      bad += 1;
      console.error(`ARCHIVED PATH REFERENCED (${hits.length}):`);
      for (const h of hits) console.error(`  ${h.file}:${h.line}  -> ${h.target}\n      ${h.text}`);
    }
    const onDisk = fs.existsSync(abs(MANIFEST_PATH)) ? fs.readFileSync(abs(MANIFEST_PATH), 'utf8') : '';
    if (onDisk !== text) {
      bad += 1;
      console.error(`${MANIFEST_PATH} is stale — run: node tools/asset-manifest.mjs --write`);
    }
    if (bad) process.exit(1);
    console.log(`asset manifest ok: ${inv.rows.length} assets, no archived references`);
    return;
  }

  process.stdout.write(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
