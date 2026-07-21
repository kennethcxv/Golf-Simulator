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
  // Every material canvas is later read back to derive roughness/normal maps.
  // Context attributes only count on the FIRST getContext call, so establish the
  // CPU-backed context here before any painter asks for the default one.
  c.getContext('2d', { willReadFrequently: true });
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
  // data maps (roughness, normal) must stay LINEAR — tagging them sRGB silently
  // gamma-corrects the data and the surface reads wrong
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------- derived maps ----
// The audit's headline material finding: 11 of 22 materials were flat colour
// values with no maps at all, and roughness was a single scalar — so every wooden
// surface in the building had identical sheen and brass, chrome and charcoal were
// separated only by hue. These derive the missing channels from the albedo we
// already draw, which costs no new art and makes the surfaces read as materials.

function luminance(canvas) {
  const { width: w, height: h } = canvas;
  // The albedo canvas already owns a normal 2D context by the time this derived
  // map is requested, so adding willReadFrequently to a second getContext call is
  // too late for Chromium to honor it. Read through a dedicated hinted canvas;
  // this keeps texture drawing GPU-friendly and removes the repeated-readback
  // warning from every generated clubhouse material.
  const readback = document.createElement('canvas');
  readback.width = w;
  readback.height = h;
  const readbackContext = readback.getContext('2d', { willReadFrequently: true });
  readbackContext.drawImage(canvas, 0, 0);
  const data = readbackContext.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  }
  return lum;
}

// Sobel the albedo's luminance into a tangent-space normal map. Grain, plank
// seams, plaster tooth and cardboard flutes all become real surface relief.
export function normalFrom(canvas, strength = 2.2) {
  const w = canvas.width;
  const h = canvas.height;
  const lum = luminance(canvas);
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const at = (x, y) => lum[((y % h) + h) % h * w + (((x % w) + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(out, { srgb: false });
}

// Map albedo luminance to gloss: the dark grain lines in a finished wood sit
// slightly BELOW the polished surface and catch less light, so they read rougher.
// `invert` flips that for materials where the light bits are the rough bits.
export function roughnessFrom(canvas, lo = 0.34, hi = 0.62, invert = false) {
  const w = canvas.width;
  const h = canvas.height;
  const lum = luminance(canvas);
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const t = invert ? lum[i] : 1 - lum[i];
    const v = Math.max(0, Math.min(1, lo + (hi - lo) * t)) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;   // three samples GREEN for roughness
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finish(out, { srgb: false });
}

// A painted surface is not a flat colour: it has roller tooth, and it holds a
// slightly uneven sheen. This is the base for every paint in the kit.
export function makePaintTexture({ seed = 11, base = '#f5f2e6', grain = 0.05 } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const a = Math.round(grain * 255).toString(16).padStart(2, '0');
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = (r() < 0.5 ? '#ffffff' : '#000000') + a;
    ctx.fillRect(r() * size, r() * size, 1.5, 1.5);
  }
  for (let i = 0; i < 7; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 30 + r() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, '#ffffff10');
    g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

// A golf ball's whole identity is its dimples. The old ball was an 8x6-segment
// sphere — a faceted white pebble. Geometry cannot pay for real dimples on an
// object 43 mm across, so they go in the normal map, where they cost nothing.
export function makeDimpleTexture({ size = 256, rows = 14 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const step = size / rows;
  const rad = step * 0.34;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < rows; x++) {
      const cx = x * step + (y % 2 ? step * 0.5 : 0) + step * 0.5;
      const cy = y * step + step * 0.5;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, '#8f8f8f');       // a pit, not a bump
      g.addColorStop(0.75, '#d8d8d8');
      g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

// Brushed metal: fine directional streaks. Brass and steel differ by more than
// hue — brass is softer and warmer, steel tighter and cooler.
export function makeBrushedTexture({ seed = 23, base = '#c9a227', hi = '#e6c65a', lo = '#8e6f18' } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    ctx.strokeStyle = (r() < 0.5 ? hi : lo) + (r() < 0.4 ? '30' : '18');
    ctx.lineWidth = 0.6 + r() * 1.1;
    const y = r() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (r() - 0.5) * 2);
    ctx.stroke();
  }
  return c;
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  frame = true, pine = false, sizes = null, secondaryInk = '#3f3a30',
} = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
    let fs = sizes ? sizes[i] : Math.round(h * (i === 0 ? 0.16 : 0.11));
    const weight = i === 0 ? 'bold ' : '';
    ctx.font = `${weight}${fs}px Georgia`;
    const availableWidth = w * 0.84;
    while (fs > 12 && ctx.measureText(line).width > availableWidth) {
      fs -= 1;
      ctx.font = `${weight}${fs}px Georgia`;
    }
    ctx.fillStyle = i === 0 ? ink : secondaryInk;
    ctx.fillText(line, w / 2, y);
    y += fs * 1.45;
  });
  return finish(c, { repeat: false });
}

