import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHeightfieldNormals, TERRAIN_NORMAL_Y_SCALE } from '../src/render3d/terrainNormals.js';

const VX = 37;
const VY = 29;
const DX = 1.33;
const DZ = 1.33;

function makeHeights(seed = 1) {
  const h = new Float32Array(VX * VY);
  for (let vy = 0; vy < VY; vy++) {
    for (let vx = 0; vx < VX; vx++) {
      // deterministic, non-separable, plenty of curvature
      h[vy * VX + vx] = Math.sin(vx * 0.37 + seed) * 1.8
        + Math.cos(vy * 0.29 - seed) * 1.1
        + Math.sin((vx + vy) * 0.13) * 0.6;
    }
  }
  return h;
}

const solve = (heights, window = null) => computeHeightfieldNormals(
  heights, VX, VY, DX, DZ, new Float32Array(VX * VY * 3), window,
);

test('normals are unit length and face upward across the whole grid', () => {
  const n = solve(makeHeights());
  for (let i = 0; i < VX * VY; i++) {
    const x = n[i * 3];
    const y = n[i * 3 + 1];
    const z = n[i * 3 + 2];
    const len = Math.hypot(x, y, z);
    assert.ok(Math.abs(len - 1) < 1e-5, `vertex ${i} normal length ${len}`);
    assert.ok(y > 0, `vertex ${i} normal points down (y=${y})`);
  }
});

test('a flat heightfield yields straight-up normals', () => {
  const n = solve(new Float32Array(VX * VY));
  for (let i = 0; i < VX * VY; i++) {
    assert.ok(Math.abs(n[i * 3]) < 1e-6);
    assert.ok(Math.abs(n[i * 3 + 1] - 1) < 1e-6);
    assert.ok(Math.abs(n[i * 3 + 2]) < 1e-6);
  }
});

test('a constant slope yields one constant normal across the interior', () => {
  const h = new Float32Array(VX * VY);
  for (let vy = 0; vy < VY; vy++) {
    for (let vx = 0; vx < VX; vx++) h[vy * VX + vx] = vx * 0.25;
  }
  const n = solve(h);
  const ref = [n[(1 * VX + 1) * 3], n[(1 * VX + 1) * 3 + 1], n[(1 * VX + 1) * 3 + 2]];
  for (let vy = 1; vy < VY - 1; vy++) {
    for (let vx = 1; vx < VX - 1; vx++) {
      const o = (vy * VX + vx) * 3;
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(n[o + k] - ref[k]) < 1e-6, `interior normal varies at ${vx},${vy}`);
      }
    }
  }
  // h rises with +x, so the surface normal (-dh/dx, 1, 0) tilts toward -x
  assert.ok(ref[0] < 0, 'normal leans back down the slope');
  assert.ok(Math.abs(ref[2]) < 1e-6, 'no cross-slope component');
  // and the flattening makes the lean stronger than the true gradient would
  const trueLean = 0.25 / DX;
  assert.ok(
    Math.abs(ref[0] / ref[1]) > trueLean,
    'TERRAIN_NORMAL_Y_SCALE should exaggerate the slope, not soften it',
  );
});

// THE property the whole windowed path depends on. If this ever fails, editing
// terrain leaves a shading seam at the edge of the brush's dirty rect.
test('a windowed solve is bit-identical to the full solve inside its window', () => {
  const heights = makeHeights(2);
  const full = solve(heights);

  for (const win of [
    { vx0: 10, vy0: 8, vx1: 18, vy1: 15 },   // interior
    { vx0: 0, vy0: 0, vx1: 5, vy1: 5 },      // clamped at the origin corner
    { vx0: VX - 6, vy0: VY - 6, vx1: VX - 1, vy1: VY - 1 }, // far corner
    { vx0: 0, vy0: 12, vx1: VX - 1, vy1: 13 }, // full-width band
    { vx0: 20, vy0: 20, vx1: 20, vy1: 20 },  // single vertex
  ]) {
    const windowed = solve(heights, win);
    for (let vy = win.vy0; vy <= win.vy1; vy++) {
      for (let vx = win.vx0; vx <= win.vx1; vx++) {
        const o = (vy * VX + vx) * 3;
        for (let k = 0; k < 3; k++) {
          assert.equal(
            windowed[o + k], full[o + k],
            `window ${JSON.stringify(win)} differs at vertex ${vx},${vy} component ${k}`,
          );
        }
      }
    }
  }
});

// The renderer edits heights in place and then re-solves only the touched
// region. Reproduce that exactly and compare against a from-scratch full solve.
test('re-solving only an edited region matches a full rebuild', () => {
  const heights = makeHeights(3);
  const na = solve(heights); // initial full solve, as the scene does on build

  // sculpt a bump, exactly as a brush stroke would
  const cx = 17;
  const cy = 14;
  const r = 3;
  for (let vy = cy - r; vy <= cy + r; vy++) {
    for (let vx = cx - r; vx <= cx + r; vx++) {
      const d = Math.hypot(vx - cx, vy - cy);
      if (d > r) continue;
      heights[vy * VX + vx] += (1 - d / r) * 2.4;
    }
  }

  // the renderer pads the normal window one vertex beyond the moved positions
  computeHeightfieldNormals(heights, VX, VY, DX, DZ, na, {
    vx0: cx - r - 1, vy0: cy - r - 1, vx1: cx + r + 1, vy1: cy + r + 1,
  });

  const fromScratch = solve(heights);
  for (let i = 0; i < VX * VY * 3; i++) {
    assert.equal(na[i], fromScratch[i], `component ${i} drifted from a full rebuild`);
  }
});

test('a one-vertex-narrow window would leave a seam, proving the pad is required', () => {
  // Guards the reasoning, not just the code: if the window is NOT padded, the
  // ring just outside it keeps stale normals. This asserts the failure mode is
  // real, so nobody "simplifies" the pad away later.
  const heights = makeHeights(4);
  const na = solve(heights);
  const cx = 15;
  const cy = 12;
  heights[cy * VX + cx] += 3;

  computeHeightfieldNormals(heights, VX, VY, DX, DZ, na, {
    vx0: cx, vy0: cy, vx1: cx, vy1: cy, // deliberately unpadded
  });

  const fromScratch = solve(heights);
  const neighbour = ((cy) * VX + (cx + 1)) * 3;
  assert.notEqual(
    na[neighbour + 1], fromScratch[neighbour + 1],
    'an unpadded window must leave the neighbour stale — if this passes, the pad is untested',
  );
});

test('the vertical flattening constant is applied', () => {
  assert.equal(TERRAIN_NORMAL_Y_SCALE, 0.55);
});
