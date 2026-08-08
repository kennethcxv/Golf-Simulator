import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// H4 (Goal 17) — THE FACIAL-FEATURE SWAP MUST NOT HAPPEN WHERE YOU CAN SEE IT.
//
// Measured on the shipped build: fine detail switched off at sqrt(20.25) = 4.5
// yd and back on at sqrt(16) = 4.0 yd. That is conversational distance - walk up
// to a customer and their face arrives.
//
// This pins the two properties that make the swap invisible: it happens far
// enough away that the features are too small to read, and it keeps hysteresis
// so it cannot flicker on the boundary.

const clubhouse = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');

const thresholds = (() => {
  const m = /const far = dx \* dx \+ dz \* dz > \(wasFar \? (\d+(?:\.\d+)?) : (\d+(?:\.\d+)?)\);/.exec(clubhouse);
  if (!m) return null;
  return { inSq: Number(m[1]), outSq: Number(m[2]) };
})();

test('the facial-feature swap is findable and squared-distance based', () => {
  assert.ok(thresholds, 'the LOD threshold pair is findable');
});

test('the swap happens well outside conversational distance', () => {
  const outYd = Math.sqrt(thresholds.outSq);
  // 4.5 yd is where the pop was reported. Anything at or under ~6 yd is close
  // enough to a conversation that the moment is visible.
  assert.ok(outYd >= 8, `features drop out at ${outYd.toFixed(1)} yd, which must be well beyond talking distance`);
});

test('hysteresis survives, so the swap cannot flicker on the boundary', () => {
  assert.ok(thresholds.inSq < thresholds.outSq,
    'the come-back-in distance is nearer than the drop-out distance');
  const gap = Math.sqrt(thresholds.outSq) - Math.sqrt(thresholds.inSq);
  assert.ok(gap >= 0.5, `hysteresis gap is ${gap.toFixed(2)} yd and must stay meaningful`);
});

test('the swap is not pushed to never, because this renderer is draw-call bound', () => {
  // A1 measured 870-1982 draw calls a frame and draw-call bound rather than
  // fill bound. Carrying per-character detail across an entire distant crowd
  // spends exactly the currency the game is short of.
  const outYd = Math.sqrt(thresholds.outSq);
  assert.ok(outYd <= 30, `features are carried to ${outYd.toFixed(1)} yd; beyond ~30 the saving is gone`);
});