// ------------------------------------------------------------ the library ---
// Every material carries a roughness map, and everything with surface relief
// carries a normal map. No material in here is a bare colour any more.
//
// No aoMap: three samples it from the `uv1` channel, and the procedural fixtures
// only author `uv`. Contact darkening comes from the light rig and shadows
// instead. Stated plainly rather than pretended.
export function makeClubhouseMaterials(clubName) {
  // --- source canvases (kept so the derived maps can be sobelled off them) ---
  // The long-standing makers hand back a CanvasTexture; `.image` is the canvas
  // they drew on, which is what normalFrom()/roughnessFrom() need to read.
  const walnutC = makeWalnutTexture({}).image;
  const walnutDarkC = makeWalnutTexture({ seed: 62, base: '#3c2a1c', hi: '#4c3826', lo: '#2d2014' }).image;
  const oakC = makeOakFloorTexture({}).image;
  const plasterC = makePlasterCreamTexture({}).image;
  const concreteC = makeConcreteTexture({}).image;
  const leatherC = makeLeatherTexture({}).image;
  const sageC = makeFabricTexture({}).image;
  const kraftC = makeKraftTexture({}).image;
  const trimC = makePaintTexture({ seed: 11, base: '#f5f2e6', grain: 0.045 });
  const greenC = makePaintTexture({ seed: 12, base: '#1f4a26', grain: 0.06 });
  const sagePC = makePaintTexture({ seed: 13, base: '#57795c', grain: 0.05 });
  const ceilC = makePaintTexture({ seed: 14, base: '#f4f0e6', grain: 0.03 });
  const brassC = makeBrushedTexture({});
  const steelC = makeBrushedTexture({ seed: 24, base: '#9aa1a8', hi: '#c3c9ce', lo: '#6d747a' });
  const ironC = makePaintTexture({ seed: 15, base: '#2b2e33', grain: 0.05 });
  const charC = makePaintTexture({ seed: 16, base: '#23262b', grain: 0.04 });
  const feltC = makeFabricTexture({ seed: 54, base: '#2e5a35', weft: '#26492c', warp: '#37693f' }).image;
  const rubberC = makePaintTexture({ seed: 17, base: '#191b1d', grain: 0.07 });
  const plasticC = makePaintTexture({ seed: 18, base: '#2a2e34', grain: 0.025 });
  const dimpleC = makeDimpleTexture({});
  // neutral bases for the TINTED merch slots — see merchFabric/merchLeather below
  const weaveC = makeFabricTexture({ seed: 55, base: '#bdbdbd', weft: '#b0b0b0', warp: '#cacaca' }).image;
  const hideC = makeLeatherTexture({ seed: 98, base: '#c6c6c6', lo: '#b2b2b2', hi: '#d6d6d6' }).image;

  const t = (c, rx = 1, ry = 1, srgb = true) => {
    const tex = finish(c, { srgb });
    tex.repeat.set(rx, ry);
    return tex;
  };
  const n = (c, rx = 1, ry = 1, s = 2.2) => {
    const tex = normalFrom(c, s);
    tex.repeat.set(rx, ry);
    return tex;
  };
  const r = (c, lo, hi, rx = 1, ry = 1, inv = false) => {
    const tex = roughnessFrom(c, lo, hi, inv);
    tex.repeat.set(rx, ry);
    return tex;
  };

  return {
    // --- architecture ---
    plaster: new THREE.MeshStandardMaterial({
      map: t(plasterC, 8, 2.4), normalMap: n(plasterC, 8, 2.4, 1.1),
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: r(plasterC, 0.82, 0.97, 8, 2.4), roughness: 1,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      map: t(ceilC, 6, 4), roughnessMap: r(ceilC, 0.88, 0.98, 6, 4), roughness: 1,
      emissive: 0xfff2dc, emissiveIntensity: 0.08,
    }),
    oakFloor: new THREE.MeshStandardMaterial({
      map: t(oakC), normalMap: n(oakC, 1, 1, 2.6),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: r(oakC, 0.30, 0.66), roughness: 1,   // the plank seams sit dull
    }),
    concrete: new THREE.MeshStandardMaterial({
      map: t(concreteC, 3, 3), normalMap: n(concreteC, 3, 3, 1.6),
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: r(concreteC, 0.80, 0.96, 3, 3), roughness: 1,
    }),
    // --- woods: finished furniture holds a sheen the raw stock does not ---
    walnut: new THREE.MeshStandardMaterial({
      map: t(walnutC), normalMap: n(walnutC, 1, 1, 1.8),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: r(walnutC, 0.33, 0.60), roughness: 1,
    }),
    walnutDark: new THREE.MeshStandardMaterial({
      map: t(walnutDarkC), normalMap: n(walnutDarkC, 1, 1, 1.8),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: r(walnutDarkC, 0.38, 0.66), roughness: 1,
    }),
    rawWood: new THREE.MeshStandardMaterial({
      map: t(walnutC), color: 0xd8c2a6, normalMap: n(walnutC, 1, 1, 2.4),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: r(walnutC, 0.72, 0.92), roughness: 1,
    }),
    // --- paints: tooth and uneven sheen, never a flat value ---
    trimPaint: new THREE.MeshStandardMaterial({
      map: t(trimC, 3, 3), normalMap: n(trimC, 3, 3, 0.8),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: r(trimC, 0.55, 0.78, 3, 3), roughness: 1,
    }),
    greenPaint: new THREE.MeshStandardMaterial({
      map: t(greenC, 3, 3), normalMap: n(greenC, 3, 3, 0.8),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: r(greenC, 0.42, 0.66, 3, 3), roughness: 1,
    }),
    sagePaint: new THREE.MeshStandardMaterial({
      map: t(sagePC, 3, 3), roughnessMap: r(sagePC, 0.58, 0.80, 3, 3), roughness: 1,
    }),
    // --- metals: brass is brushed and warm, steel tight and cool, powder-coat
    //     is NOT metallic at all — that is the whole point of a powder coat ---
    brass: new THREE.MeshStandardMaterial({
      map: t(brassC, 2, 2), roughnessMap: r(brassC, 0.18, 0.44, 2, 2),
      roughness: 1, metalness: 0.92,
      normalMap: n(brassC, 2, 2, 0.9), normalScale: new THREE.Vector2(0.25, 0.25),
    }),
    chrome: new THREE.MeshStandardMaterial({
      map: t(steelC, 2, 2), roughnessMap: r(steelC, 0.10, 0.32, 2, 2),
      roughness: 1, metalness: 0.95,
    }),
    iron: new THREE.MeshStandardMaterial({   // powder-coated: matte, dielectric
      map: t(ironC, 2, 2), roughnessMap: r(ironC, 0.52, 0.74, 2, 2),
      roughness: 1, metalness: 0.15,
      normalMap: n(ironC, 2, 2, 0.7), normalScale: new THREE.Vector2(0.3, 0.3),
    }),
    charcoal: new THREE.MeshStandardMaterial({
      map: t(charC, 2, 2), roughnessMap: r(charC, 0.44, 0.68, 2, 2), roughness: 1,
    }),
    // --- soft goods ---
    leather: new THREE.MeshStandardMaterial({
      map: t(leatherC), normalMap: n(leatherC, 1, 1, 2.0),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: r(leatherC, 0.42, 0.72), roughness: 1,
    }),
    sageFabric: new THREE.MeshStandardMaterial({
      map: t(sageC, 2, 2), normalMap: n(sageC, 2, 2, 2.6),
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: r(sageC, 0.86, 0.99, 2, 2), roughness: 1,
    }),
    kraft: new THREE.MeshStandardMaterial({
      map: t(kraftC), normalMap: n(kraftC, 1, 1, 2.4),   // the flutes become relief
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: r(kraftC, 0.78, 0.95), roughness: 1,
    }),
    feltGreen: new THREE.MeshStandardMaterial({
      map: t(feltC, 2, 2), normalMap: n(feltC, 2, 2, 2.2),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: r(feltC, 0.92, 1.0, 2, 2), roughness: 1,
    }),
    rubber: new THREE.MeshStandardMaterial({
      map: t(rubberC, 2, 2), roughnessMap: r(rubberC, 0.80, 0.96, 2, 2), roughness: 1,
      normalMap: n(rubberC, 2, 2, 1.2), normalScale: new THREE.Vector2(0.4, 0.4),
    }),
    plastic: new THREE.MeshStandardMaterial({
      map: t(plasticC, 2, 2), roughnessMap: r(plasticC, 0.30, 0.52, 2, 2), roughness: 1,
    }),
    // --- glazing: real glass is smooth, barely tinted, and not a metal ---
    glass: new THREE.MeshStandardMaterial({
      color: 0xdcebf2, roughness: 0.04, metalness: 0.0,
      transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
    }),
    displayGlass: new THREE.MeshPhysicalMaterial({
      color: 0xeaf5f1, roughness: 0.08, metalness: 0.0,
      transparent: true, opacity: 0.045, transmission: 0.20,
      side: THREE.DoubleSide, depthWrite: false,
    }),

    // --- merchandise slots (merch.js remaps the GLB material names onto these,
    //     so every polo in the shop shares ONE material per colour) ---
    //
    // These two are TINTED per item, so their maps must be NEUTRAL GREY. The
    // first cut used the sage-green weave and the caramel hide as the bases, and
    // `color` multiplies into `map`: a green polo tint times a green weave came
    // out near-black, and every cap in the shop read as a mushroom. Grey base,
    // true tints.
    merchFabric: new THREE.MeshStandardMaterial({
      map: t(weaveC, 3, 3), normalMap: n(weaveC, 3, 3, 2.4),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: r(weaveC, 0.84, 0.98, 3, 3), roughness: 1,
      color: 0xffffff,
    }),
    merchLeather: new THREE.MeshStandardMaterial({
      map: t(hideC, 2, 2), color: 0xffffff,
      normalMap: n(hideC, 2, 2, 1.8), normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: r(hideC, 0.40, 0.70, 2, 2), roughness: 1,
    }),
    merchRubber: new THREE.MeshStandardMaterial({
      map: t(rubberC, 2, 2), color: 0xdedbd2,
      roughnessMap: r(rubberC, 0.78, 0.94, 2, 2), roughness: 1,
    }),
    merchSteel: new THREE.MeshStandardMaterial({
      map: t(steelC, 2, 2), roughnessMap: r(steelC, 0.14, 0.36, 2, 2),
      roughness: 1, metalness: 0.92,
    }),
    // Repeated club shafts need a readable mid-value under the shop's warm,
    // reflection-heavy lighting.  This shares one stable material across racks
    // and bag displays instead of cloning a brighter material per club.
    merchShaft: new THREE.MeshStandardMaterial({
      map: t(steelC, 2, 2), color: 0xe2e5e3,
      roughnessMap: r(steelC, 0.30, 0.48, 2, 2), roughness: 1, metalness: 0.52,
    }),
    merchDark: new THREE.MeshStandardMaterial({
      map: t(charC, 2, 2), color: 0x4a5058,
      roughnessMap: r(charC, 0.22, 0.44, 2, 2), roughness: 1, metalness: 0.7,
    }),
    merchWood: new THREE.MeshStandardMaterial({
      map: t(walnutC, 2, 2), color: 0xc9a97e,
      roughnessMap: r(walnutC, 0.50, 0.74, 2, 2), roughness: 1,
    }),
    merchPlastic: new THREE.MeshStandardMaterial({
      map: t(plasticC, 2, 2), color: 0x8a9099,
      roughnessMap: r(plasticC, 0.32, 0.54, 2, 2), roughness: 1,
    }),
    merchWhite: new THREE.MeshStandardMaterial({
      map: t(trimC, 2, 2), color: 0xf6f3ea,
      roughnessMap: r(trimC, 0.48, 0.72, 2, 2), roughness: 1,
    }),
    golfBall: new THREE.MeshStandardMaterial({
      color: 0xf7f6f1, roughness: 0.42,
      normalMap: n(dimpleC, 1, 1, 3.4), normalScale: new THREE.Vector2(1.0, 1.0),
    }),

    // identity textures
    rugTex: makeRugTexture(clubName),
    signTexture: makeSignTexture,
  };
}
