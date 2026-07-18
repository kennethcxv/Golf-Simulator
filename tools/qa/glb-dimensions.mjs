#!/usr/bin/env node
// Measures GLB world-space bounding boxes by walking the node graph and applying
// transforms to each primitive's POSITION accessor min/max. Reports size in cm so
// results compare directly against the reference sheets.
import fs from 'node:fs';
import path from 'node:path';

function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not GLB');
  let off = 12, json = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), start = off + 8;
    if (type === 0x4e4f534a) { json = JSON.parse(buf.slice(start, start + len).toString('utf8')); break; }
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('no JSON chunk');
  return json;
}

const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) { // column-major 4x4
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0,0,0];
  const q = n.rotation || [0,0,0,1];
  const s = n.scale || [1,1,1];
  const [x,y,z,w] = q;
  const x2=x+x, y2=y+y, z2=z+z;
  const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2, wx=w*x2, wy=w*y2, wz=w*z2;
  return [
    (1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
    (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
    (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function xform(m, p) {
  return [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2] + m[12],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2] + m[13],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14],
  ];
}

function measure(file) {
  const j = readGlbJson(file);
  const acc = j.accessors || [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let any = false;

  const visit = (idx, parent) => {
    const n = (j.nodes || [])[idx];
    if (!n) return;
    const world = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      const mesh = (j.meshes || [])[n.mesh];
      for (const p of (mesh && mesh.primitives) || []) {
        const pi = p.attributes && p.attributes.POSITION;
        const a = pi !== undefined ? acc[pi] : null;
        if (!a || !a.min || !a.max) continue;
        // all 8 corners of the local AABB, transformed
        for (let i = 0; i < 8; i++) {
          const c = [
            i & 1 ? a.max[0] : a.min[0],
            i & 2 ? a.max[1] : a.min[1],
            i & 4 ? a.max[2] : a.min[2],
          ];
          const w = xform(world, c);
          for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
          any = true;
        }
      }
    }
    for (const c of n.children || []) visit(c, world);
  };

  const scene = (j.scenes || [])[j.scene || 0];
  const roots = (scene && scene.nodes) || (j.nodes || []).map((_, i) => i);
  for (const r of roots) visit(r, IDENT);

  if (!any) return { file: path.relative(process.cwd(), file).replace(/\\/g, '/'), empty: true };
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
    // glTF is Y-up, metres. Report cm.
    width_cm: +(size[0] * 100).toFixed(1),
    height_cm: +(size[1] * 100).toFixed(1),
    depth_cm: +(size[2] * 100).toFixed(1),
    min_y_cm: +(min[1] * 100).toFixed(2),
    origin_offset_cm: {
      x: +(((min[0] + max[0]) / 2) * 100).toFixed(2),
      z: +(((min[2] + max[2]) / 2) * 100).toFixed(2),
    },
  };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p, out); }
    else if (e.name.toLowerCase().endsWith('.glb')) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const ji = args.indexOf('--json');
let jsonOut = null;
if (ji >= 0) { jsonOut = args[ji + 1]; args.splice(ji, 2); }
let files = [];
for (const r of args.length ? args : ['.']) {
  if (!fs.existsSync(r)) continue;
  files.push(...(fs.statSync(r).isDirectory() ? walk(r) : [r]));
}
const results = files.sort().map((f) => { try { return measure(f); } catch (e) { return { file: f, error: e.message }; } });
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2)); }
for (const r of results) {
  if (r.error) { console.log(`!! ${r.file}: ${r.error}`); continue; }
  if (r.empty) { console.log(`   ${path.basename(r.file).padEnd(34)} (no geometry)`); continue; }
  console.log(`   ${path.basename(r.file).padEnd(34)} ${String(r.width_cm).padStart(7)}W x ${String(r.depth_cm).padStart(7)}D x ${String(r.height_cm).padStart(7)}H cm   baseY=${String(r.min_y_cm).padStart(7)}`);
}
if (jsonOut) console.log(`\nwrote ${jsonOut}`);
