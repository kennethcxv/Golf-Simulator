import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE } from '../src/sim/constants.js';
import { buildPropertyCourse, generateMarketplace } from '../src/sim/marketplace.js';
import {
  makeVisualField, computeVisualField, computeSurfaceDistanceField,
  makeSurfaceDistanceField, decodeSurfaceDistanceByte, SURFACE_DISTANCE_CHANNEL,
} from '../src/render3d/visualField.js';

// 18-hole estates still come from the serpentine painter (see
// marketplace.js: size > 9), so they exercise the legacy kernel path rather
// than the vector rasterizer.
function legacyCourse() {
  const market = generateMarketplace(11);
  const big = market.find((p) => p.size > 9);
  assert.ok(big, 'marketplace offers a >9-hole estate to exercise the legacy path');
  const course = buildPropertyCourse(big);
  assert.ok(!course.vec, 'the estate is a legacy grid course, not a vector one');
  return course;
}

function builtLegacyField() {
  const course = legacyCourse();
  const field = makeVisualField(course);
  computeVisualField(course, field);
  return { course, field };
}

test('legacy courses carry a real boundary distance, not a flat 128', () => {
  const { field } = builtLegacyField();
  const seen = new Set();
  for (let i = 1; i < field.data.length; i += 2) seen.add(field.data[i]);
  // The pre-fix path wrote 128 into every texel, so this set had one member and
  // every surface channel downstream collapsed to a three-level step.
  assert.ok(seen.size > 24, `legacy distance byte takes ${seen.size} distinct values`);
  assert.ok(seen.has(128) === false || seen.size > 24, 'not a constant field');
});

test('legacy distance is signed inward and deepens away from a boundary', () => {
  const { field } = builtLegacyField();
  // Walk a row and check that the interior of a run encodes deeper than its
  // ends. Distance is 128 + cells*32 with negative inside, so deeper = smaller.
  let checked = 0;
  for (let ty = 8; ty < field.h - 8 && checked < 12; ty += 17) {
    let runStart = -1;
    let runZone = -1;
    for (let tx = 1; tx < field.w; tx++) {
      const z = field.data[(ty * field.w + tx) * 2];
      if (z !== runZone) {
        const len = tx - runStart;
        // Only runs bounded by a real zone change on BOTH sides. A run touching
        // the map border has no seed there on purpose — the property continues
        // into the environment ring rather than ending at a contour — so those
        // saturate and carry no gradient to measure.
        const bounded = runZone !== -1 && runStart > 1;
        if (bounded && len >= 24 && len <= 80) {
          const mid = (runStart + tx) >> 1;
          const edge = runStart + 1;
          const midByte = field.data[(ty * field.w + mid) * 2 + 1];
          const edgeByte = field.data[(ty * field.w + edge) * 2 + 1];
          if (edgeByte > 0) {
            assert.ok(
              midByte < edgeByte,
              `run at y=${ty}: middle (${midByte}) must encode deeper than edge (${edgeByte})`,
            );
            checked += 1;
          }
        }
        runZone = z;
        runStart = tx;
      }
    }
  }
  assert.ok(checked > 0, 'found at least one interior single-zone run to measure');
});

test('legacy fairway edges reconstruct a smooth contour rather than a step', () => {
  const { field } = builtLegacyField();
  const distance = makeSurfaceDistanceField(field);
  computeSurfaceDistanceField(field, distance);

  const ch = SURFACE_DISTANCE_CHANNEL.FAIRWAY;
  const values = new Set();
  let fairwayTexels = 0;
  for (let i = 0; i < field.w * field.h; i++) {
    if (field.data[i * 2] !== ZONE.FAIRWAY) continue;
    fairwayTexels += 1;
    values.add(distance.data[i * 4 + ch]);
  }
  assert.ok(fairwayTexels > 500, `estate has fairway to measure (${fairwayTexels} texels)`);
  // Pre-fix this channel held a single saturated constant across every fairway
  // texel, which is what a three-level step function looks like.
  assert.ok(
    values.size > 8,
    `fairway distance channel holds ${values.size} distinct values across the estate`,
  );
  const decoded = [...values].map(decodeSurfaceDistanceByte);
  assert.ok(Math.min(...decoded) < -1, 'the deepest fairway sample sits well inside its boundary');
});

test('a regional legacy rebuild matches a full one byte for byte', () => {
  const course = legacyCourse();
  const full = makeVisualField(course);
  computeVisualField(course, full);

  const regional = makeVisualField(course);
  computeVisualField(course, regional);
  // Recompute a window; the chamfer pass pads by its own saturation radius, so
  // the result inside the window must be identical to the full build.
  computeVisualField(course, regional, { x0: 30, y0: 20, x1: 60, y1: 45 });

  const s = regional.scale;
  let compared = 0;
  for (let ty = 21 * s; ty < 44 * s; ty++) {
    for (let tx = 31 * s; tx < 59 * s; tx++) {
      const o = (ty * regional.w + tx) * 2;
      assert.equal(regional.data[o], full.data[o], `zone at ${tx},${ty}`);
      assert.equal(regional.data[o + 1], full.data[o + 1], `distance at ${tx},${ty}`);
      compared += 1;
    }
  }
  assert.ok(compared > 10000, `compared ${compared} texels`);
});
