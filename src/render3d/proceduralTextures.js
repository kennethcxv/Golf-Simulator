// FAIRWAY STATE — procedural tileable ground textures.
// Generated once at boot on canvas: no binary assets in the repo, deterministic,
// and good enough to read as real turf/sand under proper lighting. A photo-texture
// pass can swap these 1:1 later (same slots, same tiling).

import * as THREE from 'three';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

// tiny seeded rng so textures are stable frame to frame
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

// draw wrapped: paints at (x,y) and its 8 torus neighbors so the tile seams vanish
function wrapped(ctx, size, draw) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.save();
      ctx.translate(ox * size, oy * size);
      draw();
      ctx.restore();
    }
  }
}

function finish(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makeGrassTexture({ seed = 1, base = '#5d9443', dark = '#4a7c34', light = '#72ab52', blades = 5200 } = {}) {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // large soft patchiness
  for (let i = 0; i < 46; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 40 + r() * 90;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    const col = r() < 0.5 ? dark : light;
    g.addColorStop(0, col + '30');
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    wrapped(ctx, size, () => {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    });
  }

  // fine blade streaks
  for (let i = 0; i < blades; i++) {
    const x = r() * size;
    const y = r() * size;
    const len = 2 + r() * 4;
    const ang = -0.35 + r() * 0.7 + (r() < 0.5 ? Math.PI / 2 : 0);
    const shadeCol = r() < 0.5 ? dark : light;
    ctx.strokeStyle = shadeCol + (r() < 0.5 ? '55' : '30');
    ctx.lineWidth = 0.8;
    wrapped(ctx, size, () => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    });
  }
  return finish(c);
}

export function makeSandTexture({ seed = 7 } = {}) {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = '#ddcda0';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 40; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 30 + r() * 80;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    const col = r() < 0.5 ? '#cdbb8c' : '#e9dcb2';
    g.addColorStop(0, col + '38');
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    wrapped(ctx, size, () => {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    });
  }
  // grain speckle
  for (let i = 0; i < 9000; i++) {
    const x = r() * size;
    const y = r() * size;
    ctx.fillStyle = r() < 0.5 ? '#c3b184' + '66' : '#efe3bc' + '55';
    wrapped(ctx, size, () => ctx.fillRect(x, y, 1, 1));
  }
  // rake lines, faint
  ctx.strokeStyle = '#c9b78a50';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 22; i++) {
    const y0 = r() * size;
    wrapped(ctx, size, () => {
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(size * 0.3, y0 + (r() - 0.5) * 14, size * 0.7, y0 + (r() - 0.5) * 14, size, y0);
      ctx.stroke();
    });
  }
  return finish(c);
}

export function makeScrubTexture({ seed = 13 } = {}) {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = '#4f6238';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 4 + r() * 22;
    const col = ['#43552f', '#5a6f41', '#6b6142', '#3e4d2c'][Math.floor(r() * 4)];
    ctx.fillStyle = col + '5a';
    wrapped(ctx, size, () => {
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.5 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  for (let i = 0; i < 2600; i++) {
    const x = r() * size;
    const y = r() * size;
    ctx.fillStyle = r() < 0.5 ? '#39482a66' : '#66794c55';
    wrapped(ctx, size, () => ctx.fillRect(x, y, 1.5, 1.5));
  }
  return finish(c);
}

export function makePathTexture({ seed = 21 } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = '#9d9484';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4200; i++) {
    const x = r() * size;
    const y = r() * size;
    ctx.fillStyle = r() < 0.5 ? '#8a8172aa' : '#b0a79688';
    wrapped(ctx, size, () => ctx.fillRect(x, y, 1.4, 1.4));
  }
  return finish(c);
}
