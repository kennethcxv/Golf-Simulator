#!/usr/bin/env node
// GLB technical inspector: reads the glTF JSON chunk straight out of the container
// and reports geometry/material/texture/socket facts without needing Blender.
// Usage: node tools/qa/glb-inspect.mjs <glob-root...> [--json out.json]
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out);
    } else if (e.name.toLowerCase().endsWith('.glb')) {
      out.push(p);
    }
  }
  return out;
}

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 12) throw new Error('too small');
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('bad magic (not GLB)');
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  let off = 12;
  let json = null;
  let binLen = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (start + len > buf.length) break;
    if (type === 0x4e4f534a) json = JSON.parse(buf.slice(start, start + len).toString('utf8'));
    else if (type === 0x004e4942) binLen = len;
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, version, total, binLen, size: buf.length };
}

// PNG/JPEG dimension sniffing from an embedded buffer view
function imageDims(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: 'png' };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), fmt: 'jpg' };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function inspect(file) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  let g;
  try { g = readGlb(file); } catch (err) { return { file: rel, error: String(err.message) }; }
  const j = g.json;
  const acc = j.accessors || [];
  const meshes = j.meshes || [];

  let tris = 0, verts = 0, prims = 0;
  for (const m of meshes) {
    for (const p of m.primitives || []) {
      prims++;
      const mode = p.mode === undefined ? 4 : p.mode;
      const posIdx = p.attributes && p.attributes.POSITION;
      const vcount = posIdx !== undefined && acc[posIdx] ? acc[posIdx].count : 0;
      verts += vcount;
      let icount = p.indices !== undefined && acc[p.indices] ? acc[p.indices].count : vcount;
      if (mode === 4) tris += Math.floor(icount / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, icount - 2);
    }
  }

  // textures
  const buffers = (() => {
    // re-read bin chunk for image dims
    const raw = fs.readFileSync(file);
    let off = 12, bin = null;
    while (off + 8 <= raw.length) {
      const len = raw.readUInt32LE(off), type = raw.readUInt32LE(off + 4), start = off + 8;
      if (type === 0x004e4942) { bin = raw.slice(start, start + len); break; }
      off = start + len + ((4 - (len % 4)) % 4);
    }
    return bin;
  })();

  const textures = [];
  for (const img of j.images || []) {
    let dims = null;
    if (img.bufferView !== undefined && buffers && j.bufferViews) {
      const bv = j.bufferViews[img.bufferView];
      if (bv) {
        const slice = buffers.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
        dims = imageDims(slice);
      }
    }
    textures.push({ name: img.name || img.uri || '(embedded)', mime: img.mimeType, ...(dims || {}) });
  }

  const nodeNames = (j.nodes || []).map((n) => n.name).filter(Boolean);
  // socket-ish nodes: empties (no mesh) with suggestive names
  const sockets = (j.nodes || [])
    .filter((n) => n.mesh === undefined && n.name && /socket|slot|anchor|mount|hook|peg|attach|snap|carry|grip|hinge|pivot/i.test(n.name))
    .map((n) => n.name);

  const badNames = nodeNames.filter((n) => /^(Cube|Sphere|Cylinder|Plane|Empty|Object|Circle|Cone|Torus)(\.\d+)?$/i.test(n));
  const badMats = (j.materials || []).map((m) => m.name).filter((n) => n && /^Material(\.\d+)?$/i.test(n));

  return {
    file: rel,
    sizeKB: +(g.size / 1024).toFixed(1),
    meshes: meshes.length,
    primitives: prims,
    tris,
    verts,
    materials: (j.materials || []).length,
    materialNames: (j.materials || []).map((m) => m.name || '(unnamed)'),
    textures: textures.length,
    textureDims: textures.map((t) => (t.w ? `${t.w}x${t.h}` : '?')),
    nodes: (j.nodes || []).length,
    sockets,
    animations: (j.animations || []).length,
    cameras: (j.cameras || []).length,
    lights: ((j.extensions || {}).KHR_lights_punctual || {}).lights?.length || 0,
    badNames,
    badMats,
    generator: (j.asset || {}).generator || '',
  };
}

const args = process.argv.slice(2);
const jsonOutIdx = args.indexOf('--json');
let jsonOut = null;
if (jsonOutIdx >= 0) { jsonOut = args[jsonOutIdx + 1]; args.splice(jsonOutIdx, 2); }
const roots = args.length ? args : ['.'];

let files = [];
for (const r of roots) {
  const st = fs.existsSync(r) ? fs.statSync(r) : null;
  if (!st) continue;
  if (st.isDirectory()) files.push(...walk(r));
  else files.push(r);
}
files = [...new Set(files)].sort();

const results = files.map(inspect);
if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
}

const ok = results.filter((r) => !r.error);
const bad = results.filter((r) => r.error);
console.log(`GLB files: ${results.length}  parsed: ${ok.length}  errors: ${bad.length}`);
console.log(`Total tris: ${ok.reduce((a, r) => a + r.tris, 0).toLocaleString()}`);
for (const r of bad) console.log(`  !! ${r.file}: ${r.error}`);
const flagged = ok.filter((r) => r.cameras || r.lights || r.badNames.length || r.badMats.length);
if (flagged.length) {
  console.log(`\nSHIP-GATE FLAGS (${flagged.length}):`);
  for (const r of flagged) {
    const f = [];
    if (r.cameras) f.push(`${r.cameras} camera(s)`);
    if (r.lights) f.push(`${r.lights} light(s)`);
    if (r.badNames.length) f.push(`generic names: ${r.badNames.slice(0, 4).join(',')}${r.badNames.length > 4 ? `+${r.badNames.length - 4}` : ''}`);
    if (r.badMats.length) f.push(`generic mats: ${r.badMats.slice(0, 3).join(',')}`);
    console.log(`  ${r.file}: ${f.join(' | ')}`);
  }
}
if (jsonOut) console.log(`\nwrote ${jsonOut}`);
