import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE } from '../src/sim/constants.js';
import { newGame } from '../src/sim/state.js';
import { getZone } from '../src/sim/course.js';
import {
  makeVisualField, computeVisualField, updateVisualFieldRegion, fieldZoneAt, FIELD_SCALE,
} from '../src/render3d/visualField.js';

function builtField(seed = 4242) {
  const st = newGame('relaxed', seed);
  const field = makeVisualField(st.course);
  computeVisualField(st.course, field);
  return { st, field };
}

test('field has the expected hi-res dimensions and only valid zone ids', () => {
  const { st, field } = builtField();
  assert.equal(field.w, st.course.w * FIELD_SCALE);
  assert.equal(field.h, st.course.h * FIELD_SCALE);
  assert.ok(field.w >= 960, 'meets the ≥1024-class visual mask target for the property');
  const maxId = Math.max(...Object.values(ZONE));
  for (let i = 0; i < field.data.length; i += 97) {
    assert.ok(field.data[i] <= maxId, `texel ${i} holds invalid zone ${field.data[i]}`);
  }
});

test('field generation is deterministic', () => {
  const a = builtField(777).field;
  const b = builtField(777).field;
  assert.deepEqual(Array.from(a.data.slice(0, 50000)), Array.from(b.data.slice(0, 50000)));
});

test('surface coverage is preserved: cell centers mostly keep their zone class', () => {
  const { st, field } = builtField();
  const c = st.course;
  let agree = 0;
  let turfCells = 0;
  for (let y = 2; y < c.h - 2; y++) {
    for (let x = 2; x < c.w - 2; x++) {
      const z = getZone(c, x, y);
      turfCells++;
      if (fieldZoneAt(field, c, x + 0.5, y + 0.5) === z) agree++;
    }
  }
  const ratio = agree / turfCells;
  assert.ok(ratio > 0.72, `cell centers keep their class through smoothing (${(ratio * 100).toFixed(1)}%)`);
});

test('greens and water survive smoothing (small high-priority shapes are not eaten)', () => {
  const { st, field } = builtField();
  const c = st.course;
  for (const hole of c.holes) {
    const z = fieldZoneAt(field, c, hole.pin.x + 0.5, hole.pin.y + 0.5);
    assert.equal(z, ZONE.GREEN, `hole pin at (${hole.pin.x},${hole.pin.y}) sits on visual green, got ${z}`);
  }
  let waterTexels = 0;
  for (let i = 0; i < field.data.length; i += 13) {
    if (field.data[i] === ZONE.WATER) waterTexels++;
  }
  assert.ok(waterTexels > 100, `the pond exists in the visual field (${waterTexels} sampled texels)`);
});

test('boundaries are smooth: fairway edges vary at sub-cell resolution', () => {
  const { st, field } = builtField();
  const c = st.course;
  // walk a horizontal texel scanline band through hole 1's corridor and record
  // where fairway→non-fairway transitions happen; cell-locked edges would only
  // ever land on multiples of FIELD_SCALE
  const h1 = c.holes[0];
  const yTex = Math.round(((h1.tee.y + h1.pin.y) / 2) * FIELD_SCALE);
  const offsets = new Set();
  let transitions = 0;
  for (let row = -12; row <= 12; row++) {
    const ty = yTex + row;
    if (ty < 1 || ty >= field.h) continue;
    let prev = field.data[ty * field.w];
    for (let tx = 1; tx < field.w; tx++) {
      const cur = field.data[ty * field.w + tx];
      if ((prev === ZONE.FAIRWAY) !== (cur === ZONE.FAIRWAY)) {
        transitions++;
        offsets.add(tx % FIELD_SCALE);
      }
      prev = cur;
    }
  }
  assert.ok(transitions > 10, `scanlines cross fairway edges (${transitions})`);
  assert.ok(offsets.size >= FIELD_SCALE - 1, `edge positions use nearly all sub-cell offsets (${offsets.size}/${FIELD_SCALE}) — not cell-locked`);
});

test('the first cut and fringe render as NARROW bands, not 8-yd donuts', () => {
  const { field } = builtField();
  // measure the run length of consecutive SEMI texels along scanlines: the
  // visual first cut should typically be under a cell wide (8 texels)
  let runs = 0;
  let overwide = 0;
  for (let ty = 0; ty < field.h; ty += 5) {
    let run = 0;
    for (let tx = 0; tx <= field.w; tx++) {
      const z = tx < field.w ? field.data[ty * field.w + tx] : -1;
      if (z === ZONE.SEMI) run++;
      else {
        if (run > 0) {
          runs++;
          // horizontal runs over-read oblique bands (a 6-yd band crossed at
          // 30° spans 12 texels), so the cap is diagonal-aware
          if (run > 12) overwide++;
        }
        run = 0;
      }
    }
  }
  assert.ok(runs > 40, `first-cut bands exist (${runs} runs)`);
  assert.ok(overwide / runs < 0.3, `most first-cut crossings are narrow (${overwide}/${runs} over 12 yd)`);
});

test('dirty-rect update equals a full rebuild over the edited region', () => {
  const { st, field } = builtField();
  const c = st.course;
  // paint a green blob in open ground, then update only the region
  for (let y = 30; y <= 33; y++) {
    for (let x = 64; x <= 68; x++) c.zones[y * c.w + x] = ZONE.GREEN;
  }
  updateVisualFieldRegion(c, field, 64, 30, 68, 33);
  const fresh = makeVisualField(c);
  computeVisualField(c, fresh);
  assert.deepEqual(Array.from(field.data), Array.from(fresh.data), 'regional update matches full recompute everywhere');
});
