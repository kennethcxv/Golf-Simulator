// CLUBHOUSE MATERIAL KIT — the shared, art-directed material library for the
// production clubhouse (DEV_LOG "PHASE 4: ART DIRECTION"). Everything visible
// inside the building draws from THIS module so wood reads as one species,
// plaster as one wall, brass as one metal. Textures are canvas-procedural in
// the repo's established idiom (deterministic, no binary assets); a photo-
// texture pass can swap them slot-for-slot later.

import * as THREE from 'three';

// ---------------------------------------------------------------- helpers ---
function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(canvas, { srgb = true, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// --------------------------------------------------------------- geometry ---
// Beveled box with analytic normals and per-face planar UVs. The bevel is the
// single biggest "not a prototype" cue on furniture edges. uvWorld = world
// units per texture repeat so grain density stays constant across fixtures.
export function roundedBox(w, h, d, r = 0.025, uvWorld = 1.6) {
  const seg = 3;
  const g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg).toNonIndexed();
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const uv = g.attributes.uv.array;
  r = Math.min(r, w / 2, h / 2, d / 2);
  const bx = w / 2 - r;
  const by = h / 2 - r;
  const bz = d / 2 - r;
  const half = 0.5 / seg;
  const n = new THREE.Vector3();
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    n.set(pos[i], pos[i + 1], pos[i + 2]);
    const sx = Math.sign(n.x);
    const sy = Math.sign(n.y);
    const sz = Math.sign(n.z);
    n.x -= sx * Math.min(Math.abs(n.x), half);
    n.y -= sy * Math.min(Math.abs(n.y), half);
    n.z -= sz * Math.min(Math.abs(n.z), half);
    if (n.lengthSq() < 1e-10) n.set(sx, sy, sz);
    n.normalize();
    const X = bx * sx + n.x * r;
    const Y = by * sy + n.y * r;
    const Z = bz * sz + n.z * r;
    pos[i] = X; pos[i + 1] = Y; pos[i + 2] = Z;
    nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    if (ax >= ay && ax >= az) { uv[j] = Z / uvWorld; uv[j + 1] = Y / uvWorld; }
    else if (ay >= az) { uv[j] = X / uvWorld; uv[j + 1] = Z / uvWorld; }
    else { uv[j] = X / uvWorld; uv[j + 1] = Y / uvWorld; }
  }
  g.attributes.position.needsUpdate = true;
  return g;
}

// -------------------------------------------------------------- textures ----
// Furniture walnut: straight fine grain, no planks (those are the floor's).
export function makeWalnutTexture({ seed = 61, base = '#4a3524', hi = '#5d4430', lo = '#3a2919' } = {}) {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // broad tonal bands
  for (let i = 0; i < 22; i++) {
    const x = r() * size;
    const w = 14 + r() * 46;
    ctx.fillStyle = (r() < 0.5 ? hi : lo) + '18';
    ctx.fillRect(x - w / 2, 0, w, size);
    ctx.fillRect(x - w / 2 - size, 0, w, size);
    ctx.fillRect(x - w / 2 + size, 0, w, size);
  }
  // fine grain lines, gently wavering, wrapped vertically
  for (let i = 0; i < 150; i++) {
    const x = r() * size;
    const wob = (r() - 0.5) * 12;
    ctx.strokeStyle = (r() < 0.55 ? lo : hi) + (r() < 0.4 ? '2c' : '19');
    ctx.lineWidth = 0.8 + r() * 0.9;
    for (const ox of [-size, 0, size]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, -4);
      ctx.bezierCurveTo(x + wob + ox, size * 0.33, x - wob + ox, size * 0.66, x + ox, size + 4);
      ctx.stroke();
    }
  }
  // occasional cathedral arcs
  for (let i = 0; i < 5; i++) {
    const cx = r() * size;
    const cy = r() * size;
    ctx.strokeStyle = lo + '22';
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 12 + k * 9, 34 + k * 16, 0, -1.2, 1.2);
      ctx.stroke();
    }
  }
  return finish(c);
}

// Honey oak plank floor: staggered joints, per-plank tone, sheen streaks.
export function makeOakFloorTexture({ seed = 71 } = {}) {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  const tones = ['#bf9057', '#c79a63', '#b3854e', '#cba26c', '#ba8b52'];
  ctx.fillStyle = '#bd8f58';
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const rowH = size / rows;
  for (let row = 0; row < rows; row++) {
    let x = -((row % 3) * size) / 4.7 - r() * 30;
    while (x < size) {
      const len = size * (0.3 + r() * 0.35);
      const tone = tones[Math.floor(r() * tones.length)];
      ctx.fillStyle = tone;
      ctx.fillRect(x, row * rowH, len, rowH);
      // grain within the plank
      for (let i = 0; i < 12; i++) {
        const gy = row * rowH + r() * rowH;
        ctx.strokeStyle = (r() < 0.5 ? '#9c7040' : '#d4ad77') + '26';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x + 2, gy);
        ctx.bezierCurveTo(x + len * 0.3, gy + (r() - 0.5) * 3, x + len * 0.7, gy + (r() - 0.5) * 3, x + len - 2, gy);
        ctx.stroke();
      }
      // butt joint
      ctx.fillStyle = '#8a6238aa';
      ctx.fillRect(x + len - 1, row * rowH, 1.6, rowH);
      x += len;
    }
    // plank seam
    ctx.fillStyle = '#8a623888';
    ctx.fillRect(0, row * rowH, size, 1.4);
  }
  // soft sheen variation
  for (let i = 0; i < 12; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 60 + r() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, (r() < 0.5 ? '#ffffff' : '#7a5630') + '0d');
    g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c);
}

