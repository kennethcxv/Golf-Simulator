import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, CELL_YD } from '../src/sim/constants.js';
import { newGame } from '../src/sim/state.js';
import { makeVisualField, computeVisualField } from '../src/render3d/visualField.js';
import { ensurePaint } from '../src/sim/courseVec.js';

// The visual field stores interleaved (zone, encodedDistance) byte pairs.
const zoneAt = (f, i) => f.data[i * 2];
const distByteAt = (f, i) => f.data[i * 2 + 1];

// Paint a disc and report every texel the stroke actually took over, so the
// assertions can never be satisfied by the underlying generated surface.
function paintedDisc({ seed = 4242, zone = ZONE.FAIRWAY, cx, cy, r } = {}) {
  const st = newGame('relaxed', seed);
  const { course } = st;

  const before = makeVisualField(course);
  computeVisualField(course, before);

  const paint = ensurePaint(course);
  for (let y = Math.max(0, cy - r); y <= Math.min(course.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(course.w - 1, cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) paint[y * course.w + x] = zone;
    }
  }

  const after = makeVisualField(course);
  computeVisualField(course, after);

  const claimed = [];
  for (let i = 0; i < after.w * after.h; i++) {
    if (zoneAt(after, i) === zone && zoneAt(before, i) !== zone) claimed.push(i);
  }
  return { course, before, after, claimed, scale: after.scale };
}

test('a painted stroke carries a real distance gradient, not one constant', () => {
  const { after, claimed } = paintedDisc({ cx: 30, cy: 20, r: 8 });
  assert.ok(claimed.length > 500, `stroke claimed ${claimed.length} texels`);

  const distinct = new Set(claimed.map((i) => distByteAt(after, i)));
  // The pre-fix rasterizer returned packZD(zone, -0.6) for every painted
  // sample, so this set had exactly one member and the shader had no gradient
  // to antialias — which is what rendered each stroke as 8-yard squares.
  assert.ok(
    distinct.size >= 16,
    `painted interior holds ${distinct.size} distinct distances; a constant field cannot be antialiased`,
  );
});

test('painted distance deepens with depth inside the stroke', () => {
  const r = 8;
  const cx = 30;
  const cy = 20;
  const { after, claimed, scale } = paintedDisc({ cx, cy, r });

  // Encoded distance is 128 + d*32 with d in cells and negative inside, so a
  // deeper sample must encode a strictly smaller byte than a rim sample.
  let rim = [];
  let core = [];
  for (const i of claimed) {
    const tx = i % after.w;
    const ty = (i / after.w) | 0;
    const dx = tx / scale - cx;
    const dy = ty / scale - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r - 1.0) rim.push(distByteAt(after, i));
    else if (dist < r * 0.4) core.push(distByteAt(after, i));
  }
  assert.ok(rim.length > 0 && core.length > 0, 'sampled both rim and core');

  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(
    mean(core) < mean(rim),
    `core ${mean(core).toFixed(1)} should encode deeper (smaller) than rim ${mean(rim).toFixed(1)}`,
  );
});

test('the stroke boundary lands off the 8-yard cell lattice', () => {
  const { after, claimed, scale } = paintedDisc({ cx: 30, cy: 20, r: 8 });

  // Leftmost claimed texel per row = the stroke's left boundary on that row.
  const leftByRow = new Map();
  for (const i of claimed) {
    const tx = i % after.w;
    const ty = (i / after.w) | 0;
    if (!leftByRow.has(ty) || tx < leftByRow.get(ty)) leftByRow.set(ty, tx);
  }
  assert.ok(leftByRow.size > 40, `sampled ${leftByRow.size} rows`);

  // A boundary quantized to the simulation grid can only fall on multiples of
  // CELL_YD. Count how many rows put it somewhere else.
  // Weaker guard than the two tests above: WARP.bands already wobbles the
  // boundary ~2.2 yd, so this passed against the pre-fix constant too. It is
  // kept as a standing property, not as proof the gradient exists.
  let offLattice = 0;
  for (const tx of leftByRow.values()) {
    const yd = (tx / scale) * CELL_YD;
    const intoCell = ((yd % CELL_YD) + CELL_YD) % CELL_YD;
    if (intoCell > 0.25 && intoCell < CELL_YD - 0.25) offLattice += 1;
  }
  const ratio = offLattice / leftByRow.size;
  assert.ok(
    ratio > 0.5,
    `only ${(ratio * 100).toFixed(0)}% of boundary rows sit off the 8-yard lattice`,
  );
});

test('unpainted ground is untouched by the stroke', () => {
  const { before, after, claimed } = paintedDisc({ cx: 30, cy: 20, r: 8 });
  const claimedSet = new Set(claimed);
  let checked = 0;
  for (let i = 0; i < after.w * after.h; i += 271) {
    if (claimedSet.has(i)) continue;
    // Samples the stroke did not claim must keep their generated zone.
    assert.equal(zoneAt(after, i), zoneAt(before, i), `texel ${i} changed outside the stroke`);
    checked += 1;
  }
  assert.ok(checked > 1000, `checked ${checked} untouched samples`);
});
