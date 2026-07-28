// What is each pro-shop asset actually made of? A geometry-level audit of the whole
// population, not a sample.
//
//   node tools/qa/proshop-construction-audit.mjs
//   node tools/qa/proshop-construction-audit.mjs --out Designs/ProShop/Discriminator/data/construction.json
//
// The question this exists to answer: the room's assets differ widely in quality, and
// before spending a twelve-file texture pass we need to know which MEASURED property the
// quality difference tracks. Asserting "it's the textures" from two hand-picked anchors
// has already produced one wrong conclusion, so this reads every asset in the set and
// reports every candidate property side by side.
//
// Reads GLB bytes directly with Node built-ins. Never rewrites an asset.
//
// Two of the measurements below are not standard glTF statistics and are worth stating
// plainly, because the conclusions lean on them.
//
// SHELLS vs PARTS. A glTF node holding a mesh is one thing the runtime can move. That
// mesh may contain any number of disconnected islands of geometry welded into a single
// buffer. `parts` counts nodes; `shells` counts connected components of the triangle
// graph after welding coincident positions. shells > parts means the author built several
// physical objects and merged them, which is invisible in a triangle count and is exactly
// the "merged mesh" property under test. Their ratio is the merge factor.
//
// BEVELS. Blender splits vertices at hard edges on export, so index-based adjacency
// cannot see across a seam; adjacency here is rebuilt by welding positions onto a grid
// derived from the asset's own size. For every edge shared by exactly two faces we take
// the dihedral angle. An unbevelled box has only 0 degree (coplanar) and 90 degree
// (corner) edges and nothing in between. A chamfer splits each 90 into two ~45s; a
// three-segment bevel into ~30s. So a population of edges between 12 and 75 degrees IS
// the bevel, and its absence is the absence of bevels. Width is the median altitude from
// the narrow adjacent face to the shared edge, in source metres, reported in millimetres
// because that is the unit a bevel is authored in.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

// Every sheet_07-10 prop. Sheet 06 is the architectural shell (walls, floors, ceilings),
// built by a different pipeline against different constraints, so it is not in the
// population; sheets 07-10 are the props, all four built by sibling scripts in
// tools/blender/build_assets_*.py, which makes a construction difference between them
// something a builder can act on.
const SHEETS = ['sheet_07', 'sheet_08', 'sheet_09', 'sheet_10'];
// The runtime loads from vendor/models (sheet07Manifest.js pins the prefix and
// bindings.js:109 asserts it), so that is the default: audit what ships. Assets/ is the
// authoring copy and the two have already drifted — asset_065's vendor copy is the Arm I
// rebuild at 2.5 MB against a 68 KB original. `--dir` switches between them.
const GLB_DIR = path.join('vendor', 'models', 'assets_51_100');
const SOURCE_DIR = path.join('tools', 'blender');

const COMPONENTS_PER_TYPE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENT_READER = {
  5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16',
  5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32',
};

function parseGlb(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === JSON_CHUNK) json = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
    if (type === BIN_CHUNK) bin = buffer.subarray(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function readAccessor(json, bin, index) {
  const accessor = (json.accessors || [])[index];
  if (!accessor || accessor.bufferView == null) return null;
  const view = (json.bufferViews || [])[accessor.bufferView];
  if (!view || !bin) return null;
  const components = COMPONENTS_PER_TYPE[accessor.type] || 1;
  const bytes = COMPONENT_BYTES[accessor.componentType];
  const reader = COMPONENT_READER[accessor.componentType];
  if (!bytes || !reader) return null;
  const elementSize = components * bytes;
  const stride = view.byteStride || elementSize;
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float64Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < components; c += 1) {
      out[i * components + c] = dv[reader](base + i * stride + c * bytes, true);
    }
  }
  return { data: out, components, count: accessor.count };
}

function localMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const x2 = qx + qx; const y2 = qy + qy; const z2 = qz + qz;
  const xx = qx * x2; const xy = qx * y2; const xz = qx * z2;
  const yy = qy * y2; const yz = qy * z2; const zz = qz * z2;
  const wx = qw * x2; const wy = qw * y2; const wz = qw * z2;
  // Column-major, matching glTF.
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function applyMatrix(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

const isCollision = (name) => /^(COL|UCX|UBX|USP|UCP)[_-]|collision/i.test(name || '');
const isSocket = (name) => /(^SOCKET[_-]|^ANCHOR[_-]|^SLOT[_-])/i.test(name || '');

// --- geometry analysis -------------------------------------------------------------

class UnionFind {
  constructor(n) { this.parent = new Int32Array(n); for (let i = 0; i < n; i += 1) this.parent[i] = i; }
  find(a) { let r = a; while (this.parent[r] !== r) r = this.parent[r]; while (this.parent[a] !== r) { const n = this.parent[a]; this.parent[a] = r; a = n; } return r; }
  union(a, b) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.parent[rb] = ra; }
}

export function analyseGeometry(positions, indices, weldGrid, diagonal) {
  // Weld coincident positions so adjacency survives Blender's hard-edge vertex split.
  const map = new Map();
  const weldOf = new Int32Array(positions.length / 3);
  let welded = 0;
  const weldPos = [];
  for (let i = 0; i < positions.length / 3; i += 1) {
    const key = `${Math.round(positions[i * 3] / weldGrid)},${Math.round(positions[i * 3 + 1] / weldGrid)},${Math.round(positions[i * 3 + 2] / weldGrid)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = welded;
      welded += 1;
      map.set(key, id);
      weldPos.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    weldOf[i] = id;
  }

  const faceCount = indices.length / 3;
  const uf = new UnionFind(welded);
  const edges = new Map();   // welded edge key -> [faceA, faceB]
  const normals = new Float64Array(faceCount * 3);

  for (let f = 0; f < faceCount; f += 1) {
    const a = weldOf[indices[f * 3]];
    const b = weldOf[indices[f * 3 + 1]];
    const c = weldOf[indices[f * 3 + 2]];
    uf.union(a, b); uf.union(b, c);
    const ax = weldPos[a * 3]; const ay = weldPos[a * 3 + 1]; const az = weldPos[a * 3 + 2];
    const bx = weldPos[b * 3]; const by = weldPos[b * 3 + 1]; const bz = weldPos[b * 3 + 2];
    const cx = weldPos[c * 3]; const cy = weldPos[c * 3 + 1]; const cz = weldPos[c * 3 + 2];
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    normals[f * 3] = nx; normals[f * 3 + 1] = ny; normals[f * 3 + 2] = nz;
    const tri = [a, b, c];
    for (let e = 0; e < 3; e += 1) {
      const p = tri[e]; const q = tri[(e + 1) % 3];
      if (p === q) continue;
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      const slot = edges.get(key);
      if (slot === undefined) edges.set(key, [f, -1]);
      else if (slot[1] === -1) slot[1] = f;
      else slot.push(f);
    }
  }

  const shells = new Set();
  for (let i = 0; i < welded; i += 1) shells.add(uf.find(i));

  // Face areas and manifold edge list with dihedral angles.
  const areas = new Float64Array(faceCount);
  for (let f = 0; f < faceCount; f += 1) {
    const a = weldOf[indices[f * 3]]; const b = weldOf[indices[f * 3 + 1]]; const c = weldOf[indices[f * 3 + 2]];
    const ux = weldPos[b * 3] - weldPos[a * 3]; const uy = weldPos[b * 3 + 1] - weldPos[a * 3 + 1]; const uz = weldPos[b * 3 + 2] - weldPos[a * 3 + 2];
    const vx = weldPos[c * 3] - weldPos[a * 3]; const vy = weldPos[c * 3 + 1] - weldPos[a * 3 + 1]; const vz = weldPos[c * 3 + 2] - weldPos[a * 3 + 2];
    areas[f] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }

  const manifold = [];
  for (const [key, faces] of edges) {
    if (faces.length !== 2 || faces[1] === -1) continue;
    const [f0, f1] = faces;
    const dot = Math.max(-1, Math.min(1,
      normals[f0 * 3] * normals[f1 * 3]
      + normals[f0 * 3 + 1] * normals[f1 * 3 + 1]
      + normals[f0 * 3 + 2] * normals[f1 * 3 + 2]));
    const [pi, qi] = key.split('_').map(Number);
    const elen = Math.hypot(
      weldPos[qi * 3] - weldPos[pi * 3],
      weldPos[qi * 3 + 1] - weldPos[pi * 3 + 1],
      weldPos[qi * 3 + 2] - weldPos[pi * 3 + 2]) || 0;
    manifold.push({ f0, f1, deg: (Math.acos(dot) * 180) / Math.PI, pi, qi, elen });
  }

  // Flat regions: faces welded across near-coplanar edges. This is what separates a
  // CHAMFER from a TESSELLATED CURVE. A 16-segment cylinder has a ~22 degree turn at
  // every segment boundary and would otherwise read as a beveled edge at every one of
  // them; grouping into regions makes the cylinder's wall a chain of narrow strips with
  // no flat neighbour, while a real chamfer is a narrow strip WITH a flat face either
  // side. Only the second is a bevel.
  const rf = new UnionFind(faceCount);
  for (const e of manifold) if (e.deg < 5) rf.union(e.f0, e.f1);
  const regionArea = new Map();
  const regionPerim = new Map();
  for (let f = 0; f < faceCount; f += 1) {
    const r = rf.find(f);
    regionArea.set(r, (regionArea.get(r) || 0) + areas[f]);
  }
  for (const e of manifold) {
    if (e.deg < 5) continue;
    for (const f of [e.f0, e.f1]) {
      const r = rf.find(f);
      regionPerim.set(r, (regionPerim.get(r) || 0) + e.elen);
    }
  }
  let totalArea = 0;
  for (const a of regionArea.values()) totalArea += a;
  // Hydraulic width 2A/P: for a w-by-L strip this is ~w, which is the chamfer width.
  const regionWidth = new Map();
  for (const [r, a] of regionArea) {
    const p = regionPerim.get(r) || 0;
    regionWidth.set(r, p > 0 ? (2 * a) / p : Infinity);
  }
  const bigArea = totalArea * 0.002;          // 0.2% of surface reads as a face, not a strip
  const stripMax = Math.max(diagonal * 0.02, 0.0005);
  const isBig = (r) => (regionArea.get(r) || 0) >= bigArea && (regionWidth.get(r) || 0) > stripMax;
  const isStrip = (r) => (regionWidth.get(r) || Infinity) <= stripMax;

  let coplanar = 0;
  let hardCorners = 0;
  let bevelCorners = 0;
  const bevelWidths = [];
  for (const e of manifold) {
    if (e.deg < 1) { coplanar += 1; continue; }
    const r0 = rf.find(e.f0); const r1 = rf.find(e.f1);
    if (r0 === r1) continue;
    const big0 = isBig(r0); const big1 = isBig(r1);
    if (e.deg >= 60 && big0 && big1) {
      // Two real faces meeting directly at a sharp angle: an unbevelled corner. The
      // threshold is 60 rather than 45 so that a chamfer wide enough to read as a face
      // in its own right is not counted as the corner it removed.
      hardCorners += 1;
      continue;
    }
    if (e.deg >= 12 && e.deg < 75 && (big0 !== big1)) {
      // A narrow strip against a real face: one side of a chamfer.
      const strip = big0 ? r1 : r0;
      if (!isStrip(strip)) continue;
      bevelCorners += 1;
      bevelWidths.push(regionWidth.get(strip));
    }
  }
  // Each chamfer is met twice, once from each flanking face.
  bevelCorners = Math.round(bevelCorners / 2);

  // How much of the surface is genuine flat plane rather than smoothly curved shell? A
  // form modelled as planes and edges has most of its area in a few big regions; a form
  // sculpted as a rounded blob has it spread over hundreds of tiny facets. The two look
  // completely different and nothing else measured here tells them apart.
  let flatArea = 0;
  let largestRegion = 0;
  for (const [r, a] of regionArea) {
    if (a >= bigArea && (regionWidth.get(r) || 0) > stripMax) flatArea += a;
    if (a > largestRegion) largestRegion = a;
  }

  return {
    shells: shells.size,
    weldedVerts: welded,
    faces: faceCount,
    surfaceArea: totalArea,
    regions: regionArea.size,
    flatArea,
    largestRegionArea: largestRegion,
    coplanar,
    hardCorners,
    bevelCorners,
    bevelWidths,
  };
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};

// --- per-asset audit ---------------------------------------------------------------

export function auditAsset(glbPath) {
  const abs = path.resolve(ROOT, glbPath);
  const bytes = readFileSync(abs);
  const { json, bin } = parseGlb(bytes);
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  const materials = json.materials || [];
  const images = json.images || [];

  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const worldCache = new Map();
  const world = (i) => {
    if (worldCache.has(i)) return worldCache.get(i);
    const own = localMatrix(nodes[i] || {});
    const m = parent[i] >= 0 ? multiply(world(parent[i]), own) : own;
    worldCache.set(i, m);
    return m;
  };

  // First pass: bounds, so the weld grid scales with the asset rather than being a
  // constant that is too coarse for a clipboard and too fine for a sofa.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visibleNodes = [];
  nodes.forEach((node, i) => {
    if (!Number.isInteger(node.mesh)) return;
    const name = node.name || `Node_${i}`;
    if (isCollision(name)) return;
    visibleNodes.push({ index: i, name });
    for (const prim of meshes[node.mesh]?.primitives || []) {
      const acc = (json.accessors || [])[prim.attributes?.POSITION];
      if (!acc?.min || !acc?.max) continue;
      const m = world(i);
      for (const corner of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
        const p = applyMatrix(m,
          corner[0] ? acc.max[0] : acc.min[0],
          corner[1] ? acc.max[1] : acc.min[1],
          corner[2] ? acc.max[2] : acc.min[2]);
        for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
      }
    }
  });
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => (Number.isFinite(v) ? v : 0));
  const longest = Math.max(...size, 0.01);
  const weldGrid = longest * 2e-4;   // ~0.2 mm on a metre-scale prop

  let triangles = 0;
  let shells = 0;
  let coplanar = 0;
  let hardCorners = 0;
  let bevelCorners = 0;
  let surfaceArea = 0;
  let flatArea = 0;
  let regions = 0;
  let largestRegionArea = 0;
  const bevelWidths = [];
  const usedMaterials = new Set();
  const areaByMaterial = new Map();
  const perPart = [];

  for (const { index, name } of visibleNodes) {
    const node = nodes[index];
    const m = world(index);
    let partTris = 0;
    let partShells = 0;
    let partBevel = 0;
    let partHard = 0;
    for (const prim of meshes[node.mesh]?.primitives || []) {
      if (Number.isInteger(prim.material)) usedMaterials.add(prim.material);
      const pos = readAccessor(json, bin, prim.attributes?.POSITION);
      if (!pos) continue;
      // World-space positions, so a bevel authored on a scaled node reports its real width.
      const worldPos = new Float64Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        const p = applyMatrix(m, pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2]);
        worldPos[i * 3] = p[0]; worldPos[i * 3 + 1] = p[1]; worldPos[i * 3 + 2] = p[2];
      }
      let idx;
      if (Number.isInteger(prim.indices)) {
        const acc = readAccessor(json, bin, prim.indices);
        idx = acc ? Array.from(acc.data) : null;
      } else {
        idx = Array.from({ length: pos.count }, (_, i) => i);
      }
      if (!idx || (prim.mode ?? 4) !== 4) continue;
      const g = analyseGeometry(worldPos, idx, weldGrid, longest);
      if (Number.isInteger(prim.material)) {
        areaByMaterial.set(prim.material, (areaByMaterial.get(prim.material) || 0) + g.surfaceArea);
      }
      triangles += g.faces;
      partTris += g.faces;
      shells += g.shells;
      partShells += g.shells;
      coplanar += g.coplanar;
      surfaceArea += g.surfaceArea;
      flatArea += g.flatArea;
      regions += g.regions;
      largestRegionArea = Math.max(largestRegionArea, g.largestRegionArea);
      hardCorners += g.hardCorners;
      partHard += g.hardCorners;
      bevelCorners += g.bevelCorners;
      partBevel += g.bevelCorners;
      bevelWidths.push(...g.bevelWidths);
    }
    perPart.push({ name, tris: partTris, shells: partShells, bevelCorners: partBevel, hardCorners: partHard });
  }

  const texturedMaterials = [...usedMaterials].filter((i) => {
    const mat = materials[i] || {};
    const p = mat.pbrMetallicRoughness || {};
    return !!(p.baseColorTexture || p.metallicRoughnessTexture || mat.normalTexture
      || mat.occlusionTexture || mat.emissiveTexture);
  });
  const withFactor = [...usedMaterials].filter((i) => Array.isArray(materials[i]?.pbrMetallicRoughness?.baseColorFactor));

  // How much visible contrast does the asset carry WITHIN itself? A count of materials
  // says nothing here -- five shades of the same brown is five materials and one colour.
  // What the eye reads is the spread of lightness across the surface, so each material's
  // base colour is converted to an sRGB code value and the spread is taken weighted by
  // the surface area actually painted with it.
  const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055);
  const swatches = [];
  let areaTotal = 0;
  for (const [mi, area] of areaByMaterial) {
    const f = materials[mi]?.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
    const luma = 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    const code = Math.round(Math.min(1, Math.max(0, toSrgb(luma))) * 255);
    const emissive = materials[mi]?.emissiveFactor;
    swatches.push({
      material: materials[mi]?.name || `Material_${mi}`,
      areaM2: +area.toFixed(4),
      lumaCode: code,
      hex: `#${f.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`,
      emissive: Array.isArray(emissive) && emissive.some((v) => v > 0.01),
    });
    areaTotal += area;
  }
  let lumaMean = 0;
  for (const s of swatches) lumaMean += (s.lumaCode * s.areaM2) / (areaTotal || 1);
  let lumaVar = 0;
  for (const s of swatches) lumaVar += (((s.lumaCode - lumaMean) ** 2) * s.areaM2) / (areaTotal || 1);
  const codes = swatches.map((s) => s.lumaCode);
  // A swatch below 8% of the surface is a detail accent -- piping, hardware, a lens.
  const accentSwatches = swatches.filter((s) => s.areaM2 / (areaTotal || 1) < 0.08);

  const socketNodes = nodes.filter((n) => isSocket(n.name)).map((n) => n.name);
  const collisionNodes = nodes.filter((n) => Number.isInteger(n.mesh) && isCollision(n.name)).map((n) => n.name);

  const widthsMm = bevelWidths.map((w) => w * 1000);
  return {
    file: glbPath.split(/[\\/]/).pop(),
    path: glbPath,
    bytes: bytes.length,
    sizeM: size.map((v) => +v.toFixed(4)),
    longestM: +longest.toFixed(4),
    parts: visibleNodes.length,
    shells,
    mergeFactor: visibleNodes.length ? +(shells / visibleNodes.length).toFixed(2) : null,
    triangles,
    trianglesPerPart: visibleNodes.length ? Math.round(triangles / visibleNodes.length) : null,
    materials: usedMaterials.size,
    texturedMaterials: texturedMaterials.length,
    materialsWithBaseColorFactor: withFactor.length,
    // Within-asset contrast, in sRGB code values.
    lumaSpreadSd: +Math.sqrt(lumaVar).toFixed(1),
    lumaSpreadRange: codes.length ? Math.max(...codes) - Math.min(...codes) : 0,
    accentMaterials: accentSwatches.length,
    accentAreaShare: +(accentSwatches.reduce((a, s) => a + s.areaM2, 0) / (areaTotal || 1)).toFixed(4),
    emissiveMaterials: swatches.filter((s) => s.emissive).length,
    swatches: swatches.sort((a, b) => b.areaM2 - a.areaM2),
    images: images.length,
    animations: (json.animations || []).length,
    animationNames: (json.animations || []).map((a, i) => a.name || `Animation_${i}`),
    skins: (json.skins || []).length,
    sockets: socketNodes.length,
    socketNames: socketNodes,
    collisionMeshes: collisionNodes.length,
    surfaceAreaM2: +surfaceArea.toFixed(4),
    // Share of the surface that is flat plane rather than smooth curvature. Low means
    // the asset was sculpted as a rounded blob.
    flatAreaShare: surfaceArea ? +(flatArea / surfaceArea).toFixed(3) : null,
    // Share held by the single largest flat plane. High means one big bare face.
    largestFaceShare: surfaceArea ? +(largestRegionArea / surfaceArea).toFixed(3) : null,
    flatRegions: regions,
    coplanarEdges: coplanar,
    hardCorners,
    bevelCorners,
    // Share of sharp corners given a chamfer instead of left as a bare hard edge.
    bevelRatio: (bevelCorners + hardCorners) ? +(bevelCorners / (bevelCorners + hardCorners)).toFixed(3) : null,
    bevelWidthMedianMm: widthsMm.length ? +median(widthsMm).toFixed(2) : null,
    bevelWidthP10Mm: widthsMm.length ? +pct(widthsMm, 10).toFixed(2) : null,
    bevelWidthP90Mm: widthsMm.length ? +pct(widthsMm, 90).toFixed(2) : null,
    perPart: perPart.sort((a, b) => b.tris - a.tris),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : null;
  const dirIndex = argv.indexOf('--dir');
  const glbDir = dirIndex >= 0 ? argv[dirIndex + 1] : GLB_DIR;

  const rows = [];
  for (const sheet of SHEETS) {
    const dir = path.join(ROOT, glbDir, sheet);
    if (!existsSync(dir)) continue;
    const files = require$readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.glb')) continue;
      const rel = path.join(glbDir, sheet, file);
      const number = Number(/asset_(\d+)/.exec(file)?.[1]);
      try {
        rows.push({ n: number, sheet, ...auditAsset(rel) });
      } catch (err) {
        rows.push({ n: number, sheet, file, error: String(err && err.message) });
      }
    }
  }
  rows.sort((a, b) => a.n - b.n);

  const report = { generatedBy: 'tools/qa/proshop-construction-audit.mjs', glbDir, sourceUnits: 'metres', sheets: SHEETS, sourceDir: SOURCE_DIR, count: rows.length, assets: rows };
  if (outPath) {
    mkdirSync(path.dirname(path.resolve(ROOT, outPath)), { recursive: true });
    writeFileSync(path.resolve(ROOT, outPath), `${JSON.stringify(report, null, 2)}\n`);
  }

  const head = ['n', 'asset', 'parts', 'shells', 'merge', 'tris', 'tris/part', 'mats', 'tex', 'bevels', 'hard', 'bevelR', 'bevelMm', 'anim', 'sock'];
  const widths = [4, 32, 6, 7, 6, 7, 10, 5, 4, 7, 6, 7, 8, 5, 5];
  const line = (cells) => cells.map((c, i) => String(c ?? '-').padEnd(widths[i])).join('');
  console.log(line(head));
  console.log('-'.repeat(widths.reduce((a, b) => a + b, 0)));
  for (const r of rows) {
    if (r.error) { console.log(line([r.n, r.file, 'ERROR: ' + r.error])); continue; }
    console.log(line([r.n, r.file.replace(/^asset_\d+_/, '').replace(/\.glb$/, ''),
      r.parts, r.shells, r.mergeFactor, r.triangles, r.trianglesPerPart, r.materials,
      r.texturedMaterials, r.bevelCorners, r.hardCorners, r.bevelRatio,
      r.bevelWidthMedianMm, r.animations, r.sockets]));
  }
  if (outPath) console.log(`\nwrote ${outPath}`);
}

// readdirSync via dynamic import keeps the top-level import list to what the audit needs.
import { readdirSync as require$readdir } from 'node:fs';

if (process.argv[1]?.endsWith('proshop-construction-audit.mjs')) main();