// Clapboard siding color: soft horizontal lap lines so the exterior reads at
// distance (the normal map alone vanishes past a few yards).
export function makeSidingTexture({ seed = 47, base = '#e9e2cc' } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const lap = 18;
  for (let y = 0; y < size; y += lap) {
    // shadow under each lap edge + a lighter catch above it
    ctx.fillStyle = '#d4cbb220';
    ctx.fillRect(0, y + lap - 4, size, 4);
    ctx.fillStyle = '#cfc5aa38';
    ctx.fillRect(0, y + lap - 1.5, size, 1.5);
    ctx.fillStyle = '#f4efdd28';
    ctx.fillRect(0, y, size, 1.5);
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = r() < 0.5 ? '#ddd4bb22' : '#f2ecd922';
    ctx.fillRect(r() * size, r() * size, 2, 1.2);
  }
  return finish(c);
}

export function makePlasterCreamTexture({ seed = 41, base = '#efe9d9' } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2000; i++) {
    ctx.fillStyle = r() < 0.5 ? '#e2dbc822' : '#f8f3e622';
    ctx.fillRect(r() * size, r() * size, 1.6, 1.6);
  }
  for (let i = 0; i < 9; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 40 + r() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, '#e6dfcd14');
    g.addColorStop(1, '#e6dfcd00');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c);
}

export function makeConcreteTexture({ seed = 83 } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = '#a8a49b';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3200; i++) {
    ctx.fillStyle = r() < 0.5 ? '#98948b3a' : '#b7b3aa33';
    ctx.fillRect(r() * size, r() * size, 1.4, 1.4);
  }
  for (let i = 0; i < 10; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 26 + r() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, '#8e8a8020');
    g.addColorStop(1, '#8e8a8000');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c);
}

export function makeLeatherTexture({ seed = 97, base = '#9a5f33', lo = '#7c4a26', hi = '#b3763f' } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 20 + r() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, (r() < 0.5 ? lo : hi) + '20');
    g.addColorStop(1, '#00000000');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = (r() < 0.5 ? lo : hi) + '14';
    const x = r() * size;
    const y = r() * size;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  return finish(c);
}

export function makeFabricTexture({ seed = 53, base = '#57795c', weft = '#4a6a50', warp = '#63866a' } = {}) {
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = weft + (y % 4 === 0 ? '55' : '2a');
    ctx.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 2) {
    ctx.fillStyle = warp + (x % 4 === 0 ? '3d' : '20');
    ctx.fillRect(x, 0, 1, size);
  }
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = r() < 0.5 ? weft + '30' : warp + '30';
    ctx.fillRect(r() * size, r() * size, 1, 1);
  }
  return finish(c);
}

export function makeKraftTexture({ seed = 29 } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = '#b98d5e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = r() < 0.5 ? '#a87d5033' : '#c79a6b2e';
    ctx.fillRect(r() * size, r() * size, 1.8, 1.2);
  }
  // faint flute shading bands (corrugated hint)
  for (let x = 0; x < size; x += 7) {
    ctx.fillStyle = '#a87d5016';
    ctx.fillRect(x, 0, 3, size);
  }
  return finish(c);
}

