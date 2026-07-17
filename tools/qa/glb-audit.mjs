// GLB ASSET AUDIT — reads every .glb under vendor/models and reports the numbers that decide
// whether a build is shippable: triangles, materials, textures, node/mesh counts, bounds, and
// the things that must NEVER be in a game asset — exported cameras and lights.
//
// It parses the GLB container and its glTF JSON chunk directly (no three.js, no GPU), so it runs
// in plain Node and can gate CI. Run: node tools/qa/glb-audit.mjs [--json] [--all] [dir]
//
// Budgets below are the "flag it for a look" thresholds for this game's stylised assets, not hard
// limits — an asset over budget is printed with a reason, not deleted.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const showAll = args.includes('--all');
const dirArg = args.find((a) => !a.startsWith('--'));
const SCAN_DIR = join(ROOT, dirArg || 'vendor/models');

const BUDGET = {
  triangles: 20000,   // one display asset; crowds/instancing multiply this
  materials: 12,
  textures: 8,
  nodes: 120,
  farFromOrigin: 12,  // metres — a mesh centre this far out is usually an authoring mistake
  maxDim: 16,         // metres — a single asset bigger than this is suspicious indoors
};

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.toLowerCase().endsWith('.glb')) out.push(p);
  }
  return out;
}

// Parse the GLB container: 12-byte header, then a JSON chunk (and usually a BIN chunk).
function parseGlbJson(buf) {
  if (buf.length < 12) throw new Error('too short');
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('bad magic (not glTF)');
  const version = buf.readUInt32LE(4);
  let offset = 12;
  let json = null;
  let binLength = 0;
  while (offset + 8 <= buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLen;
    if (chunkType === 0x4e4f534a) json = JSON.parse(buf.slice(start, end).toString('utf8')); // 'JSON'
    else if (chunkType === 0x004e4942) binLength = chunkLen; // 'BIN\0'
    offset = end + (end % 4 === 0 ? 0 : 4 - (end % 4));
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, version, binLength };
}

function auditGlb(path) {
  const buf = readFileSync(path);
  const { json, version } = parseGlbJson(buf);
  const accessors = json.accessors || [];
  const meshes = json.meshes || [];

  // triangles: unique mesh geometry (indexed → indices/3, else positions/3), TRIANGLES mode only
  let triangles = 0;
  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of meshes) {
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode == null ? 4 : prim.mode;
      const posIdx = prim.attributes && prim.attributes.POSITION;
      if (posIdx != null && accessors[posIdx]) {
        const a = accessors[posIdx];
        if (Array.isArray(a.min) && Array.isArray(a.max)) {
          for (let k = 0; k < 3; k++) { bbox.min[k] = Math.min(bbox.min[k], a.min[k]); bbox.max[k] = Math.max(bbox.max[k], a.max[k]); }
        }
        if (mode === 4) {
          const count = prim.indices != null && accessors[prim.indices] ? accessors[prim.indices].count : a.count;
          triangles += Math.floor(count / 3);
        }
      }
    }
  }
  const dims = bbox.min[0] === Infinity ? [0, 0, 0] : [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];
  const center = bbox.min[0] === Infinity ? [0, 0, 0] : [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
  const materials = json.materials || [];

  const rec = {
    file: relative(ROOT, path).split(sep).join('/'),
    kb: Math.round(buf.length / 1024),
    version,
    nodes: (json.nodes || []).length,
    meshes: meshes.length,
    triangles,
    materials: materials.length,
    doubleSided: materials.filter((m) => m.doubleSided).length,
    blended: materials.filter((m) => m.alphaMode === 'BLEND').length,
    textures: (json.textures || []).length,
    images: (json.images || []).length,
    animations: (json.animations || []).length,
    cameras: (json.cameras || []).length,
    lights: (((json.extensions || {}).KHR_lights_punctual || {}).lights || []).length,
    maxDim: +Math.max(...dims).toFixed(2),
    centerOffset: +Math.hypot(...center).toFixed(2),
  };

  const flags = [];
  if (rec.cameras > 0) flags.push(`${rec.cameras} exported CAMERA`);
  if (rec.lights > 0) flags.push(`${rec.lights} exported LIGHT`);
  if (rec.triangles > BUDGET.triangles) flags.push(`${rec.triangles} tris > ${BUDGET.triangles}`);
  if (rec.materials > BUDGET.materials) flags.push(`${rec.materials} materials > ${BUDGET.materials}`);
  if (rec.textures > BUDGET.textures) flags.push(`${rec.textures} textures > ${BUDGET.textures}`);
  if (rec.nodes > BUDGET.nodes) flags.push(`${rec.nodes} nodes > ${BUDGET.nodes}`);
  if (rec.maxDim > BUDGET.maxDim) flags.push(`${rec.maxDim}m across > ${BUDGET.maxDim}m`);
  if (rec.centerOffset > BUDGET.farFromOrigin) flags.push(`centre ${rec.centerOffset}m from origin`);
  rec.flags = flags;
  return rec;
}

export { auditGlb, walk, parseGlbJson, BUDGET };

// Everything below is the CLI; skip it when this module is imported (e.g. by a test).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) { /* imported as a library */ } else {

const files = walk(SCAN_DIR).sort();
const records = [];
const errors = [];
for (const f of files) {
  try { records.push(auditGlb(f)); } catch (e) { errors.push({ file: relative(ROOT, f).split(sep).join('/'), error: e.message }); }
}

const flagged = records.filter((r) => r.flags.length);
const totals = records.reduce((a, r) => ({
  triangles: a.triangles + r.triangles, materials: a.materials + r.materials,
  textures: a.textures + r.textures, kb: a.kb + r.kb,
}), { triangles: 0, materials: 0, textures: 0, kb: 0 });

if (asJson) {
  console.log(JSON.stringify({ scanned: records.length, flagged: flagged.length, errors, totals, records }, null, 2));
} else {
  console.log(`GLB AUDIT — ${records.length} assets under ${relative(ROOT, SCAN_DIR).split(sep).join('/')}`);
  console.log(`  totals: ${totals.triangles.toLocaleString()} tris · ${totals.materials} materials · ${totals.textures} textures · ${(totals.kb / 1024).toFixed(1)} MB\n`);
  if (errors.length) {
    console.log(`UNREADABLE (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e.file} — ${e.error}`);
    console.log('');
  }
  if (flagged.length) {
    console.log(`FLAGGED (${flagged.length}):`);
    for (const r of flagged.sort((a, b) => b.triangles - a.triangles)) {
      console.log(`  ⚠ ${r.file}  [${r.kb}KB, ${r.triangles} tris, ${r.materials} mat, ${r.textures} tex]`);
      for (const fl of r.flags) console.log(`      → ${fl}`);
    }
    console.log('');
  } else {
    console.log('No assets exceeded budget or carried cameras/lights.\n');
  }
  if (showAll) {
    console.log('ALL ASSETS (by triangles):');
    for (const r of [...records].sort((a, b) => b.triangles - a.triangles)) {
      console.log(`  ${String(r.triangles).padStart(6)} tris  ${String(r.materials).padStart(2)}m ${String(r.textures).padStart(2)}t  ${r.file}`);
    }
  }
}
// non-zero exit if any asset carries a camera or light (the never-ship offenders)
const hardFails = records.filter((r) => r.cameras > 0 || r.lights > 0);
process.exitCode = hardFails.length ? 1 : 0;

}