// The club rug: deep green field, double gold border, pine mark + club name.
export function makeRugTexture(clubName = 'PINE HOLLOW', { w = 512, h = 384 } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f4a26';
  ctx.fillRect(0, 0, w, h);
  // carpet weave noise
  const r = rng(9);
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = r() < 0.5 ? '#18391d3a' : '#2a5a3233';
    ctx.fillRect(r() * w, r() * h, 2, 1.4);
  }
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(28, 28, w - 56, h - 56);
  // pine motif: three stacked triangle tiers + trunk
  const px = w / 2;
  const py = h / 2 - 26;
  ctx.fillStyle = '#c9a227cc';
  for (let t = 0; t < 3; t++) {
    const tw = 34 + t * 20;
    const ty = py - 30 + t * 26;
    ctx.beginPath();
    ctx.moveTo(px, ty - 20);
    ctx.lineTo(px - tw / 2, ty + 12);
    ctx.lineTo(px + tw / 2, ty + 12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect(px - 5, py + 34, 10, 16);
  ctx.fillStyle = '#c9a227';
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(h * 0.085)}px Georgia`;
  ctx.fillText(clubName.toUpperCase(), px, h / 2 + 78);
  ctx.font = `${Math.round(h * 0.055)}px Georgia`;
  ctx.fillText('GOLF CLUB', px, h / 2 + 108);
  const tex = finish(c, { repeat: false });
  return tex;
}

// Product box label: brand band + name + a ball/club glyph. One draw per
// SKU-tier; meshes share the texture.
export function makeProductLabel({ brand = 'FAIRWAY SUPPLY', name = 'TOUR SOFT', field = '#f4f0e6', band = '#1f4a26', ink = '#23262b', glyph = 'ball' } = {}) {
  const c = makeCanvas(128, 96);
  const ctx = c.getContext('2d');
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, 128, 26);
  ctx.fillStyle = '#f4f0e6';
  ctx.font = 'bold 13px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText(brand.slice(0, 15), 64, 18);
  ctx.fillStyle = ink;
  ctx.font = 'bold 14px Georgia';
  ctx.fillText(name.slice(0, 13), 64, 48);
  if (glyph === 'ball') {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(40 + i * 24, 72, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#c9c4b4';
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = band;
    ctx.fillRect(24, 66, 80, 4);
  }
  return finish(c, { repeat: false });
}

// Wall wordmark / plaque generator: walnut or cream field + serif lettering.
export function makeSignTexture(lines, {
  w = 512, h = 256, field = '#f4f0e6', ink = '#1f4a26', accent = '#c9a227',
  frame = true, pine = false, sizes = null,
} = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w, h);
  if (frame) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(3, w * 0.012);
    ctx.strokeRect(w * 0.03, h * 0.06, w * 0.94, h * 0.88);
  }
  let y = h * (pine ? 0.2 : 0.3);
  if (pine) {
    ctx.fillStyle = ink;
    const px = w / 2;
    for (let t = 0; t < 3; t++) {
      const tw = h * (0.1 + t * 0.06);
      const ty = y - h * 0.1 + t * h * 0.075;
      ctx.beginPath();
      ctx.moveTo(px, ty - h * 0.06);
      ctx.lineTo(px - tw / 2, ty + h * 0.035);
      ctx.lineTo(px + tw / 2, ty + h * 0.035);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(px - w * 0.006, y + h * 0.11, w * 0.012, h * 0.05);
    y += h * 0.3;
  }
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    const fs = sizes ? sizes[i] : Math.round(h * (i === 0 ? 0.16 : 0.11));
    ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px Georgia`;
    ctx.fillStyle = i === 0 ? ink : '#3f3a30';
    ctx.fillText(line, w / 2, y);
    y += fs * 1.45;
  });
  return finish(c, { repeat: false });
}

// ------------------------------------------------------------ the library ---
export function makeClubhouseMaterials(clubName) {
  const walnutTex = makeWalnutTexture({});
  walnutTex.repeat.set(1, 1);
  const walnutDarkTex = makeWalnutTexture({ seed: 62, base: '#3c2a1c', hi: '#4c3826', lo: '#2d2014' });
  const oakTex = makeOakFloorTexture({});
  oakTex.repeat.set(1, 1);
  const plasterTex = makePlasterCreamTexture({});
  plasterTex.repeat.set(8, 2.4);
  const concreteTex = makeConcreteTexture({});
  concreteTex.repeat.set(3, 3);
  const leatherTex = makeLeatherTexture({});
  const sageTex = makeFabricTexture({});
  const kraftTex = makeKraftTexture({});

  return {
    // architecture
    plaster: new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.92 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.94, emissive: 0xfff2dc, emissiveIntensity: 0.08 }),
    oakFloor: new THREE.MeshStandardMaterial({ map: oakTex, roughness: 0.52 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }),
    // woods
    walnut: new THREE.MeshStandardMaterial({ map: walnutTex, roughness: 0.55 }),
    walnutDark: new THREE.MeshStandardMaterial({ map: walnutDarkTex, roughness: 0.6 }),
    rawWood: new THREE.MeshStandardMaterial({ map: walnutTex, color: 0xd8c2a6, roughness: 0.85 }),
    // paints + metals
    trimPaint: new THREE.MeshStandardMaterial({ color: 0xf5f2e6, roughness: 0.7 }),
    greenPaint: new THREE.MeshStandardMaterial({ color: 0x1f4a26, roughness: 0.55 }),
    sagePaint: new THREE.MeshStandardMaterial({ color: 0x57795c, roughness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.32, metalness: 0.9 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.38, metalness: 0.82 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.25, metalness: 0.95 }),
    charcoal: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 }),
    // soft goods
    leather: new THREE.MeshStandardMaterial({ map: leatherTex, roughness: 0.62 }),
    sageFabric: new THREE.MeshStandardMaterial({ map: sageTex, roughness: 0.95 }),
    kraft: new THREE.MeshStandardMaterial({ map: kraftTex, roughness: 0.88 }),
    feltGreen: new THREE.MeshStandardMaterial({ color: 0x2e5a35, roughness: 0.98 }),
    // glazing
    glass: new THREE.MeshStandardMaterial({
      color: 0xcfe4ee, roughness: 0.06, metalness: 0.25,
      transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    }),
    // identity textures
    rugTex: makeRugTexture(clubName),
    signTexture: makeSignTexture,
  };
}
